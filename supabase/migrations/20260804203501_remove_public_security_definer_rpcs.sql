create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_email_normalized_check
    check (email is null or email = lower(trim(email)))
);

create function private.sync_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, email, created_at, updated_at)
  values (
    new.id,
    lower(trim(new.email)),
    coalesce(new.created_at, now()),
    coalesce(new.updated_at, now())
  )
  on conflict (user_id)
  do update
    set email = excluded.email,
        updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function private.sync_user_profile() from public, anon, authenticated;

insert into public.user_profiles (user_id, email, created_at, updated_at)
select
  id,
  lower(trim(email)),
  coalesce(created_at, now()),
  coalesce(updated_at, now())
from auth.users
on conflict (user_id)
do update
  set email = excluded.email,
      updated_at = excluded.updated_at;

create trigger sync_user_profile
after insert or update of email on auth.users
for each row execute function private.sync_user_profile();

alter table public.user_profiles enable row level security;

create policy "users and organization administrators read profiles"
on public.user_profiles for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.organization_members as member
    where member.user_id = (select auth.uid())
      and member.is_active
      and member.role in ('owner', 'admin')
  )
);

grant select on public.user_profiles to authenticated;
grant all privileges on public.user_profiles to service_role;

-- The function needs only this private read. The private schema is not exposed
-- through the Data API, so callers can access the singleton only through RPC.
grant select on private.organization_bootstrap_guard to authenticated;

create or replace function public.can_bootstrap_organization()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and not exists (
      select 1
      from private.organization_bootstrap_guard
      where singleton
    );
$$;

create or replace function public.add_organization_member_by_email(
  p_organization_id uuid,
  p_email text,
  p_role public.app_role
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  if not private.has_org_role(
    p_organization_id,
    array['owner']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners can manage organization members';
  end if;

  perform 1
  from public.organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Organization was not found';
  end if;

  -- Recheck after acquiring the organization lock so a concurrent role change
  -- cannot authorize a stale owner session.
  if not private.has_org_role(
    p_organization_id,
    array['owner']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners can manage organization members';
  end if;

  if p_email is null or position('@' in trim(p_email)) < 2 then
    raise exception using errcode = '22023', message = 'A valid account email is required';
  end if;

  if p_role is null then
    raise exception using errcode = '22023', message = 'A member role is required';
  end if;

  select profile.user_id
  into target_user_id
  from public.user_profiles as profile
  where profile.email = lower(trim(p_email))
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No registered user exists with that email';
  end if;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    is_active
  )
  values (
    p_organization_id,
    target_user_id,
    p_role,
    true
  )
  on conflict (organization_id, user_id)
  do update
    set role = excluded.role,
        is_active = true,
        updated_at = now();

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
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  if not private.has_org_role(
    p_organization_id,
    array['owner']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners can manage organization members';
  end if;

  perform 1
  from public.organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Organization was not found';
  end if;

  if not private.has_org_role(
    p_organization_id,
    array['owner']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners can manage organization members';
  end if;

  if p_role is null or p_is_active is null then
    raise exception using errcode = '22023', message = 'Role and active status are required';
  end if;

  update public.organization_members
  set role = p_role,
      is_active = p_is_active,
      updated_at = now()
  where organization_id = p_organization_id
    and user_id = p_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Organization member was not found';
  end if;

  return p_user_id;
end;
$$;

create or replace function public.list_organization_members(
  p_organization_id uuid
)
returns table (
  user_id uuid,
  email text,
  role public.app_role,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  if not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners and administrators can list organization members';
  end if;

  return query
  select
    member.user_id,
    profile.email,
    member.role,
    member.is_active,
    member.created_at
  from public.organization_members as member
  join public.user_profiles as profile on profile.user_id = member.user_id
  where member.organization_id = p_organization_id
  order by
    case member.role when 'owner' then 1 when 'admin' then 2 else 3 end,
    profile.email;
end;
$$;

create function private.guard_import_batch_finalization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  counted_issues integer;
begin
  if (select auth.uid()) is not null
    and not private.has_org_role(
      old.organization_id,
      array['owner', 'admin']::public.app_role[]
    ) then
    raise exception using errcode = '42501', message = 'Only owners and administrators can finalize imports';
  end if;

  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.filename is distinct from old.filename
    or new.file_hash is distinct from old.file_hash
    or new.total_rows is distinct from old.total_rows
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'Import batch identity and source fields are immutable';
  end if;

  if old.status <> 'processing' then
    raise exception using errcode = '23514', message = 'Import batch was already finalized';
  end if;

  if new.status = 'processing' then
    raise exception using errcode = '23514', message = 'Import batch updates must finalize the batch';
  end if;

  if new.imported_rows < 0 or new.imported_rows > old.total_rows then
    raise exception using errcode = '22023', message = 'Imported row count is invalid';
  end if;

  if new.summary is null or jsonb_typeof(new.summary) <> 'object' then
    raise exception using errcode = '22023', message = 'Import summary must be a JSON object';
  end if;

  select count(*)
  into counted_issues
  from public.import_issues
  where batch_id = old.id
    and organization_id = old.organization_id;

  new.issue_count := counted_issues;
  new.status := case
    when new.status = 'failed' then 'failed'::public.import_batch_status
    when counted_issues > 0 then 'completed_with_issues'::public.import_batch_status
    else 'completed'::public.import_batch_status
  end;
  new.completed_at := now();

  return new;
end;
$$;

revoke all on function private.guard_import_batch_finalization()
  from public, anon, authenticated;

create trigger guard_import_batch_finalization
before update on public.import_batches
for each row execute function private.guard_import_batch_finalization();

create policy "owners and admins finalize import batches"
on public.import_batches for update
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

grant update (status, imported_rows, issue_count, summary, completed_at)
on public.import_batches to authenticated;

create or replace function public.finalize_import_batch(
  p_batch_id uuid,
  p_imported_rows integer,
  p_summary jsonb default '{}'::jsonb,
  p_failed boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization_id uuid;
  batch_total_rows integer;
  batch_status public.import_batch_status;
  counted_issues integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  select organization_id, total_rows, status
  into target_organization_id, batch_total_rows, batch_status
  from public.import_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Import batch was not found';
  end if;

  if not private.has_org_role(
    target_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners and administrators can finalize imports';
  end if;

  if batch_status <> 'processing' then
    raise exception using errcode = '23514', message = 'Import batch was already finalized';
  end if;

  if p_imported_rows is null
    or p_imported_rows < 0
    or p_imported_rows > batch_total_rows then
    raise exception using errcode = '22023', message = 'Imported row count is invalid';
  end if;

  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception using errcode = '22023', message = 'Import summary must be a JSON object';
  end if;

  if p_failed is null then
    raise exception using errcode = '22023', message = 'Import failure flag is required';
  end if;

  select count(*)
  into counted_issues
  from public.import_issues
  where batch_id = p_batch_id
    and organization_id = target_organization_id;

  update public.import_batches
  set status = case
        when p_failed then 'failed'::public.import_batch_status
        when counted_issues > 0 then 'completed_with_issues'::public.import_batch_status
        else 'completed'::public.import_batch_status
      end,
      imported_rows = p_imported_rows,
      issue_count = counted_issues,
      summary = p_summary,
      completed_at = now()
  where id = p_batch_id;

  return p_batch_id;
end;
$$;

-- Sales always capture the catalog price and cost at creation time. Neither
-- value is client-controlled, even when sale_items is written directly.
create or replace function private.guard_sale_item_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_sale_id uuid := coalesce(new.sale_id, old.sale_id);
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  captured_product_cost numeric(14, 2);
  captured_retail_price numeric(14, 2);
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if (select auth.uid()) is not null
    and not private.can_edit_sale(target_organization_id, target_sale_id) then
    raise exception using errcode = '42501', message = 'Sale items can only be changed while an authorized draft is open';
  end if;

  if tg_op = 'UPDATE'
    and (
      new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.sale_id is distinct from old.sale_id
      or new.product_id is distinct from old.product_id
      or new.unit_price is distinct from old.unit_price
      or new.unit_cost is distinct from old.unit_cost
    ) then
    raise exception using errcode = '42501', message = 'Sale item identity, price, and captured cost fields are immutable';
  end if;

  if tg_op = 'INSERT' then
    select cost_price, retail_price
    into captured_product_cost, captured_retail_price
    from public.products
    where id = new.product_id
      and organization_id = new.organization_id
      and is_active;

    if not found then
      raise exception using errcode = '23503', message = 'Sale product is missing, inactive, or belongs to another organization';
    end if;

    new.unit_cost := captured_product_cost;
    new.unit_price := captured_retail_price;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

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
security invoker
set search_path = ''
as $$
declare
  sale_id uuid;
  inserted_count integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Organization membership is required';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'A sale requires a non-empty items array';
  end if;

  if p_discount is null or p_discount < 0 then
    raise exception using errcode = '22023', message = 'Sale discount must be zero or greater';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as input(
      product_id uuid,
      quantity numeric,
      discount numeric
    )
    where product_id is null
      or quantity is null
      or quantity <= 0
      or (discount is not null and discount < 0)
  ) then
    raise exception using errcode = '22023', message = 'Sale item values are invalid';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_items) as input(product_id uuid)
  ) <> (
    select count(distinct product_id)
    from jsonb_to_recordset(p_items) as input(product_id uuid)
  ) then
    raise exception using errcode = '22023', message = 'Each product can appear only once per sale';
  end if;

  insert into public.sales (
    organization_id,
    customer_id,
    payment_method_id,
    reference,
    occurred_at,
    notes,
    created_by
  )
  values (
    p_organization_id,
    p_customer_id,
    p_payment_method_id,
    nullif(trim(p_reference), ''),
    coalesce(p_occurred_at, now()),
    nullif(trim(p_notes), ''),
    (select auth.uid())
  )
  returning id into sale_id;

  insert into public.sale_items (
    organization_id,
    sale_id,
    product_id,
    quantity,
    unit_price,
    unit_cost,
    discount
  )
  select
    p_organization_id,
    sale_id,
    product.id,
    input.quantity,
    product.retail_price,
    product.cost_price,
    coalesce(input.discount, 0)
  from jsonb_to_recordset(p_items) as input(
    product_id uuid,
    quantity numeric,
    discount numeric
  )
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

-- Purchasing mutations are owner/admin only. Staff retain the existing SELECT
-- policies for operational visibility.
drop policy "members create purchase orders" on public.purchase_orders;
drop policy "creators and administrators update purchase orders" on public.purchase_orders;
drop policy "authorized users insert purchase order items" on public.purchase_order_items;
drop policy "authorized users update purchase order items" on public.purchase_order_items;
drop policy "authorized users delete purchase order items" on public.purchase_order_items;
drop policy "members create purchase receipts" on public.purchase_receipts;

create policy "owners and admins create purchase orders"
on public.purchase_orders for insert
to authenticated
with check (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  and created_by = (select auth.uid())
  and status = 'draft'
);

create policy "owners and admins update purchase orders"
on public.purchase_orders for update
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins insert purchase order items"
on public.purchase_order_items for insert
to authenticated
with check (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  and private.can_edit_purchase_order(organization_id, purchase_order_id)
);

create policy "owners and admins update purchase order items"
on public.purchase_order_items for update
to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  and private.can_edit_purchase_order(organization_id, purchase_order_id)
)
with check (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  and private.can_edit_purchase_order(organization_id, purchase_order_id)
);

create policy "owners and admins delete purchase order items"
on public.purchase_order_items for delete
to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  and private.can_edit_purchase_order(organization_id, purchase_order_id)
);

create policy "owners and admins create purchase receipts"
on public.purchase_receipts for insert
to authenticated
with check (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
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
    private.has_org_role(
      target_organization_id,
      array['owner', 'admin']::public.app_role[]
    )
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
    if not private.has_org_role(
      new.organization_id,
      array['owner', 'admin']::public.app_role[]
    ) then
      raise exception using errcode = '42501', message = 'Only owners and administrators can receive purchase orders';
    end if;
    new.received_by := actor_id;
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

  if not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners and administrators can create purchase orders';
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

  if not private.has_org_role(
    order_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners and administrators can receive purchase orders';
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
