-- Staff are trusted operational users for catalog maintenance and purchasing.
-- Destructive deletes and financial corrections remain owner/admin only.

drop policy "owners and admins read products" on public.products;
create policy "members read products"
on public.products for select to authenticated
using (private.is_org_member(organization_id));

drop policy "owners and admins insert products" on public.products;
create policy "operational members insert products"
on public.products for insert to authenticated
with check (private.is_org_member(organization_id));

drop policy "owners and admins update products" on public.products;
create policy "operational members update products"
on public.products for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

drop policy "owners and admins insert categories" on public.categories;
create policy "operational members insert categories"
on public.categories for insert to authenticated
with check (private.is_org_member(organization_id));

drop policy "owners and admins update categories" on public.categories;
create policy "operational members update categories"
on public.categories for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

drop policy "owners and admins insert brands" on public.brands;
create policy "operational members insert brands"
on public.brands for insert to authenticated
with check (private.is_org_member(organization_id));

drop policy "owners and admins update brands" on public.brands;
create policy "operational members update brands"
on public.brands for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

drop policy "owners and admins read suppliers" on public.suppliers;
create policy "members read suppliers"
on public.suppliers for select to authenticated
using (private.is_org_member(organization_id));

drop policy "owners and admins insert suppliers" on public.suppliers;
create policy "operational members insert suppliers"
on public.suppliers for insert to authenticated
with check (private.is_org_member(organization_id));

drop policy "owners and admins update suppliers" on public.suppliers;
create policy "operational members update suppliers"
on public.suppliers for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

drop policy "owners and admins read inventory movements" on public.inventory_movements;
create policy "members read inventory movements"
on public.inventory_movements for select to authenticated
using (private.is_org_member(organization_id));

drop policy "owners and admins add inventory adjustments" on public.inventory_movements;
create policy "operational members add inventory adjustments"
on public.inventory_movements for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and created_by = (select auth.uid())
  and coalesce(reference_type, '') not in ('sale', 'sale_cancellation', 'purchase_receipt')
  and kind not in ('sale', 'purchase')
);

drop policy "owners and admins read purchase orders" on public.purchase_orders;
create policy "members read purchase orders"
on public.purchase_orders for select to authenticated
using (private.is_org_member(organization_id));

drop policy "owners and admins read purchase order items" on public.purchase_order_items;
create policy "members read purchase order items"
on public.purchase_order_items for select to authenticated
using (private.is_org_member(organization_id));

drop policy "owners and admins read purchase receipts" on public.purchase_receipts;
create policy "members read purchase receipts"
on public.purchase_receipts for select to authenticated
using (private.is_org_member(organization_id));

drop policy "administrators read all expenses and staff read own expenses" on public.expenses;
create policy "members read expenses"
on public.expenses for select to authenticated
using (private.is_org_member(organization_id));

drop policy "owners and admins create purchase orders" on public.purchase_orders;
create policy "members create purchase orders"
on public.purchase_orders for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and created_by = (select auth.uid())
  and status = 'draft'
);

drop policy "owners and admins update purchase orders" on public.purchase_orders;
create policy "members update purchase orders"
on public.purchase_orders for update to authenticated
using (private.is_org_member(organization_id))
with check (private.is_org_member(organization_id));

drop policy "owners and admins insert purchase order items" on public.purchase_order_items;
create policy "authorized members insert purchase order items"
on public.purchase_order_items for insert to authenticated
with check (private.can_edit_purchase_order(organization_id, purchase_order_id));

drop policy "owners and admins update purchase order items" on public.purchase_order_items;
create policy "authorized members update purchase order items"
on public.purchase_order_items for update to authenticated
using (private.can_edit_purchase_order(organization_id, purchase_order_id))
with check (private.can_edit_purchase_order(organization_id, purchase_order_id));

drop policy "owners and admins delete purchase order items" on public.purchase_order_items;
create policy "authorized members delete purchase order items"
on public.purchase_order_items for delete to authenticated
using (private.can_edit_purchase_order(organization_id, purchase_order_id));

drop policy "owners and admins create purchase receipts" on public.purchase_receipts;
create policy "members create purchase receipts"
on public.purchase_receipts for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and received_by = (select auth.uid())
);

create or replace function private.can_edit_purchase_order(
  target_organization_id uuid,
  target_purchase_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_org_member(target_organization_id)
    and exists (
      select 1
      from public.purchase_orders
      where id = target_purchase_order_id
        and organization_id = target_organization_id
        and status = 'draft'
    );
$$;

create or replace function private.prepare_purchase_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is not null then
    if not private.is_org_member(new.organization_id) then
      raise exception using errcode = '42501', message = 'Organization membership is required';
    end if;
    new.received_by := actor_id;
  elsif current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  return new;
end;
$$;

create or replace function private.prepare_inventory_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is not null then
    new.created_by := actor_id;

    if pg_trigger_depth() = 1 then
      if not private.is_org_member(new.organization_id) then
        raise exception using
          errcode = '42501',
          message = 'Active organization membership is required';
      end if;

      if new.reference_type in ('sale', 'sale_cancellation', 'purchase_receipt') then
        raise exception using
          errcode = '42501',
          message = 'Reserved inventory references are generated by operational workflows';
      end if;

      if new.kind in ('sale', 'purchase') then
        raise exception using
          errcode = '42501',
          message = 'Sale and purchase inventory movements are generated by operational workflows';
      end if;
    end if;
  elsif current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  return new;
end;
$$;

create or replace function public.create_purchase_order(
  p_organization_id uuid,
  p_supplier_id uuid,
  p_items jsonb,
  p_reference text default null,
  p_ordered_at date default current_date,
  p_expected_at date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  order_id uuid;
  inserted_count integer;
  calculated_total numeric(14, 2);
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;

  if not exists (
    select 1
    from public.suppliers
    where id = p_supplier_id
      and organization_id = p_organization_id
      and is_active
  ) then
    raise exception using errcode = '23503', message = 'Supplier is missing, inactive, or belongs to another organization';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'A purchase order requires a non-empty items array';
  end if;

  if p_expected_at is not null
    and p_expected_at < coalesce(p_ordered_at, current_date) then
    raise exception using errcode = '22023', message = 'Expected date cannot be earlier than ordered date';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as input(
      product_id uuid,
      quantity_ordered numeric,
      unit_cost numeric
    )
    where product_id is null
      or quantity_ordered is null
      or quantity_ordered <= 0
      or (unit_cost is not null and unit_cost < 0)
  ) then
    raise exception using errcode = '22023', message = 'Purchase order item values are invalid';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_items) as input(product_id uuid)
  ) <> (
    select count(distinct product_id)
    from jsonb_to_recordset(p_items) as input(product_id uuid)
  ) then
    raise exception using errcode = '22023', message = 'Each product can appear only once per purchase order';
  end if;

  insert into public.purchase_orders (
    organization_id,
    supplier_id,
    reference,
    ordered_at,
    expected_at,
    notes,
    created_by
  )
  values (
    p_organization_id,
    p_supplier_id,
    nullif(trim(p_reference), ''),
    coalesce(p_ordered_at, current_date),
    p_expected_at,
    nullif(trim(p_notes), ''),
    (select auth.uid())
  )
  returning id into order_id;

  insert into public.purchase_order_items (
    organization_id,
    purchase_order_id,
    product_id,
    quantity_ordered,
    unit_cost
  )
  select
    p_organization_id,
    order_id,
    product.id,
    input.quantity_ordered,
    coalesce(input.unit_cost, product.cost_price)
  from jsonb_to_recordset(p_items) as input(
    product_id uuid,
    quantity_ordered numeric,
    unit_cost numeric
  )
  join public.products as product
    on product.id = input.product_id
   and product.organization_id = p_organization_id
   and product.is_active;

  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(p_items) then
    raise exception using errcode = '23503', message = 'One or more purchase products are missing or inactive';
  end if;

  select round(sum(quantity_ordered * unit_cost), 2)
  into calculated_total
  from public.purchase_order_items
  where purchase_order_id = order_id
    and organization_id = p_organization_id;

  update public.purchase_orders
  set estimated_total = calculated_total
  where id = order_id;

  return order_id;
end;
$$;

create or replace function public.receive_purchase_order(
  p_purchase_order_id uuid,
  p_items jsonb,
  p_notes text default null,
  p_receipt_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  order_organization_id uuid;
  receipt_id uuid;
  existing_receipt public.purchase_receipts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  select organization_id
  into order_organization_id
  from public.purchase_orders
  where id = p_purchase_order_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Purchase order was not found';
  end if;

  if not private.is_org_member(order_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;

  insert into public.purchase_receipts (
    id,
    organization_id,
    purchase_order_id,
    received_by,
    items,
    notes
  )
  values (
    p_receipt_id,
    order_organization_id,
    p_purchase_order_id,
    (select auth.uid()),
    p_items,
    nullif(trim(p_notes), '')
  )
  on conflict (id) do nothing
  returning id into receipt_id;

  if receipt_id is not null then
    return receipt_id;
  end if;

  select *
  into existing_receipt
  from public.purchase_receipts
  where id = p_receipt_id;

  if not found
    or existing_receipt.purchase_order_id <> p_purchase_order_id
    or existing_receipt.items <> p_items then
    raise exception using errcode = '23505', message = 'Receipt id was already used with different data';
  end if;

  return existing_receipt.id;
end;
$$;

create or replace function public.adjust_inventory(
  p_organization_id uuid,
  p_product_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_unit_cost numeric default null,
  p_adjustment_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  movement_id uuid;
  existing_movement public.inventory_movements%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;

  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception using errcode = '22023', message = 'Inventory adjustment cannot be zero';
  end if;

  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'An inventory adjustment reason is required';
  end if;

  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception using errcode = '22023', message = 'Unit cost cannot be negative';
  end if;

  insert into public.inventory_movements (
    organization_id,
    product_id,
    kind,
    quantity_delta,
    unit_cost,
    reference_type,
    reference_id,
    notes,
    created_by
  )
  values (
    p_organization_id,
    p_product_id,
    'adjustment',
    p_quantity_delta,
    p_unit_cost,
    'stock_adjustment',
    p_adjustment_id,
    trim(p_reason),
    (select auth.uid())
  )
  on conflict (organization_id, reference_id)
    where reference_type = 'stock_adjustment' and reference_id is not null
  do nothing
  returning id into movement_id;

  if movement_id is not null then
    return movement_id;
  end if;

  select *
  into existing_movement
  from public.inventory_movements
  where organization_id = p_organization_id
    and reference_type = 'stock_adjustment'
    and reference_id = p_adjustment_id;

  if not found
    or existing_movement.product_id <> p_product_id
    or existing_movement.quantity_delta <> p_quantity_delta
    or existing_movement.notes <> trim(p_reason) then
    raise exception using errcode = '23505', message = 'Adjustment id was already used with different data';
  end if;

  return existing_movement.id;
end;
$$;
