-- Additive management tools. No historical transactions or product prices are rewritten.
create function private.valid_inventory_attributes(value jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(value) = 'object'
    and value - array['family','size','age','capacity','presentation']::text[] = '{}'::jsonb
    and not exists (select 1 from jsonb_each(value) item where jsonb_typeof(item.value) <> 'string' or char_length(item.value #>> '{}') > 80);
$$;
revoke all on function private.valid_inventory_attributes(jsonb) from public, anon;
grant execute on function private.valid_inventory_attributes(jsonb) to authenticated;

alter table public.products add column inventory_attributes jsonb not null default '{}'::jsonb
  check (private.valid_inventory_attributes(inventory_attributes));
grant update (inventory_attributes) on public.products to authenticated;
-- Match the Spanish diacritics used by the browser's manual search normalization.
alter table public.products add column management_search_text text generated always as (
  translate(lower(name || ' ' || sku || ' ' || coalesce(barcode, '') || ' ' || inventory_attributes::text),
    'áéíóúüñàèìòùäëïöâêîôûç', 'aeiouunaeiouaeioaeiouc')
) stored;

create table public.product_price_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text not null,
  previous_prices jsonb not null,
  new_prices jsonb not null,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index product_price_changes_org_product_idx on public.product_price_changes(organization_id, product_id, created_at desc);
create index product_price_changes_actor_idx on public.product_price_changes(created_by);
create index product_price_changes_product_idx on public.product_price_changes(product_id);
alter table public.product_price_changes enable row level security;
revoke all on public.product_price_changes from public, anon, authenticated;
grant select on public.product_price_changes to authenticated;
create policy "members read product price changes" on public.product_price_changes for select to authenticated
  using (private.is_org_member(organization_id));

create function private.record_product_price_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (old.cost_price, old.retail_price, old.wholesale_price) is distinct from (new.cost_price, new.retail_price, new.wholesale_price) then
    insert into public.product_price_changes(organization_id, product_id, product_name, sku, previous_prices, new_prices, reason, created_by)
    values (new.organization_id, new.id, new.name, new.sku,
      jsonb_build_object('cost', old.cost_price, 'retail', old.retail_price, 'wholesale', old.wholesale_price),
      jsonb_build_object('cost', new.cost_price, 'retail', new.retail_price, 'wholesale', new.wholesale_price),
      coalesce(nullif(current_setting('morita.price_reason', true), ''), 'Edicion de producto / ingreso de mercaderia'), (select auth.uid()));
  end if;
  return new;
end;
$$;
revoke all on function private.record_product_price_change() from public, anon, authenticated;
create trigger product_price_change_history after update of cost_price, retail_price, wholesale_price on public.products
  for each row execute function private.record_product_price_change();

create function public.update_management_prices(p_organization_id uuid, p_changes jsonb, p_reason text default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare item record; product public.products%rowtype; changed integer := 0;
begin
  if (select auth.uid()) is null or not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception using errcode = '22023', message = 'Invalid price changes'; end if;
  if jsonb_array_length(p_changes) not between 1 and 500 or char_length(coalesce(p_reason, '')) > 500 then
    raise exception using errcode = '22023', message = 'Invalid price changes';
  end if;
  if (select count(distinct input.product_id) from jsonb_to_recordset(p_changes) as input(product_id uuid)) <> jsonb_array_length(p_changes) then
    raise exception using errcode = '22023', message = 'Products must be unique';
  end if;
  perform set_config('morita.price_reason', coalesce(nullif(trim(p_reason), ''), 'Edicion rapida de precios'), true);
  for item in select * from jsonb_to_recordset(p_changes) as input(product_id uuid, cost_price numeric, retail_price numeric, wholesale_price numeric,
    original_cost_price numeric, original_retail_price numeric, original_wholesale_price numeric) order by product_id loop
    if item.cost_price is null or item.retail_price is null or item.original_cost_price is null or item.original_retail_price is null
      or item.cost_price < 0 or item.retail_price < 0 or item.wholesale_price < 0
      or item.cost_price > 999999999999.99 or item.retail_price > 999999999999.99 or item.wholesale_price > 999999999999.99
      or item.cost_price <> round(item.cost_price, 2) or item.retail_price <> round(item.retail_price, 2) or item.wholesale_price <> round(item.wholesale_price, 2) then
      raise exception using errcode = '22023', message = 'Invalid product prices';
    end if;
    select * into product from public.products where id = item.product_id and organization_id = p_organization_id for update;
    if not found then raise exception using errcode = '42501', message = 'Product unavailable'; end if;
    if (product.cost_price, product.retail_price, product.wholesale_price) is distinct from
      (item.original_cost_price, item.original_retail_price, item.original_wholesale_price) then
      raise exception using errcode = 'PT409', message = 'Product price changed while editing', detail = product.name;
    end if;
    update public.products set cost_price = item.cost_price, retail_price = item.retail_price, wholesale_price = item.wholesale_price
      where id = product.id and organization_id = p_organization_id;
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;
revoke all on function public.update_management_prices(uuid, jsonb, text) from public, anon;
grant execute on function public.update_management_prices(uuid, jsonb, text) to authenticated;

create function public.classify_management_products(p_organization_id uuid, p_product_ids uuid[], p_category_id uuid default null, p_brand_id uuid default null,
  p_set_category boolean default false, p_set_brand boolean default false)
returns integer language plpgsql security invoker set search_path = '' as $$
declare matched integer;
begin
  if (select auth.uid()) is null or not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  if coalesce(cardinality(p_product_ids), 0) not between 1 and 500 or not (p_set_category or p_set_brand)
    or (select count(distinct id) from unnest(p_product_ids) id) <> cardinality(p_product_ids) then
    raise exception using errcode = '22023', message = 'Invalid classification selection';
  end if;
  if p_set_category and p_category_id is not null and not exists(select 1 from public.categories where id = p_category_id and organization_id = p_organization_id and is_active)
    or p_set_brand and p_brand_id is not null and not exists(select 1 from public.brands where id = p_brand_id and organization_id = p_organization_id and is_active) then
    raise exception using errcode = '23503', message = 'Classification unavailable';
  end if;
  perform id from public.products where organization_id = p_organization_id and id = any(p_product_ids) order by id for update;
  select count(*) into matched from public.products where organization_id = p_organization_id and id = any(p_product_ids);
  if matched <> cardinality(p_product_ids) then raise exception using errcode = '42501', message = 'Product unavailable'; end if;
  update public.products set category_id = case when p_set_category then p_category_id else category_id end,
    brand_id = case when p_set_brand then p_brand_id else brand_id end
    where organization_id = p_organization_id and id = any(p_product_ids);
  return matched;
end;
$$;
revoke all on function public.classify_management_products(uuid, uuid[], uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.classify_management_products(uuid, uuid[], uuid, uuid, boolean, boolean) to authenticated;

create or replace function public.update_product_details(p_organization_id uuid, p_product_id uuid, p_values jsonb, p_original_stock numeric, p_requested_stock numeric)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare current_product public.products%rowtype; changes public.products%rowtype; original jsonb;
begin
  if not private.has_org_role(p_organization_id, array['owner','admin','staff']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'Not authorized to edit this product';
  end if;
  if jsonb_typeof(p_values) is distinct from 'object' or p_original_stock is null or p_requested_stock is null
    or p_original_stock < 0 or p_requested_stock < 0 or p_original_stock > 999999999 or p_requested_stock > 999999999
    or p_original_stock <> round(p_original_stock, 3) or p_requested_stock <> round(p_requested_stock, 3) then
    raise exception using errcode = '22023', message = 'Invalid product edit values';
  end if;
  select * into current_product from public.products where id = p_product_id and organization_id = p_organization_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Product not found'; end if;
  if p_requested_stock <> p_original_stock and current_product.current_stock <> p_original_stock then
    raise exception using errcode = '40001', message = 'Product stock changed while editing';
  end if;
  changes := jsonb_populate_record(current_product, p_values);
  original := p_values->'_original_prices';
  if original is not null then
    if (changes.cost_price is distinct from (original->>'cost')::numeric and current_product.cost_price is distinct from (original->>'cost')::numeric and current_product.cost_price is distinct from changes.cost_price)
      or (changes.retail_price is distinct from (original->>'retail')::numeric and current_product.retail_price is distinct from (original->>'retail')::numeric and current_product.retail_price is distinct from changes.retail_price)
      or (changes.wholesale_price is distinct from (original->>'wholesale')::numeric and current_product.wholesale_price is distinct from (original->>'wholesale')::numeric and current_product.wholesale_price is distinct from changes.wholesale_price) then
      raise exception using errcode = 'PT409', message = 'Product price changed while editing';
    end if;
    if changes.cost_price is not distinct from (original->>'cost')::numeric then changes.cost_price := current_product.cost_price; end if;
    if changes.retail_price is not distinct from (original->>'retail')::numeric then changes.retail_price := current_product.retail_price; end if;
    if changes.wholesale_price is not distinct from (original->>'wholesale')::numeric then changes.wholesale_price := current_product.wholesale_price; end if;
  end if;
  update public.products set name = changes.name, sku = changes.sku, barcode = changes.barcode,
    unit = changes.unit, description = changes.description, image_path = changes.image_path,
    category_id = changes.category_id, brand_id = changes.brand_id, default_supplier_id = changes.default_supplier_id,
    cost_price = changes.cost_price, retail_price = changes.retail_price, wholesale_price = changes.wholesale_price,
    wholesale_min_quantity = changes.wholesale_min_quantity, min_stock = changes.min_stock, target_stock = changes.target_stock,
    commercial_description = changes.commercial_description, is_featured = changes.is_featured, is_published = changes.is_published,
    hide_when_out_of_stock = changes.hide_when_out_of_stock, seo_title = changes.seo_title, seo_description = changes.seo_description,
    store_slug = changes.store_slug, inventory_attributes = changes.inventory_attributes
  where id = p_product_id and organization_id = p_organization_id;
  if p_requested_stock <> p_original_stock then
    perform public.adjust_inventory(p_organization_id, p_product_id, p_requested_stock - current_product.current_stock,
      'Stock total actualizado desde la edicion del producto a ' || p_requested_stock::text);
  end if;
  return p_product_id;
end;
$$;

alter function public.load_inventory_entry(uuid, uuid, jsonb, text) set schema private;
alter function private.load_inventory_entry(uuid, uuid, jsonb, text) rename to load_inventory_entry_base;
create function public.load_inventory_entry(p_organization_id uuid, p_request_id uuid, p_items jsonb, p_notes text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare item jsonb; new_product jsonb; category uuid; brand uuid; result uuid;
begin
  if (select auth.uid()) is null or not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid inventory entry';
  end if;
  if jsonb_array_length(p_items) not between 1 and 500 then raise exception using errcode = '22023', message = 'Invalid inventory entry items'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  if exists(select 1 from private.inventory_entries where id = p_request_id and organization_id = p_organization_id) then
    return private.load_inventory_entry_base(p_organization_id, p_request_id, p_items, p_notes);
  end if;
  for item in select * from jsonb_array_elements(p_items) loop
    new_product := item->'new_product';
    if new_product is null then continue; end if;
    category := nullif(new_product->>'category_id', '')::uuid;
    brand := nullif(new_product->>'brand_id', '')::uuid;
    if category is not null and not exists(select 1 from public.categories where id = category and organization_id = p_organization_id and is_active) then
      raise exception using errcode = '23503', message = 'Inventory entry category unavailable';
    end if;
    if brand is not null and not exists(select 1 from public.brands where id = brand and organization_id = p_organization_id and is_active) then
      raise exception using errcode = '23503', message = 'Inventory entry brand unavailable';
    end if;
  end loop;
  result := private.load_inventory_entry_base(p_organization_id, p_request_id, p_items, p_notes);
  for item in select * from jsonb_array_elements(p_items) loop
    if item->'new_product' is null then continue; end if;
    update public.products set category_id = nullif(item->'new_product'->>'category_id', '')::uuid,
      brand_id = nullif(item->'new_product'->>'brand_id', '')::uuid
      where id = (item->>'product_id')::uuid and organization_id = p_organization_id;
  end loop;
  return result;
end;
$$;
revoke all on function public.load_inventory_entry(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.load_inventory_entry(uuid, uuid, jsonb, text) to authenticated;
notify pgrst, 'reload schema';
