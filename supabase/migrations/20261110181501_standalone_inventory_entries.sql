-- Standalone stock ingress. Existing purchase documents and historical data stay intact.
create table private.inventory_entries (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payload jsonb not null,
  movement_ids uuid[] not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index inventory_entries_org_idx on private.inventory_entries(organization_id);
create index inventory_entries_actor_idx on private.inventory_entries(created_by);
alter table private.inventory_entries enable row level security;
revoke all on private.inventory_entries from public, anon, authenticated;
grant select, insert on private.inventory_entries to authenticated;
create policy "members read inventory entries" on private.inventory_entries
for select to authenticated using (private.is_org_member(organization_id));
create policy "members create inventory entries" on private.inventory_entries
for insert to authenticated with check (private.is_org_member(organization_id) and created_by = (select auth.uid()));

create function public.load_inventory_entry(
  p_organization_id uuid, p_request_id uuid, p_items jsonb, p_notes text default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  entry private.inventory_entries%rowtype;
  product public.products%rowtype;
  item record;
  payload jsonb;
  new_name text;
  new_sku text;
  new_barcode text;
  new_unit text;
  movement_ids uuid[] := '{}';
begin
  if (select auth.uid()) is null or not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  if p_request_id is null or char_length(coalesce(p_notes, '')) > 500 then
    raise exception using errcode = '22023', message = 'Invalid inventory entry';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid inventory entry items';
  end if;
  if jsonb_array_length(p_items) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Invalid inventory entry items';
  end if;
  payload := jsonb_build_object('items', p_items, 'notes', nullif(trim(p_notes), ''));
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into entry from private.inventory_entries where id = p_request_id and organization_id = p_organization_id;
  if found then
    if entry.payload is distinct from payload then
      raise exception using errcode = '23505', message = 'Inventory entry request already completed with different data';
    end if;
    return entry.id;
  end if;
  if (select count(distinct input.product_id) from jsonb_to_recordset(p_items) as input(product_id uuid)) <> jsonb_array_length(p_items) then
    raise exception using errcode = '22023', message = 'Inventory entry products must be unique';
  end if;
  -- Serialize new-product batches so concurrent SKU/barcode cross-checks see committed rows.
  if exists(select 1 from jsonb_array_elements(p_items) input where input->'new_product' is not null) then
    perform pg_advisory_xact_lock(hashtextextended('inventory_new_products:' || p_organization_id::text, 0));
  end if;

  for item in select * from jsonb_to_recordset(p_items) as input(
    product_id uuid, quantity numeric, unit_cost numeric, retail_price numeric, wholesale_price numeric,
    original_cost_price numeric, original_retail_price numeric, original_wholesale_price numeric, new_product jsonb
  ) order by product_id loop
    if item.quantity is null or item.quantity <= 0 or item.quantity > 1000000 or item.quantity <> round(item.quantity, 3)
      or item.unit_cost is null or item.unit_cost < 0 or item.unit_cost > 999999999 or item.unit_cost <> round(item.unit_cost, 2)
      or item.retail_price is null or item.retail_price < 0 or item.retail_price > 999999999999.99 or item.retail_price <> round(item.retail_price, 2)
      or (item.wholesale_price is not null and (item.wholesale_price < 0 or item.wholesale_price > 999999999999.99 or item.wholesale_price <> round(item.wholesale_price, 2)))
      or item.original_cost_price is null or item.original_retail_price is null then
      raise exception using errcode = '22023', message = 'Invalid inventory entry quantity or price';
    end if;

    if item.new_product is not null then
      if jsonb_typeof(item.new_product) is distinct from 'object'
        or jsonb_typeof(item.new_product->'name') is distinct from 'string'
        or jsonb_typeof(item.new_product->'sku') is distinct from 'string'
        or jsonb_typeof(item.new_product->'unit') is distinct from 'string'
        or (item.new_product->>'barcode' is not null and jsonb_typeof(item.new_product->'barcode') <> 'string') then
        raise exception using errcode = '22023', message = 'Invalid new inventory product';
      end if;
      new_name := trim(item.new_product->>'name');
      new_sku := btrim(regexp_replace(translate(item.new_product->>'sku', U&'\200B\200C\200D\2060\FEFF', ''), '[[:cntrl:]]', '', 'g'));
      new_barcode := nullif(btrim(regexp_replace(translate(item.new_product->>'barcode', U&'\200B\200C\200D\2060\FEFF', ''), '[[:cntrl:]]', '', 'g')), '');
      new_unit := item.new_product->>'unit';
      if char_length(new_name) not between 2 and 180 or char_length(new_sku) not between 1 and 80
        or char_length(new_barcode) > 80 or new_unit not in ('unidad','paquete','caja','bolsa','kit','par','litro','kilogramo') then
        raise exception using errcode = '22023', message = 'Invalid new inventory product';
      end if;
      if exists (select 1 from public.products where organization_id = p_organization_id
        and (sku = new_sku or barcode = new_sku or (new_barcode is not null and (sku = new_barcode or barcode = new_barcode)))) then
        raise exception using errcode = '23505', message = 'Inventory product identifier already exists';
      end if;
      insert into public.products(id, organization_id, name, sku, barcode, unit, cost_price, retail_price, wholesale_price)
      values (item.product_id, p_organization_id, new_name, new_sku, new_barcode, new_unit, item.unit_cost, item.retail_price, item.wholesale_price);
    else
      select * into product from public.products
      where id = item.product_id and organization_id = p_organization_id and is_active for update;
      if not found then
        raise exception using errcode = '23503', message = 'Inventory entry product is missing or inactive';
      end if;
      if (item.unit_cost is distinct from item.original_cost_price and product.cost_price is distinct from item.original_cost_price and product.cost_price is distinct from item.unit_cost)
        or (item.retail_price is distinct from item.original_retail_price and product.retail_price is distinct from item.original_retail_price and product.retail_price is distinct from item.retail_price)
        or (item.wholesale_price is distinct from item.original_wholesale_price and product.wholesale_price is distinct from item.original_wholesale_price and product.wholesale_price is distinct from item.wholesale_price) then
        raise exception using errcode = 'PT409', message = 'Inventory entry product price changed while editing', detail = product.name;
      end if;
      if item.unit_cost is distinct from item.original_cost_price or item.retail_price is distinct from item.original_retail_price or item.wholesale_price is distinct from item.original_wholesale_price then
        update public.products set
          cost_price = case when item.unit_cost is distinct from item.original_cost_price then item.unit_cost else cost_price end,
          retail_price = case when item.retail_price is distinct from item.original_retail_price then item.retail_price else retail_price end,
          wholesale_price = case when item.wholesale_price is distinct from item.original_wholesale_price then item.wholesale_price else wholesale_price end
        where id = item.product_id and organization_id = p_organization_id;
      end if;
    end if;
    movement_ids := array_append(movement_ids, public.adjust_inventory(
      p_organization_id, item.product_id, item.quantity,
      'Ingreso de mercaderia #' || p_request_id::text || coalesce(': ' || nullif(trim(p_notes), ''), ''),
      item.unit_cost, gen_random_uuid()
    ));
  end loop;
  insert into private.inventory_entries(id, organization_id, payload, movement_ids, created_by)
  values (p_request_id, p_organization_id, payload, movement_ids, (select auth.uid()));
  return p_request_id;
end;
$$;
revoke all on function public.load_inventory_entry(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.load_inventory_entry(uuid, uuid, jsonb, text) to authenticated;
comment on function public.load_inventory_entry(uuid, uuid, jsonb, text) is
  'Atomic standalone stock ingress, optional new products and edited prices. No supplier, invoice, purchase order, receipt, expense or cash movement.';
notify pgrst, 'reload schema';
