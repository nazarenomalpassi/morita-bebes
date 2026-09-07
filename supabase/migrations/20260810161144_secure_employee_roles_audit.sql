-- Security hardening for the employee role. This migration is additive and
-- preserves every existing operational and historical row.

alter table public.user_profiles
  add column display_name text,
  add column last_login_at timestamptz;

update public.user_profiles
set display_name = coalesce(nullif(trim(email), ''), 'Usuario')
where display_name is null;

alter table public.user_profiles
  add constraint user_profiles_display_name_check
  check (display_name is null or char_length(trim(display_name)) between 2 and 120);

create or replace function private.sync_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_name text;
begin
  resolved_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), '')
  );

  insert into public.user_profiles (
    user_id,
    email,
    display_name,
    created_at,
    updated_at
  )
  values (
    new.id,
    lower(trim(new.email)),
    resolved_name,
    coalesce(new.created_at, now()),
    coalesce(new.updated_at, now())
  )
  on conflict (user_id)
  do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, public.user_profiles.display_name),
        updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger sync_user_profile on auth.users;
create trigger sync_user_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function private.sync_user_profile();

drop policy "users and organization administrators read profiles" on public.user_profiles;
create policy "users and co-organization administrators read profiles"
on public.user_profiles for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.organization_members as actor
    join public.organization_members as subject
      on subject.organization_id = actor.organization_id
     and subject.user_id = public.user_profiles.user_id
    where actor.user_id = (select auth.uid())
      and actor.is_active
      and actor.role in ('owner', 'admin')
  )
);

-- Staff can inspect only the operational catalog fields required to sell.
drop policy "members read products" on public.products;
create policy "owners and admins read products"
on public.products for select
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create or replace function public.list_operational_products(
  p_organization_id uuid
)
returns table (
  id uuid,
  name text,
  sku text,
  barcode text,
  description text,
  retail_price numeric,
  current_stock numeric,
  min_stock numeric,
  needs_restock boolean,
  unit text,
  is_active boolean,
  category_id uuid,
  category_name text,
  brand_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;

  return query
  select
    product.id,
    product.name,
    product.sku,
    product.barcode,
    product.description,
    product.retail_price,
    product.current_stock,
    product.min_stock,
    product.needs_restock,
    product.unit,
    product.is_active,
    product.category_id,
    category.name,
    brand.name
  from public.products as product
  left join public.categories as category
    on category.id = product.category_id
   and category.organization_id = product.organization_id
  left join public.brands as brand
    on brand.id = product.brand_id
   and brand.organization_id = product.organization_id
  where product.organization_id = p_organization_id
  order by product.name, product.id;
end;
$$;

revoke all on function public.list_operational_products(uuid) from public, anon;
grant execute on function public.list_operational_products(uuid) to authenticated, service_role;

-- Purchase data and inventory costs are administrative information.
drop policy "members read suppliers" on public.suppliers;
create policy "owners and admins read suppliers"
on public.suppliers for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "members read inventory movements" on public.inventory_movements;
create policy "owners and admins read inventory movements"
on public.inventory_movements for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "members read purchase orders" on public.purchase_orders;
create policy "owners and admins read purchase orders"
on public.purchase_orders for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "members read purchase order items" on public.purchase_order_items;
create policy "owners and admins read purchase order items"
on public.purchase_order_items for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "members read purchase receipts" on public.purchase_receipts;
create policy "owners and admins read purchase receipts"
on public.purchase_receipts for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

-- Raw sale writes are blocked. The create_sale RPC remains the only write path
-- and captures server-side prices, actor identity, stock and timestamps.
drop policy "members create sales" on public.sales;
drop policy "creators and administrators update sales" on public.sales;
create policy "owners and admins update sales"
on public.sales for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "authorized users insert draft sale items" on public.sale_items;
drop policy "authorized users update draft sale items" on public.sale_items;
drop policy "authorized users delete draft sale items" on public.sale_items;

drop policy "members read sales" on public.sales;
create policy "administrators read all sales and staff read own sales"
on public.sales for select to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (private.has_org_role(organization_id, array['staff']::public.app_role[]) and created_by = (select auth.uid()))
);

drop policy "members read sale items" on public.sale_items;
create policy "owners and admins read sale items"
on public.sale_items for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create or replace function public.create_sale(
  p_organization_id uuid,
  p_items jsonb,
  p_payment_method_id uuid default null,
  p_customer_id uuid default null,
  p_discount numeric default 0,
  p_notes text default null,
  p_reference text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  sale_id uuid;
  inserted_count integer;
  effective_occurred_at timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  select member.role
  into actor_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = actor_id
    and member.is_active;

  if not found then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'A sale requires a non-empty items array';
  end if;

  if jsonb_array_length(p_items) > 250 then
    raise exception using errcode = '22023', message = 'A sale cannot exceed 250 product lines';
  end if;

  if p_discount is null or p_discount < 0 then
    raise exception using errcode = '22023', message = 'Sale discount must be zero or greater';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, discount numeric)
    where product_id is null
      or quantity is null
      or quantity <= 0
      or quantity > 100000
      or (discount is not null and discount < 0)
  ) then
    raise exception using errcode = '22023', message = 'Sale item values are invalid';
  end if;

  if (
    select count(*) from jsonb_to_recordset(p_items) as input(product_id uuid)
  ) <> (
    select count(distinct product_id) from jsonb_to_recordset(p_items) as input(product_id uuid)
  ) then
    raise exception using errcode = '22023', message = 'Each product can appear only once per sale';
  end if;

  if p_payment_method_id is null or not exists (
    select 1 from public.payment_methods
    where id = p_payment_method_id
      and organization_id = p_organization_id
      and is_active
  ) then
    raise exception using errcode = '23503', message = 'Payment method is missing, inactive, or belongs to another organization';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers
    where id = p_customer_id
      and organization_id = p_organization_id
      and is_active
  ) then
    raise exception using errcode = '23503', message = 'Customer is missing, inactive, or belongs to another organization';
  end if;

  effective_occurred_at := case
    when actor_role = 'staff' then now()
    else coalesce(p_occurred_at, now())
  end;

  insert into public.sales (
    organization_id, customer_id, payment_method_id, reference,
    occurred_at, notes, created_by
  )
  values (
    p_organization_id, p_customer_id, p_payment_method_id,
    nullif(trim(p_reference), ''), effective_occurred_at,
    nullif(trim(p_notes), ''), actor_id
  )
  returning id into sale_id;

  insert into public.sale_items (
    organization_id, sale_id, product_id, quantity,
    unit_price, unit_cost, discount
  )
  select
    p_organization_id,
    sale_id,
    product.id,
    input.quantity,
    product.retail_price,
    product.cost_price,
    coalesce(input.discount, 0)
  from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, discount numeric)
  join public.products as product
    on product.id = input.product_id
   and product.organization_id = p_organization_id
   and product.is_active;

  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(p_items) then
    raise exception using errcode = '23503', message = 'One or more sale products are missing or inactive';
  end if;

  update public.sales
  set discount = p_discount,
      status = 'completed'
  where id = sale_id;

  return sale_id;
end;
$$;

revoke all on function public.create_sale(uuid, jsonb, uuid, uuid, numeric, text, text, timestamptz)
from public, anon;
grant execute on function public.create_sale(uuid, jsonb, uuid, uuid, numeric, text, text, timestamptz)
to authenticated, service_role;

create or replace function public.list_operational_sales(
  p_organization_id uuid,
  p_created_by uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  reference text,
  occurred_at timestamptz,
  total numeric,
  status public.sale_status,
  cancellation_reason text,
  customer_name text,
  payment_method_name text,
  item_count bigint,
  created_by uuid,
  actor_name text,
  actor_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
begin
  select member.role
  into actor_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = actor_id
    and member.is_active;

  if actor_id is null or not found then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;

  return query
  select
    sale.id,
    sale.reference,
    sale.occurred_at,
    sale.total,
    sale.status,
    sale.cancellation_reason,
    customer.name,
    payment_method.name,
    count(item.id),
    sale.created_by,
    profile.display_name,
    profile.email
  from public.sales as sale
  left join public.customers as customer
    on customer.id = sale.customer_id
   and customer.organization_id = sale.organization_id
  left join public.payment_methods as payment_method
    on payment_method.id = sale.payment_method_id
   and payment_method.organization_id = sale.organization_id
  left join public.sale_items as item
    on item.sale_id = sale.id
   and item.organization_id = sale.organization_id
  left join public.user_profiles as profile on profile.user_id = sale.created_by
  where sale.organization_id = p_organization_id
    and (
      (actor_role in ('owner', 'admin') and (p_created_by is null or sale.created_by = p_created_by))
      or (actor_role = 'staff' and sale.created_by = actor_id)
    )
  group by sale.id, customer.name, payment_method.name, profile.display_name, profile.email
  order by sale.occurred_at desc, sale.id
  limit least(greatest(coalesce(p_limit, 30), 1), 200);
end;
$$;

revoke all on function public.list_operational_sales(uuid, uuid, integer) from public, anon;
grant execute on function public.list_operational_sales(uuid, uuid, integer) to authenticated, service_role;

-- Expenses are append-oriented: staff can create and read only their own rows;
-- administrators can correct or cancel them, but nobody can physically delete.
alter table public.expenses
  add column status text not null default 'posted',
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users(id) on delete set null,
  add column cancellation_reason text,
  add constraint expenses_status_check check (status in ('posted', 'cancelled')),
  add constraint expenses_cancellation_fields_check check (
    (status = 'posted' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or
    (status = 'cancelled' and cancelled_at is not null and cancellation_reason is not null and char_length(trim(cancellation_reason)) >= 3)
  );

create or replace function private.guard_expense_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
begin
  if actor_id is not null then
    select member.role
    into actor_role
    from public.organization_members as member
    where member.organization_id = coalesce(new.organization_id, old.organization_id)
      and member.user_id = actor_id
      and member.is_active;

    if not found then
      raise exception using errcode = '42501', message = 'Active organization membership is required';
    end if;
  elsif current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor_id, new.created_by);
    new.status := 'posted';
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
    if actor_role = 'staff' then
      new.expense_date := current_date;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'Expense identity and creation fields are immutable';
  end if;

  if old.status = 'cancelled' then
    raise exception using errcode = '42501', message = 'Cancelled expenses are immutable';
  end if;

  if actor_id is not null and actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'Only administrators can modify expenses';
  end if;

  if new.status = old.status then
    if new.cancelled_at is distinct from old.cancelled_at
      or new.cancelled_by is distinct from old.cancelled_by
      or new.cancellation_reason is distinct from old.cancellation_reason then
      raise exception using errcode = '42501', message = 'Expense cancellation fields are workflow-managed';
    end if;
    return new;
  end if;

  if old.status = 'posted' and new.status = 'cancelled' then
    if new.description is distinct from old.description
      or new.amount is distinct from old.amount
      or new.expense_date is distinct from old.expense_date
      or new.category_id is distinct from old.category_id
      or new.payment_method_id is distinct from old.payment_method_id
      or new.receipt_path is distinct from old.receipt_path
      or new.notes is distinct from old.notes then
      raise exception using errcode = '42501', message = 'Cancel an expense without changing its original data';
    end if;
    if new.cancellation_reason is null or char_length(trim(new.cancellation_reason)) < 3 then
      raise exception using errcode = '23514', message = 'A cancellation reason is required';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := actor_id;
    new.cancellation_reason := trim(new.cancellation_reason);
    return new;
  end if;

  raise exception using errcode = '23514', message = 'Invalid expense status transition';
end;
$$;

create or replace function private.reject_expense_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Expenses are historical records and cannot be deleted';
end;
$$;

create trigger guard_expense_write
before insert or update on public.expenses
for each row execute function private.guard_expense_write();

create trigger reject_expense_delete
before delete on public.expenses
for each row execute function private.reject_expense_delete();

drop policy "members read expenses" on public.expenses;
create policy "administrators read all expenses and staff read own expenses"
on public.expenses for select to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (private.has_org_role(organization_id, array['staff']::public.app_role[]) and created_by = (select auth.uid()))
);

drop policy "owners and admins delete expenses" on public.expenses;
revoke delete on public.expenses from authenticated;

create or replace function public.cancel_expense(p_expense_id uuid, p_reason text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  select organization_id into target_organization_id
  from public.expenses
  where id = p_expense_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Expense was not found';
  end if;

  if not private.has_org_role(target_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'Only administrators can cancel expenses';
  end if;

  update public.expenses
  set status = 'cancelled', cancellation_reason = nullif(trim(p_reason), '')
  where id = p_expense_id and status = 'posted';

  return p_expense_id;
end;
$$;

revoke all on function public.cancel_expense(uuid, text) from public, anon;
grant execute on function public.cancel_expense(uuid, text) to authenticated, service_role;

-- Membership changes are available only through guarded RPCs. Admins may
-- manage staff/admin accounts but only an owner may create or modify owners.
drop policy "members read organization memberships" on public.organization_members;
create policy "members read own membership and administrators read organization team"
on public.organization_members for select to authenticated
using (
  user_id = (select auth.uid())
  or private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
);

drop policy "owners add organization memberships" on public.organization_members;
drop policy "owners update organization memberships" on public.organization_members;
drop policy "owners delete organization memberships" on public.organization_members;
revoke insert, update, delete on public.organization_members from authenticated;

create or replace function public.add_organization_member_by_email(
  p_organization_id uuid,
  p_email text,
  p_role public.app_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.app_role;
  target_user_id uuid;
begin
  select member.role into actor_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = (select auth.uid())
    and member.is_active
    and member.role in ('owner', 'admin')
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Only administrators can manage organization members';
  end if;

  if p_email is null or position('@' in trim(p_email)) < 2 or p_role is null then
    raise exception using errcode = '22023', message = 'A valid email and role are required';
  end if;

  if actor_role = 'admin' and p_role = 'owner' then
    raise exception using errcode = '42501', message = 'Only an owner can create another owner';
  end if;

  select profile.user_id into target_user_id
  from public.user_profiles as profile
  where profile.email = lower(trim(p_email))
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'No registered user exists with that email';
  end if;

  insert into public.organization_members (organization_id, user_id, role, is_active)
  values (p_organization_id, target_user_id, p_role, true)
  on conflict (organization_id, user_id)
  do update set role = excluded.role, is_active = true, updated_at = now();

  return target_user_id;
end;
$$;

create or replace function public.update_organization_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_role public.app_role,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.app_role;
  target_role public.app_role;
begin
  select member.role into actor_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = (select auth.uid())
    and member.is_active
    and member.role in ('owner', 'admin')
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Only administrators can manage organization members';
  end if;

  select member.role into target_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Organization member was not found';
  end if;

  if actor_role = 'admin' and (target_role = 'owner' or p_role = 'owner') then
    raise exception using errcode = '42501', message = 'Only an owner can modify owner access';
  end if;

  update public.organization_members
  set role = p_role, is_active = p_is_active, updated_at = now()
  where organization_id = p_organization_id and user_id = p_user_id;

  return p_user_id;
end;
$$;

drop function public.list_organization_members(uuid);

create function public.list_organization_members(p_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role public.app_role,
  is_active boolean,
  created_at timestamptz,
  last_login_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'Only administrators can list organization members';
  end if;

  return query
  select member.user_id, profile.email, profile.display_name, member.role,
         member.is_active, member.created_at, profile.last_login_at
  from public.organization_members as member
  left join public.user_profiles as profile on profile.user_id = member.user_id
  where member.organization_id = p_organization_id
  order by case member.role when 'owner' then 1 when 'admin' then 2 else 3 end,
           coalesce(profile.display_name, profile.email);
end;
$$;

revoke all on function public.add_organization_member_by_email(uuid, text, public.app_role) from public, anon;
revoke all on function public.update_organization_member(uuid, uuid, public.app_role, boolean) from public, anon;
revoke all on function public.list_organization_members(uuid) from public, anon;
grant execute on function public.add_organization_member_by_email(uuid, text, public.app_role) to authenticated, service_role;
grant execute on function public.update_organization_member(uuid, uuid, public.app_role, boolean) to authenticated, service_role;
grant execute on function public.list_organization_members(uuid) to authenticated, service_role;

-- Audit snapshots are visible only to administrators. The actor name, email and
-- role are copied into metadata so historical entries stay understandable.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_data jsonb;
  new_data jsonb;
  organization_value uuid;
  entity_value uuid;
  actor_id uuid := (select auth.uid());
  actor_name text;
  actor_email text;
  actor_role public.app_role;
  changed_fields jsonb := '[]'::jsonb;
  action_value text;
  description_value text;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op <> 'INSERT' then old_data := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_data := to_jsonb(new); end if;

  if tg_table_name = 'organizations' then
    organization_value := coalesce((new_data ->> 'id')::uuid, (old_data ->> 'id')::uuid);
  else
    organization_value := coalesce((new_data ->> 'organization_id')::uuid, (old_data ->> 'organization_id')::uuid);
  end if;

  entity_value := coalesce((new_data ->> 'id')::uuid, (old_data ->> 'id')::uuid, organization_value);

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
    into changed_fields
    from (
      select field_name
      from jsonb_object_keys(old_data || new_data) as fields(field_name)
      where old_data -> field_name is distinct from new_data -> field_name
        and field_name not in ('updated_at')
    ) as changed;
  end if;

  select profile.display_name, profile.email
  into actor_name, actor_email
  from public.user_profiles as profile
  where profile.user_id = actor_id;

  select member.role into actor_role
  from public.organization_members as member
  where member.organization_id = organization_value
    and member.user_id = actor_id;

  action_value := case
    when tg_table_name = 'sales' and tg_op = 'UPDATE' and old_data ->> 'status' = 'completed' and new_data ->> 'status' = 'cancelled' then 'cancel_sale'
    when tg_table_name = 'sales' and tg_op = 'UPDATE' and old_data ->> 'status' = 'draft' and new_data ->> 'status' = 'completed' then 'create_sale'
    when tg_table_name = 'expenses' and tg_op = 'UPDATE' and old_data ->> 'status' = 'posted' and new_data ->> 'status' = 'cancelled' then 'cancel_expense'
    when tg_table_name = 'inventory_movements' and tg_op = 'INSERT' and new_data ->> 'kind' = 'adjustment' then 'stock_adjustment'
    when tg_table_name = 'organization_members' and tg_op = 'UPDATE' and old_data ->> 'role' is distinct from new_data ->> 'role' then 'change_role'
    when tg_table_name = 'organization_members' and tg_op = 'UPDATE' and old_data ->> 'is_active' is distinct from new_data ->> 'is_active' then 'change_member_status'
    else lower(tg_op) || '_' || tg_table_name
  end;

  description_value := case
    when action_value = 'create_sale' then format('Venta registrada por %s', coalesce(actor_name, actor_email, 'sistema'))
    when action_value = 'cancel_sale' then format('Venta anulada por %s', coalesce(actor_name, actor_email, 'sistema'))
    when action_value = 'cancel_expense' then format('Gasto anulado por %s', coalesce(actor_name, actor_email, 'sistema'))
    when action_value = 'stock_adjustment' then format('Ajuste manual de stock por %s', coalesce(actor_name, actor_email, 'sistema'))
    else format('%s sobre %s', lower(tg_op), tg_table_name)
  end;

  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  values (
    organization_value,
    actor_id,
    action_value,
    tg_table_name,
    entity_value,
    jsonb_strip_nulls(jsonb_build_object(
      'operation', lower(tg_op),
      'description', description_value,
      'actor_name', actor_name,
      'actor_email', actor_email,
      'actor_role', actor_role,
      'changed_fields', changed_fields,
      'status_before', old_data ->> 'status',
      'status_after', new_data ->> 'status',
      'subject_user_id', coalesce(new_data ->> 'user_id', old_data ->> 'user_id'),
      'before', old_data,
      'after', new_data
    ))
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.record_login()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_name text;
  actor_email text;
  inserted_count integer;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  update public.user_profiles set last_login_at = now() where user_id = actor_id;
  select display_name, email into actor_name, actor_email
  from public.user_profiles where user_id = actor_id;

  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  select
    member.organization_id,
    actor_id,
    'login',
    'auth_session',
    actor_id,
    jsonb_strip_nulls(jsonb_build_object(
      'description', 'Inicio de sesion',
      'actor_name', actor_name,
      'actor_email', actor_email,
      'actor_role', member.role
    ))
  from public.organization_members as member
  where member.user_id = actor_id and member.is_active;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.record_login() from public, anon;
grant execute on function public.record_login() to authenticated, service_role;

-- Audit rows remain immutable even for administrators.
revoke insert, update, delete on public.audit_logs from authenticated;
