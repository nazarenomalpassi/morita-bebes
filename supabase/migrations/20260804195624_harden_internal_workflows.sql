-- Harden operational writes around append-only inventory movements. Public RPCs
-- remain security invoker; privileged effects are produced by checked triggers.

create type public.import_batch_status as enum (
  'processing',
  'completed',
  'completed_with_issues',
  'failed'
);

create type public.import_issue_severity as enum ('warning', 'error');

do $$
begin
  if exists (select 1 from public.products where current_stock < 0) then
    raise exception 'Negative product stock must be reconciled before this migration';
  end if;
end;
$$;

alter table public.products
  add column target_stock numeric(14, 3),
  add constraint products_current_stock_nonnegative_check
  check (current_stock >= 0),
  add constraint products_target_stock_check
  check (target_stock is null or target_stock >= min_stock);

create index products_org_target_stock_idx
  on public.products (organization_id, default_supplier_id, name)
  where is_active and target_stock is not null;

alter table public.inventory_movements
  add constraint inventory_movements_direction_check
  check (
    kind = 'adjustment'
    or (kind in ('initial', 'purchase', 'return_in') and quantity_delta > 0)
    or (kind in ('sale', 'return_out', 'loss') and quantity_delta < 0)
  );

alter table public.sales
  add column cancellation_reason text,
  add constraint sales_cancellation_reason_check
  check (
    cancellation_reason is null
    or char_length(trim(cancellation_reason)) between 3 and 500
  );

alter table public.sale_items
  add column unit_cost numeric(14, 2) not null default 0,
  add constraint sale_items_unit_cost_nonnegative_check
  check (unit_cost >= 0);

do $$
begin
  if exists (
    select 1
    from public.sale_items
    group by sale_id, product_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate products in existing sales must be consolidated before this migration';
  end if;
end;
$$;

create unique index sale_items_sale_product_key
  on public.sale_items (sale_id, product_id);

create unique index inventory_stock_adjustment_request_key
  on public.inventory_movements (organization_id, reference_id)
  where reference_type = 'stock_adjustment' and reference_id is not null;

create unique index inventory_sale_product_reference_key
  on public.inventory_movements (
    organization_id,
    reference_type,
    reference_id,
    product_id
  )
  where reference_type in ('sale', 'sale_cancellation', 'purchase_receipt')
    and reference_id is not null;

create index sales_org_creator_status_idx
  on public.sales (organization_id, created_by, status, occurred_at desc);

create index purchase_orders_org_creator_status_idx
  on public.purchase_orders (organization_id, created_by, status, created_at desc);

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null,
  received_by uuid not null references auth.users(id) on delete restrict,
  items jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint purchase_receipts_id_org_unique unique (id, organization_id),
  constraint purchase_receipts_order_fk
    foreign key (purchase_order_id, organization_id)
    references public.purchase_orders(id, organization_id) on delete restrict,
  constraint purchase_receipts_items_array_check
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0)
);

create index purchase_receipts_order_created_idx
  on public.purchase_receipts (organization_id, purchase_order_id, created_at desc);

alter table public.purchase_receipts enable row level security;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  filename text not null check (char_length(trim(filename)) between 1 and 255),
  file_hash text not null check (file_hash ~ '^[0-9a-fA-F]{64}$'),
  status public.import_batch_status not null default 'processing',
  total_rows integer not null check (total_rows >= 0),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  issue_count integer not null default 0 check (issue_count >= 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint import_batches_id_org_unique unique (id, organization_id),
  constraint import_batches_org_hash_key unique (organization_id, file_hash),
  constraint import_batches_imported_not_above_total_check check (imported_rows <= total_rows),
  constraint import_batches_completion_check check (
    (status = 'processing' and completed_at is null)
    or (status <> 'processing' and completed_at is not null)
  )
);

create index import_batches_org_created_idx
  on public.import_batches (organization_id, created_at desc);
create index import_batches_created_by_idx
  on public.import_batches (created_by);

create table public.import_issues (
  id bigint generated always as identity primary key,
  batch_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  sku text,
  field text,
  severity public.import_issue_severity not null,
  message text not null check (char_length(trim(message)) between 1 and 1000),
  raw_data jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_data) = 'object'),
  created_at timestamptz not null default now(),
  constraint import_issues_batch_fk
    foreign key (batch_id, organization_id)
    references public.import_batches(id, organization_id) on delete cascade
);

create index import_issues_batch_row_idx
  on public.import_issues (batch_id, organization_id, row_number, id);

alter table public.import_batches enable row level security;
alter table public.import_issues enable row level security;

do $$
begin
  if (select count(*) from public.organizations) > 1 then
    raise exception 'Single-organization bootstrap cannot be enabled while multiple organizations exist';
  end if;
end;
$$;

create table private.organization_bootstrap_guard (
  singleton boolean primary key default true check (singleton),
  organization_id uuid not null unique,
  created_at timestamptz not null default now()
);

revoke all on table private.organization_bootstrap_guard from public, anon, authenticated;

insert into private.organization_bootstrap_guard (singleton, organization_id)
select true, id
from public.organizations
order by created_at, id
limit 1;

create function public.can_bootstrap_organization()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and not exists (select 1 from public.organizations);
$$;

create function private.guard_organization_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is not null then
    new.created_by := actor_id;
  elsif current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  begin
    insert into private.organization_bootstrap_guard (singleton, organization_id)
    values (true, new.id);
  exception
    when unique_violation then
      raise exception using
        errcode = '42501',
        message = 'The organization has already been bootstrapped';
  end;

  return new;
end;
$$;

create trigger guard_organization_bootstrap
before insert on public.organizations
for each row execute function private.guard_organization_bootstrap();

create or replace function private.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resulting_stock numeric(14, 3);
  existing_stock numeric(14, 3);
begin
  update public.products
  set current_stock = current_stock + new.quantity_delta,
      updated_at = now()
  where id = new.product_id
    and organization_id = new.organization_id
    and current_stock + new.quantity_delta >= 0
  returning current_stock into resulting_stock;

  if found then
    return new;
  end if;

  select current_stock
  into existing_stock
  from public.products
  where id = new.product_id
    and organization_id = new.organization_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Product does not belong to the inventory movement organization';
  end if;

  raise exception using
    errcode = '23514',
    message = format(
      'Insufficient stock for product %s: available %s, requested delta %s',
      new.product_id,
      existing_stock,
      new.quantity_delta
    );
end;
$$;

create function private.guard_product_current_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_stock is distinct from old.current_stock
    and pg_trigger_depth() < 2 then
    raise exception using
      errcode = '42501',
      message = 'current_stock is managed only through inventory movements';
  end if;

  return new;
end;
$$;

create trigger guard_product_current_stock
before update on public.products
for each row execute function private.guard_product_current_stock();

create function private.prepare_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is not null then
    new.created_by := actor_id;
  elsif current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  return new;
end;
$$;

create function private.guard_created_by_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception using errcode = '42501', message = 'created_by is immutable';
  end if;
  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'organizations',
    'expenses',
    'purchase_orders',
    'payroll_movements',
    'import_batches'
  ]
  loop
    execute format(
      'create trigger set_%1$s_created_by before insert on public.%1$I
       for each row execute function private.prepare_created_by()',
      target_table
    );
  end loop;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'organizations',
    'expenses',
    'payroll_movements',
    'import_batches'
  ]
  loop
    execute format(
      'create trigger guard_%1$s_created_by before update on public.%1$I
       for each row execute function private.guard_created_by_immutable()',
      target_table
    );
  end loop;
end;
$$;

create function private.prepare_inventory_movement()
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
      if not private.has_org_role(
        new.organization_id,
        array['owner', 'admin']::public.app_role[]
      ) then
        raise exception using
          errcode = '42501',
          message = 'Only owners and administrators can add inventory adjustments';
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

create trigger prepare_inventory_movement
before insert on public.inventory_movements
for each row execute function private.prepare_inventory_movement();

create function private.reject_inventory_movement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'Inventory movements are append-only';
end;
$$;

create trigger reject_inventory_movement_mutation
before update or delete on public.inventory_movements
for each row execute function private.reject_inventory_movement_mutation();

create function private.can_edit_sale(
  target_organization_id uuid,
  target_sale_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sales
    where id = target_sale_id
      and organization_id = target_organization_id
      and status = 'draft'
      and (
        created_by = (select auth.uid())
        or private.has_org_role(
          target_organization_id,
          array['owner', 'admin']::public.app_role[]
        )
      )
  );
$$;

create function private.prepare_sale_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is not null then
    new.created_by := actor_id;
    new.status := 'draft';
    new.subtotal := 0;
    new.discount := 0;
    new.total := 0;
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
  elsif current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  return new;
end;
$$;

create trigger prepare_sale_insert
before insert on public.sales
for each row execute function private.prepare_sale_insert();

create function private.guard_sale_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  calculated_subtotal numeric(14, 2);
  item_count integer;
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by then
    raise exception using errcode = '42501', message = 'Sale identity fields are immutable';
  end if;

  if actor_id is not null and not private.is_org_member(old.organization_id) then
    raise exception using errcode = '42501', message = 'Organization membership is required';
  end if;

  if new.status = old.status then
    if old.status <> 'draft' then
      raise exception using errcode = '42501', message = 'Completed and cancelled sales are immutable';
    end if;

    if new.subtotal is distinct from old.subtotal
      or new.discount is distinct from old.discount
      or new.total is distinct from old.total
      or new.cancelled_at is distinct from old.cancelled_at
      or new.cancelled_by is distinct from old.cancelled_by
      or new.cancellation_reason is distinct from old.cancellation_reason then
      raise exception using errcode = '42501', message = 'Sale totals and cancellation fields are workflow-managed';
    end if;

    return new;
  end if;

  if old.status = 'draft' and new.status = 'completed' then
    if actor_id is not null
      and actor_id <> old.created_by
      and not private.has_org_role(
        old.organization_id,
        array['owner', 'admin']::public.app_role[]
      ) then
      raise exception using errcode = '42501', message = 'Only the sale creator or an administrator can complete it';
    end if;

    select count(*), round(coalesce(sum(line_total), 0), 2)
    into item_count, calculated_subtotal
    from public.sale_items
    where sale_id = old.id
      and organization_id = old.organization_id;

    if item_count = 0 then
      raise exception using errcode = '23514', message = 'A sale requires at least one item';
    end if;

    if new.discount < 0 or new.discount > calculated_subtotal then
      raise exception using errcode = '23514', message = 'Sale discount exceeds its subtotal';
    end if;

    new.subtotal := calculated_subtotal;
    new.total := calculated_subtotal - new.discount;
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
    return new;
  end if;

  if old.status = 'completed' and new.status = 'cancelled' then
    if actor_id is not null and not private.has_org_role(
      old.organization_id,
      array['owner', 'admin']::public.app_role[]
    ) then
      raise exception using errcode = '42501', message = 'Only owners and administrators can cancel sales';
    end if;

    if new.cancellation_reason is null
      or char_length(trim(new.cancellation_reason)) < 3 then
      raise exception using errcode = '23514', message = 'A cancellation reason is required';
    end if;

    new.cancelled_at := now();
    new.cancelled_by := coalesce(actor_id, new.cancelled_by);
    new.subtotal := old.subtotal;
    new.discount := old.discount;
    new.total := old.total;
    return new;
  end if;

  raise exception using
    errcode = '23514',
    message = format('Invalid sale status transition: %s to %s', old.status, new.status);
end;
$$;

create trigger guard_sale_update
before update on public.sales
for each row execute function private.guard_sale_update();

create function private.guard_sale_item_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_sale_id uuid := coalesce(new.sale_id, old.sale_id);
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  captured_product_cost numeric(14, 2);
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
      or new.unit_cost is distinct from old.unit_cost
    ) then
    raise exception using errcode = '42501', message = 'Sale item identity and captured cost fields are immutable';
  end if;

  if tg_op = 'INSERT' then
    select cost_price
    into captured_product_cost
    from public.products
    where id = new.product_id
      and organization_id = new.organization_id
      and is_active;

    if not found then
      raise exception using errcode = '23503', message = 'Sale product is missing, inactive, or belongs to another organization';
    end if;

    new.unit_cost := captured_product_cost;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_sale_item_mutation
before insert or update or delete on public.sale_items
for each row execute function private.guard_sale_item_mutation();

create function private.apply_sale_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'completed' then
    insert into public.inventory_movements (
      organization_id,
      product_id,
      kind,
      quantity_delta,
      reference_type,
      reference_id,
      notes,
      occurred_at,
      created_by
    )
    select
      new.organization_id,
      product_id,
      'sale'::public.inventory_movement_kind,
      -sum(quantity),
      'sale',
      new.id,
      'Venta completada',
      new.occurred_at,
      new.created_by
    from public.sale_items
    where sale_id = new.id
      and organization_id = new.organization_id
    group by product_id;
  elsif old.status = 'completed' and new.status = 'cancelled' then
    insert into public.inventory_movements (
      organization_id,
      product_id,
      kind,
      quantity_delta,
      reference_type,
      reference_id,
      notes,
      occurred_at,
      created_by
    )
    select
      new.organization_id,
      product_id,
      'return_in'::public.inventory_movement_kind,
      sum(quantity),
      'sale_cancellation',
      new.id,
      new.cancellation_reason,
      now(),
      new.cancelled_by
    from public.sale_items
    where sale_id = new.id
      and organization_id = new.organization_id
    group by product_id;
  end if;

  return new;
end;
$$;

create trigger apply_sale_inventory
after update of status on public.sales
for each row
when (old.status is distinct from new.status)
execute function private.apply_sale_inventory();

create function private.can_edit_purchase_order(
  target_organization_id uuid,
  target_purchase_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.purchase_orders
    where id = target_purchase_order_id
      and organization_id = target_organization_id
      and status = 'draft'
      and (
        created_by = (select auth.uid())
        or private.has_org_role(
          target_organization_id,
          array['owner', 'admin']::public.app_role[]
        )
      )
  );
$$;

create function private.prepare_purchase_order_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is not null then
    new.created_by := actor_id;
    new.status := 'draft';
    new.received_at := null;
  elsif current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  return new;
end;
$$;

drop trigger set_purchase_orders_created_by on public.purchase_orders;

create trigger prepare_purchase_order_insert
before insert on public.purchase_orders
for each row execute function private.prepare_purchase_order_insert();

create function private.guard_purchase_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by then
    raise exception using errcode = '42501', message = 'Purchase order identity fields are immutable';
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.received_at is distinct from old.received_at then
    raise exception using errcode = '42501', message = 'Receipt timestamps are workflow-managed';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'sent' then
      return new;
    end if;

    if new.status = 'cancelled'
      and old.status in ('draft', 'sent', 'partial')
      and (
        actor_id is null
        or private.has_org_role(
          old.organization_id,
          array['owner', 'admin']::public.app_role[]
        )
      ) then
      return new;
    end if;

    raise exception using
      errcode = '23514',
      message = 'Purchase order receipt states are managed by receive_purchase_order';
  end if;

  if old.status in ('partial', 'received', 'cancelled') then
    raise exception using errcode = '42501', message = 'Closed purchase orders are immutable';
  end if;

  return new;
end;
$$;

create trigger guard_purchase_order_update
before update on public.purchase_orders
for each row execute function private.guard_purchase_order_update();

create function private.guard_purchase_order_item_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_order_id uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if (select auth.uid()) is not null
    and not private.can_edit_purchase_order(target_organization_id, target_order_id) then
    raise exception using errcode = '42501', message = 'Purchase order items can only be changed in an authorized draft';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.purchase_order_id is distinct from old.purchase_order_id then
      raise exception using errcode = '42501', message = 'Purchase order item identity fields are immutable';
    end if;

    if new.quantity_received is distinct from old.quantity_received then
      raise exception using errcode = '42501', message = 'Received quantities are workflow-managed';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_purchase_order_item_mutation
before insert or update or delete on public.purchase_order_items
for each row execute function private.guard_purchase_order_item_mutation();

create function private.prepare_purchase_receipt()
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

create trigger prepare_purchase_receipt
before insert on public.purchase_receipts
for each row execute function private.prepare_purchase_receipt();

create function private.process_purchase_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  input_count integer;
  distinct_count integer;
  receipt_item record;
  order_item public.purchase_order_items%rowtype;
  order_status public.purchase_order_status;
  all_received boolean;
  calculated_total numeric(14, 2);
begin
  if (select auth.uid()) is not null then
    if new.received_by <> (select auth.uid())
      or not private.is_org_member(new.organization_id) then
      raise exception using errcode = '42501', message = 'Invalid purchase receipt actor';
    end if;
  end if;

  select status
  into order_status
  from public.purchase_orders
  where id = new.purchase_order_id
    and organization_id = new.organization_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Purchase order was not found';
  end if;

  if order_status not in ('sent', 'partial') then
    raise exception using errcode = '23514', message = 'Only sent or partially received orders can receive merchandise';
  end if;

  select count(*), count(distinct purchase_order_item_id)
  into input_count, distinct_count
  from jsonb_to_recordset(new.items) as input(
    purchase_order_item_id uuid,
    quantity numeric,
    unit_cost numeric
  );

  if input_count <> jsonb_array_length(new.items)
    or input_count <> distinct_count then
    raise exception using errcode = '22023', message = 'Receipt items must contain unique purchase_order_item_id values';
  end if;

  for receipt_item in
    select purchase_order_item_id, quantity, unit_cost
    from jsonb_to_recordset(new.items) as input(
      purchase_order_item_id uuid,
      quantity numeric,
      unit_cost numeric
    )
  loop
    if receipt_item.purchase_order_item_id is null
      or receipt_item.quantity is null
      or receipt_item.quantity <= 0
      or (receipt_item.unit_cost is not null and receipt_item.unit_cost < 0) then
      raise exception using errcode = '22023', message = 'Receipt item values are invalid';
    end if;

    select *
    into order_item
    from public.purchase_order_items
    where id = receipt_item.purchase_order_item_id
      and organization_id = new.organization_id
      and purchase_order_id = new.purchase_order_id
    for update;

    if not found then
      raise exception using errcode = '23503', message = 'Receipt item does not belong to this purchase order';
    end if;

    if order_item.quantity_received + receipt_item.quantity > order_item.quantity_ordered then
      raise exception using errcode = '23514', message = 'Received quantity exceeds the pending order quantity';
    end if;

    update public.purchase_order_items
    set quantity_received = quantity_received + receipt_item.quantity,
        unit_cost = coalesce(receipt_item.unit_cost, unit_cost),
        updated_at = now()
    where id = order_item.id;

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
      new.organization_id,
      order_item.product_id,
      'purchase',
      receipt_item.quantity,
      coalesce(receipt_item.unit_cost, order_item.unit_cost),
      'purchase_receipt',
      new.id,
      new.notes,
      new.received_by
    );
  end loop;

  select
    bool_and(quantity_received = quantity_ordered),
    round(coalesce(sum(quantity_ordered * unit_cost), 0), 2)
  into all_received, calculated_total
  from public.purchase_order_items
  where organization_id = new.organization_id
    and purchase_order_id = new.purchase_order_id;

  update public.purchase_orders
  set status = case
        when all_received then 'received'::public.purchase_order_status
        else 'partial'::public.purchase_order_status
      end,
      received_at = case when all_received then now() else null end,
      estimated_total = calculated_total,
      updated_at = now()
  where id = new.purchase_order_id
    and organization_id = new.organization_id;

  return new;
end;
$$;

create trigger process_purchase_receipt
after insert on public.purchase_receipts
for each row execute function private.process_purchase_receipt();

create function private.reject_purchase_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Purchase receipts are append-only';
end;
$$;

create trigger reject_purchase_receipt_mutation
before update or delete on public.purchase_receipts
for each row execute function private.reject_purchase_receipt_mutation();

create function private.guard_import_issue_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_status public.import_batch_status;
begin
  if (select auth.uid()) is not null
    and not private.has_org_role(
      new.organization_id,
      array['owner', 'admin']::public.app_role[]
    ) then
    raise exception using errcode = '42501', message = 'Only owners and administrators can record import issues';
  end if;

  select status
  into batch_status
  from public.import_batches
  where id = new.batch_id
    and organization_id = new.organization_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Import batch was not found';
  end if;

  if batch_status <> 'processing' then
    raise exception using errcode = '23514', message = 'Import issues can only be added while a batch is processing';
  end if;

  return new;
end;
$$;

create trigger guard_import_issue_insert
before insert on public.import_issues
for each row execute function private.guard_import_issue_insert();

create function private.audit_row_change()
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
  changed_fields jsonb := '[]'::jsonb;
  audit_metadata jsonb;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op <> 'INSERT' then
    old_data := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_data := to_jsonb(new);
  end if;

  if tg_table_name = 'organizations' then
    organization_value := coalesce(
      (new_data ->> 'id')::uuid,
      (old_data ->> 'id')::uuid
    );
  else
    organization_value := coalesce(
      (new_data ->> 'organization_id')::uuid,
      (old_data ->> 'organization_id')::uuid
    );
  end if;

  entity_value := coalesce(
    (new_data ->> 'id')::uuid,
    (old_data ->> 'id')::uuid,
    organization_value
  );

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(field_name order by field_name), '[]'::jsonb)
    into changed_fields
    from (
      select field_name
      from jsonb_object_keys(old_data || new_data) as fields(field_name)
      where old_data -> field_name is distinct from new_data -> field_name
    ) changed;
  elsif tg_op = 'INSERT' then
    changed_fields := '[]'::jsonb;
  end if;

  audit_metadata := jsonb_strip_nulls(jsonb_build_object(
    'operation', lower(tg_op),
    'changed_fields', changed_fields,
    'status_before', old_data ->> 'status',
    'status_after', new_data ->> 'status',
    'subject_user_id', coalesce(new_data ->> 'user_id', old_data ->> 'user_id')
  ));

  insert into public.audit_logs (
    organization_id,
    user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    organization_value,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    entity_value,
    audit_metadata
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'organization_members',
    'categories',
    'brands',
    'suppliers',
    'products',
    'payment_methods',
    'customers',
    'sales',
    'sale_items',
    'inventory_movements',
    'expense_categories',
    'expenses',
    'purchase_orders',
    'purchase_order_items',
    'purchase_receipts',
    'import_batches',
    'employees',
    'payroll_movements',
    'site_settings'
  ]
  loop
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function private.audit_row_change()',
      target_table
    );
  end loop;

create trigger audit_organizations
  after insert or update on public.organizations
  for each row execute function private.audit_row_change();
end;
$$;

create function private.guard_last_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  remaining_owner_count integer;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  perform 1
  from public.organizations
  where id = target_organization_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Organization was not found';
  end if;

  if tg_op = 'UPDATE'
    and (
      new.organization_id is distinct from old.organization_id
      or new.user_id is distinct from old.user_id
    ) then
    raise exception using errcode = '42501', message = 'Organization membership identity fields are immutable';
  end if;

  if old.role = 'owner'
    and old.is_active
    and (
      tg_op = 'DELETE'
      or new.role <> 'owner'
      or not new.is_active
    ) then
    select count(*)
    into remaining_owner_count
    from public.organization_members
    where organization_id = target_organization_id
      and role = 'owner'
      and is_active
      and user_id <> old.user_id;

    if remaining_owner_count = 0 then
      raise exception using
        errcode = '23514',
        message = 'An organization must keep at least one active owner';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_last_organization_owner
before update or delete on public.organization_members
for each row execute function private.guard_last_organization_owner();

-- Replace broad write policies with operational read access and role-aware writes.
drop policy "users create organizations" on public.organizations;
drop policy "owners delete organizations" on public.organizations;
drop policy "members manage categories" on public.categories;
drop policy "members manage brands" on public.brands;
drop policy "members manage suppliers" on public.suppliers;
drop policy "members manage products" on public.products;
drop policy "members manage payment methods" on public.payment_methods;
drop policy "members manage sales" on public.sales;
drop policy "members manage sale items" on public.sale_items;
drop policy "members add inventory movements" on public.inventory_movements;
drop policy "members manage expense categories" on public.expense_categories;
drop policy "members manage expenses" on public.expenses;
drop policy "members manage purchase orders" on public.purchase_orders;
drop policy "members manage purchase order items" on public.purchase_order_items;

create policy "first authenticated user bootstraps organization"
on public.organizations for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and public.can_bootstrap_organization()
);

create policy "members read categories"
on public.categories for select to authenticated
using (private.is_org_member(organization_id));
create policy "owners and admins insert categories"
on public.categories for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins update categories"
on public.categories for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins delete categories"
on public.categories for delete to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "members read brands"
on public.brands for select to authenticated
using (private.is_org_member(organization_id));
create policy "owners and admins insert brands"
on public.brands for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins update brands"
on public.brands for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins delete brands"
on public.brands for delete to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "members read suppliers"
on public.suppliers for select to authenticated
using (private.is_org_member(organization_id));
create policy "owners and admins insert suppliers"
on public.suppliers for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins update suppliers"
on public.suppliers for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins delete suppliers"
on public.suppliers for delete to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "members read products"
on public.products for select to authenticated
using (private.is_org_member(organization_id));
create policy "owners and admins insert products"
on public.products for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins update products"
on public.products for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins delete products"
on public.products for delete to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "members read payment methods"
on public.payment_methods for select to authenticated
using (private.is_org_member(organization_id));
create policy "owners and admins insert payment methods"
on public.payment_methods for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins update payment methods"
on public.payment_methods for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins delete payment methods"
on public.payment_methods for delete to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "members read expense categories"
on public.expense_categories for select to authenticated
using (private.is_org_member(organization_id));
create policy "owners and admins insert expense categories"
on public.expense_categories for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins update expense categories"
on public.expense_categories for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins delete expense categories"
on public.expense_categories for delete to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "members read sales"
on public.sales for select to authenticated
using (private.is_org_member(organization_id));
create policy "members create sales"
on public.sales for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and created_by = (select auth.uid())
  and status = 'draft'
);
create policy "creators and administrators update sales"
on public.sales for update to authenticated
using (
  private.is_org_member(organization_id)
  and (
    (status = 'draft' and created_by = (select auth.uid()))
    or private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  )
)
with check (
  private.is_org_member(organization_id)
  and (
    created_by = (select auth.uid())
    or private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  )
);
create policy "owners and admins delete draft sales"
on public.sales for delete to authenticated
using (
  status = 'draft'
  and private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
);

create policy "members read sale items"
on public.sale_items for select to authenticated
using (private.is_org_member(organization_id));
create policy "authorized users insert draft sale items"
on public.sale_items for insert to authenticated
with check (private.can_edit_sale(organization_id, sale_id));
create policy "authorized users update draft sale items"
on public.sale_items for update to authenticated
using (private.can_edit_sale(organization_id, sale_id))
with check (private.can_edit_sale(organization_id, sale_id));
create policy "authorized users delete draft sale items"
on public.sale_items for delete to authenticated
using (private.can_edit_sale(organization_id, sale_id));

create policy "owners and admins add inventory adjustments"
on public.inventory_movements for insert to authenticated
with check (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  and created_by = (select auth.uid())
  and coalesce(reference_type, '') not in ('sale', 'sale_cancellation', 'purchase_receipt')
  and kind not in ('sale', 'purchase')
);

create policy "members read expenses"
on public.expenses for select to authenticated
using (private.is_org_member(organization_id));
create policy "members create expenses"
on public.expenses for insert to authenticated
with check (private.is_org_member(organization_id) and created_by = (select auth.uid()));
create policy "owners and admins update expenses"
on public.expenses for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins delete expenses"
on public.expenses for delete to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "members read purchase orders"
on public.purchase_orders for select to authenticated
using (private.is_org_member(organization_id));
create policy "members create purchase orders"
on public.purchase_orders for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and created_by = (select auth.uid())
  and status = 'draft'
);
create policy "creators and administrators update purchase orders"
on public.purchase_orders for update to authenticated
using (
  private.is_org_member(organization_id)
  and (
    created_by = (select auth.uid())
    or private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  )
)
with check (
  private.is_org_member(organization_id)
  and (
    created_by = (select auth.uid())
    or private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  )
);
create policy "owners and admins delete purchase orders"
on public.purchase_orders for delete to authenticated
using (
  status in ('draft', 'cancelled')
  and private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
);

create policy "members read purchase order items"
on public.purchase_order_items for select to authenticated
using (private.is_org_member(organization_id));
create policy "authorized users insert purchase order items"
on public.purchase_order_items for insert to authenticated
with check (private.can_edit_purchase_order(organization_id, purchase_order_id));
create policy "authorized users update purchase order items"
on public.purchase_order_items for update to authenticated
using (private.can_edit_purchase_order(organization_id, purchase_order_id))
with check (private.can_edit_purchase_order(organization_id, purchase_order_id));
create policy "authorized users delete purchase order items"
on public.purchase_order_items for delete to authenticated
using (private.can_edit_purchase_order(organization_id, purchase_order_id));

create policy "members read purchase receipts"
on public.purchase_receipts for select to authenticated
using (private.is_org_member(organization_id));
create policy "members create purchase receipts"
on public.purchase_receipts for insert to authenticated
with check (
  private.is_org_member(organization_id)
  and received_by = (select auth.uid())
);

create policy "owners and admins read import batches"
on public.import_batches for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins create import batches"
on public.import_batches for insert to authenticated
with check (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  and created_by = (select auth.uid())
  and status = 'processing'
);

create policy "owners and admins read import issues"
on public.import_issues for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy "owners and admins create import issues"
on public.import_issues for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

-- current_stock remains readable but cannot be directly updated through the API.
revoke update on public.products from authenticated;
grant update (
  category_id,
  brand_id,
  default_supplier_id,
  name,
  sku,
  barcode,
  description,
  cost_price,
  retail_price,
  wholesale_price,
  wholesale_min_quantity,
  min_stock,
  target_stock,
  unit,
  image_path,
  is_active,
  is_published,
  is_featured
) on public.products to authenticated;

grant select, insert on public.purchase_receipts to authenticated;
grant all privileges on public.purchase_receipts to service_role;
grant select, insert on public.import_batches, public.import_issues to authenticated;
grant all privileges on public.import_batches, public.import_issues to service_role;
grant usage, select on sequence public.import_issues_id_seq to authenticated, service_role;

create function public.create_sale(
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
      unit_price numeric,
      discount numeric
    )
    where product_id is null
      or quantity is null
      or quantity <= 0
      or (unit_price is not null and unit_price < 0)
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
    coalesce(input.unit_price, product.retail_price),
    product.cost_price,
    coalesce(input.discount, 0)
  from jsonb_to_recordset(p_items) as input(
    product_id uuid,
    quantity numeric,
    unit_price numeric,
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

create function public.cancel_sale(
  p_sale_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sale_organization_id uuid;
  current_status public.sale_status;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  select organization_id, status
  into sale_organization_id, current_status
  from public.sales
  where id = p_sale_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Sale was not found';
  end if;

  if not private.has_org_role(
    sale_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners and administrators can cancel sales';
  end if;

  if current_status = 'cancelled' then
    return p_sale_id;
  end if;

  update public.sales
  set cancellation_reason = nullif(trim(p_reason), ''),
      status = 'cancelled'
  where id = p_sale_id;

  return p_sale_id;
end;
$$;

create function public.create_purchase_order(
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
    array['owner', 'admin', 'staff']::public.app_role[]
  ) then
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

create function public.receive_purchase_order(
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

create function public.adjust_inventory(
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

  if not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Only owners and administrators can adjust inventory';
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

create function public.finalize_import_batch(
  p_batch_id uuid,
  p_imported_rows integer,
  p_summary jsonb default '{}'::jsonb,
  p_failed boolean default false
)
returns uuid
language plpgsql
security definer
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

create function public.add_organization_member_by_email(
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
  target_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
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

  if p_email is null or position('@' in trim(p_email)) < 2 then
    raise exception using errcode = '22023', message = 'A valid account email is required';
  end if;

  if p_role is null then
    raise exception using errcode = '22023', message = 'A member role is required';
  end if;

  select id
  into target_user_id
  from auth.users
  where lower(email) = lower(trim(p_email))
  order by created_at
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

create function public.update_organization_member(
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
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
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

create function public.list_organization_members(
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
security definer
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
    account.email::text,
    member.role,
    member.is_active,
    member.created_at
  from public.organization_members as member
  join auth.users as account on account.id = member.user_id
  where member.organization_id = p_organization_id
  order by
    case member.role when 'owner' then 1 when 'admin' then 2 else 3 end,
    lower(account.email);
end;
$$;

-- Private trigger helpers are not callable APIs. Only the three RLS helpers are
-- executable by authenticated users, and public RPCs are explicitly allowlisted.
revoke all privileges on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.app_role[]) to authenticated;
grant execute on function private.can_edit_sale(uuid, uuid) to authenticated;
grant execute on function private.can_edit_purchase_order(uuid, uuid) to authenticated;

revoke all on function public.create_sale(uuid, jsonb, uuid, uuid, numeric, text, text, timestamptz)
  from public, anon;
revoke all on function public.can_bootstrap_organization() from public, anon;
revoke all on function public.cancel_sale(uuid, text) from public, anon;
revoke all on function public.create_purchase_order(uuid, uuid, jsonb, text, date, date, text)
  from public, anon;
revoke all on function public.receive_purchase_order(uuid, jsonb, text, uuid)
  from public, anon;
revoke all on function public.adjust_inventory(uuid, uuid, numeric, text, numeric, uuid)
  from public, anon;
revoke all on function public.finalize_import_batch(uuid, integer, jsonb, boolean)
  from public, anon;
revoke all on function public.add_organization_member_by_email(uuid, text, public.app_role)
  from public, anon;
revoke all on function public.update_organization_member(uuid, uuid, public.app_role, boolean)
  from public, anon;
revoke all on function public.list_organization_members(uuid)
  from public, anon;

grant execute on function public.create_sale(uuid, jsonb, uuid, uuid, numeric, text, text, timestamptz)
  to authenticated, service_role;
grant execute on function public.can_bootstrap_organization() to authenticated;
grant execute on function public.cancel_sale(uuid, text)
  to authenticated, service_role;
grant execute on function public.create_purchase_order(uuid, uuid, jsonb, text, date, date, text)
  to authenticated, service_role;
grant execute on function public.receive_purchase_order(uuid, jsonb, text, uuid)
  to authenticated, service_role;
grant execute on function public.adjust_inventory(uuid, uuid, numeric, text, numeric, uuid)
  to authenticated, service_role;
grant execute on function public.finalize_import_batch(uuid, integer, jsonb, boolean)
  to authenticated;
grant execute on function public.add_organization_member_by_email(uuid, text, public.app_role)
  to authenticated;
grant execute on function public.update_organization_member(uuid, uuid, public.app_role, boolean)
  to authenticated;
grant execute on function public.list_organization_members(uuid)
  to authenticated;
