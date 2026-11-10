-- Idempotency metadata only. Existing orders, receipts and movements stay intact.
create table private.direct_purchase_entries (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  purchase_order_id uuid not null unique,
  receipt_id uuid not null unique,
  payload jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (purchase_order_id, organization_id)
    references public.purchase_orders(id, organization_id) on delete restrict,
  foreign key (receipt_id, organization_id)
    references public.purchase_receipts(id, organization_id) on delete restrict
);
create index direct_purchase_entries_org_idx on private.direct_purchase_entries(organization_id);
create index direct_purchase_entries_actor_idx on private.direct_purchase_entries(created_by);
alter table private.direct_purchase_entries enable row level security;
revoke all on private.direct_purchase_entries from public, anon, authenticated;
grant select, insert on private.direct_purchase_entries to authenticated;
create policy "members read direct purchase entries"
on private.direct_purchase_entries for select to authenticated
using (private.is_org_member(organization_id));
create policy "members record completed direct entries"
on private.direct_purchase_entries for insert to authenticated
with check (
  private.is_org_member(organization_id) and created_by = (select auth.uid())
  and exists (
    select 1 from public.purchase_receipts receipt
    where receipt.id = direct_purchase_entries.receipt_id
      and receipt.organization_id = direct_purchase_entries.organization_id
      and receipt.purchase_order_id = direct_purchase_entries.purchase_order_id
  )
);

create function public.load_received_purchase_order(
  p_organization_id uuid,
  p_supplier_id uuid,
  p_request_id uuid,
  p_document_date date,
  p_items jsonb,
  p_reference text default null,
  p_notes text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entry private.direct_purchase_entries%rowtype;
  product public.products%rowtype;
  item record;
  payload jsonb;
  order_id uuid;
  receipt_id uuid;
  order_items jsonb;
  receipt_items jsonb;
begin
  if (select auth.uid()) is null or not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  if p_request_id is null or p_supplier_id is null or p_document_date is null
    or p_document_date > (now() at time zone 'America/Argentina/Buenos_Aires')::date
    or char_length(coalesce(p_reference, '')) > 80
    or char_length(coalesce(p_notes, '')) > 500 then
    raise exception using errcode = '22023', message = 'Invalid direct purchase document';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid direct purchase items';
  end if;
  if jsonb_array_length(p_items) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Invalid direct purchase items';
  end if;
  payload := jsonb_build_object(
    'supplier_id', p_supplier_id, 'document_date', p_document_date,
    'reference', nullif(trim(p_reference), ''), 'notes', nullif(trim(p_notes), ''), 'items', p_items
  );

  -- Serialize retries before creating an order or changing any price/stock.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into entry from private.direct_purchase_entries
  where id = p_request_id and organization_id = p_organization_id;
  if found then
    if entry.payload is distinct from payload then
      raise exception using errcode = '23505', message = 'Direct purchase request already completed with different data';
    end if;
    return entry.purchase_order_id;
  end if;

  if (select count(distinct input.product_id) from jsonb_to_recordset(p_items) as input(product_id uuid))
    <> jsonb_array_length(p_items) then
    raise exception using errcode = '22023', message = 'Direct purchase products must be unique';
  end if;

  -- Stable lock ordering also allows unrelated stock movements to finish first.
  for item in select * from jsonb_to_recordset(p_items) as input(
    product_id uuid, quantity numeric, unit_cost numeric, retail_price numeric, wholesale_price numeric,
    original_cost_price numeric, original_retail_price numeric, original_wholesale_price numeric
  ) order by product_id loop
    if item.quantity is null or item.quantity <= 0 or item.quantity > 1000000
      or item.quantity <> round(item.quantity, 3)
      or item.unit_cost is null or item.unit_cost < 0 or item.unit_cost > 999999999
      or item.unit_cost <> round(item.unit_cost, 2)
      or item.retail_price is null or item.retail_price < 0 or item.retail_price > 999999999999.99
      or item.retail_price <> round(item.retail_price, 2)
      or (item.wholesale_price is not null and (item.wholesale_price < 0
        or item.wholesale_price > 999999999999.99 or item.wholesale_price <> round(item.wholesale_price, 2)))
      or item.original_cost_price is null or item.original_retail_price is null then
      raise exception using errcode = '22023', message = 'Invalid direct purchase quantity or price';
    end if;
    select * into product from public.products
    where id = item.product_id and organization_id = p_organization_id and is_active for update;
    if not found then
      raise exception using errcode = '23503', message = 'Direct purchase product is missing or inactive';
    end if;
    if (item.unit_cost is distinct from item.original_cost_price
        and product.cost_price is distinct from item.original_cost_price and product.cost_price is distinct from item.unit_cost)
      or (item.retail_price is distinct from item.original_retail_price
        and product.retail_price is distinct from item.original_retail_price and product.retail_price is distinct from item.retail_price)
      or (item.wholesale_price is distinct from item.original_wholesale_price
        and product.wholesale_price is distinct from item.original_wholesale_price and product.wholesale_price is distinct from item.wholesale_price) then
      -- A price conflict needs user review, not an automatic transaction retry.
      raise exception using errcode = 'PT409', message = 'Direct purchase product price changed while editing', detail = product.name;
    end if;
    if item.unit_cost is distinct from item.original_cost_price
      or item.retail_price is distinct from item.original_retail_price
      or item.wholesale_price is distinct from item.original_wholesale_price then
      update public.products set
        cost_price = case when item.unit_cost is distinct from item.original_cost_price then item.unit_cost else cost_price end,
        retail_price = case when item.retail_price is distinct from item.original_retail_price then item.retail_price else retail_price end,
        wholesale_price = case when item.wholesale_price is distinct from item.original_wholesale_price then item.wholesale_price else wholesale_price end
      where id = item.product_id and organization_id = p_organization_id;
    end if;
  end loop;

  if (select sum(input.quantity * input.unit_cost) from jsonb_to_recordset(p_items) as input(quantity numeric, unit_cost numeric)) > 999999999999.99 then
    raise exception using errcode = '22023', message = 'Direct purchase total exceeds the supported limit';
  end if;

  select jsonb_agg(jsonb_build_object(
    'product_id', input.product_id, 'quantity_ordered', input.quantity, 'unit_cost', input.unit_cost
  )) into order_items from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, unit_cost numeric);
  order_id := public.create_purchase_order(
    p_organization_id, p_supplier_id, order_items,
    p_reference, p_document_date, null, p_notes
  );
  update public.purchase_orders set status = 'sent'
  where id = order_id and organization_id = p_organization_id;
  select jsonb_agg(jsonb_build_object(
    'purchase_order_item_id', line.id, 'quantity', line.quantity_ordered, 'unit_cost', line.unit_cost
  ) order by line.id) into receipt_items
  from public.purchase_order_items line where line.purchase_order_id = order_id and line.organization_id = p_organization_id;
  receipt_id := public.receive_purchase_order(order_id, receipt_items, p_notes, p_request_id);

  insert into private.direct_purchase_entries(id, organization_id, purchase_order_id, receipt_id, payload, created_by)
  values (p_request_id, p_organization_id, order_id, receipt_id, payload, (select auth.uid()));
  return order_id;
end;
$$;
revoke all on function public.load_received_purchase_order(uuid, uuid, uuid, date, jsonb, text, text) from public, anon;
grant execute on function public.load_received_purchase_order(uuid, uuid, uuid, date, jsonb, text, text) to authenticated;
comment on function public.load_received_purchase_order(uuid, uuid, uuid, date, jsonb, text, text) is
  'Atomic direct receipt reusing purchase workflows. Only edited catalog prices change; retries never duplicate stock. No cash movement is created.';
notify pgrst, 'reload schema';
