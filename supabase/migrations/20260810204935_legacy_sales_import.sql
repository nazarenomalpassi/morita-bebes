create table public.legacy_sale_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_name text not null,
  source_file_name text not null,
  source_file_sha256 text not null,
  total_rows integer not null check (total_rows >= 0),
  detected_sales integer not null check (detected_sales >= 0),
  imported_sales integer not null default 0 check (imported_sales >= 0),
  duplicate_sales integer not null default 0 check (duplicate_sales >= 0),
  error_sales integer not null default 0 check (error_sales >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  first_occurred_at timestamptz,
  last_occurred_at timestamptz,
  imported_total numeric(14, 2) not null default 0 check (imported_total >= 0),
  status text not null default 'processing' check (
    status in ('processing', 'completed', 'completed_with_issues', 'failed', 'rolled_back')
  ),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint legacy_sale_import_batches_id_org_unique unique (id, organization_id),
  constraint legacy_sale_import_batches_source_hash_key unique (
    organization_id,
    source_name,
    source_file_sha256
  ),
  constraint legacy_sale_import_batches_sha256_check check (
    source_file_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create index legacy_sale_import_batches_org_created_idx
  on public.legacy_sale_import_batches (organization_id, created_at desc);

create table public.legacy_sale_import_issues (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  batch_id uuid not null,
  severity text not null check (severity in ('warning', 'error')),
  source_row integer check (source_row is null or source_row >= 2),
  legacy_sale_number text,
  code text not null,
  message text not null,
  raw_data jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_data) = 'object'),
  created_at timestamptz not null default now(),
  constraint legacy_sale_import_issues_batch_fk foreign key (batch_id, organization_id)
    references public.legacy_sale_import_batches(id, organization_id) on delete cascade,
  constraint legacy_sale_import_issues_dedup_key unique (batch_id, source_row, code)
);

create index legacy_sale_import_issues_batch_severity_idx
  on public.legacy_sale_import_issues (batch_id, severity, source_row);

alter table public.legacy_sale_import_batches enable row level security;
alter table public.legacy_sale_import_issues enable row level security;

create policy "owners and admins read legacy sale import batches"
on public.legacy_sale_import_batches for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins read legacy sale import issues"
on public.legacy_sale_import_issues for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

grant select on public.legacy_sale_import_batches to authenticated, service_role;
grant select on public.legacy_sale_import_issues to authenticated, service_role;
revoke insert, update, delete on public.legacy_sale_import_batches from anon, authenticated;
revoke insert, update, delete on public.legacy_sale_import_issues from anon, authenticated;

alter table public.sales
  drop constraint sales_total_matches_subtotal_check,
  add column source text not null default 'system',
  add column import_batch_id uuid,
  add column legacy_source_key text,
  add column legacy_sale_number text,
  add column legacy_source_row integer,
  add column legacy_document_type text,
  add column legacy_point_of_sale text,
  add column legacy_document_number text,
  add column legacy_payment_method text,
  add column legacy_customer_name text,
  add column legacy_customer_tax_id text,
  add column legacy_seller_name text,
  add column legacy_status text,
  add column original_time_known boolean not null default true,
  add column item_detail_status text not null default 'complete',
  add column vat_10_5 numeric(14, 2) not null default 0 check (vat_10_5 >= 0),
  add column vat_21 numeric(14, 2) not null default 0 check (vat_21 >= 0),
  add column rounding_adjustment numeric(14, 2) not null default 0 check (abs(rounding_adjustment) <= 0.05),
  add column legacy_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_payload) = 'object'),
  add constraint sales_source_check check (source in ('system', 'legacy_import')),
  add constraint sales_item_detail_status_check check (
    item_detail_status in ('complete', 'missing_from_source', 'partial')
  ),
  add constraint sales_legacy_source_row_check check (
    legacy_source_row is null or legacy_source_row >= 2
  ),
  add constraint sales_import_batch_fk foreign key (import_batch_id, organization_id)
    references public.legacy_sale_import_batches(id, organization_id) on delete restrict,
  add constraint sales_source_fields_check check (
    (source = 'system' and import_batch_id is null and legacy_source_key is null)
    or
    (source = 'legacy_import' and import_batch_id is not null and legacy_source_key is not null)
  ),
  add constraint sales_total_matches_components_check check (
    total = subtotal + vat_10_5 + vat_21 + rounding_adjustment - discount
  );

create unique index sales_org_legacy_source_key
  on public.sales (organization_id, source, legacy_source_key)
  where source = 'legacy_import';
create index sales_import_batch_idx
  on public.sales (import_batch_id, legacy_source_row);

alter table public.sale_items
  alter column product_id drop not null,
  alter column unit_cost drop not null,
  add column legacy_product_name text,
  add column legacy_product_code text,
  add column legacy_barcode text,
  add column legacy_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_payload) = 'object'),
  add constraint sale_items_product_identity_check check (
    product_id is not null or nullif(trim(legacy_product_name), '') is not null
  );

create or replace function private.guard_sale_update()
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
    or new.created_by is distinct from old.created_by
    or new.source is distinct from old.source
    or new.import_batch_id is distinct from old.import_batch_id
    or new.legacy_source_key is distinct from old.legacy_source_key
    or new.legacy_sale_number is distinct from old.legacy_sale_number
    or new.legacy_source_row is distinct from old.legacy_source_row
    or new.legacy_document_type is distinct from old.legacy_document_type
    or new.legacy_point_of_sale is distinct from old.legacy_point_of_sale
    or new.legacy_document_number is distinct from old.legacy_document_number
    or new.legacy_payment_method is distinct from old.legacy_payment_method
    or new.legacy_customer_name is distinct from old.legacy_customer_name
    or new.legacy_customer_tax_id is distinct from old.legacy_customer_tax_id
    or new.legacy_seller_name is distinct from old.legacy_seller_name
    or new.legacy_status is distinct from old.legacy_status
    or new.original_time_known is distinct from old.original_time_known
    or new.item_detail_status is distinct from old.item_detail_status
    or new.vat_10_5 is distinct from old.vat_10_5
    or new.vat_21 is distinct from old.vat_21
    or new.rounding_adjustment is distinct from old.rounding_adjustment
    or new.legacy_payload is distinct from old.legacy_payload then
    raise exception using errcode = '42501', message = 'Sale identity and historical fields are immutable';
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
    new.vat_10_5 := 0;
    new.vat_21 := 0;
    new.rounding_adjustment := 0;
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

create or replace function private.guard_sale_item_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_sale_id uuid := coalesce(new.sale_id, old.sale_id);
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_source text;
  captured_product_cost numeric(14, 2);
  captured_retail_price numeric(14, 2);
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  select sale.source
  into target_source
  from public.sales as sale
  where sale.id = target_sale_id
    and sale.organization_id = target_organization_id;

  if not found then
    raise exception using errcode = '23503', message = 'Sale is missing or belongs to another organization';
  end if;

  if target_source = 'legacy_import' then
    if (select auth.uid()) is not null then
      raise exception using errcode = '42501', message = 'Legacy sale items can only be written by the controlled importer';
    end if;

    if tg_op <> 'INSERT' then
      raise exception using errcode = '42501', message = 'Imported sale items are immutable';
    end if;

    if new.product_id is not null and not exists (
      select 1
      from public.products as product
      where product.id = new.product_id
        and product.organization_id = new.organization_id
    ) then
      raise exception using errcode = '23503', message = 'Mapped legacy product is missing or belongs to another organization';
    end if;

    return new;
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
      or new.legacy_product_name is distinct from old.legacy_product_name
      or new.legacy_product_code is distinct from old.legacy_product_code
      or new.legacy_barcode is distinct from old.legacy_barcode
      or new.legacy_payload is distinct from old.legacy_payload
    ) then
    raise exception using errcode = '42501', message = 'Sale item identity, price, and captured cost fields are immutable';
  end if;

  if tg_op = 'INSERT' then
    select product.cost_price, product.retail_price
    into captured_product_cost, captured_retail_price
    from public.products as product
    where product.id = new.product_id
      and product.organization_id = new.organization_id
      and product.is_active;

    if not found then
      raise exception using errcode = '23503', message = 'Sale product is missing, inactive, or belongs to another organization';
    end if;

    new.unit_cost := captured_product_cost;
    new.unit_price := captured_retail_price;
    new.legacy_product_name := null;
    new.legacy_product_code := null;
    new.legacy_barcode := null;
    new.legacy_payload := '{}'::jsonb;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.apply_sale_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'legacy_import' then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'completed' then
    insert into public.inventory_movements (
      organization_id, product_id, kind, quantity_delta, reference_type,
      reference_id, notes, occurred_at, created_by
    )
    select
      new.organization_id, product_id, 'sale'::public.inventory_movement_kind,
      -sum(quantity), 'sale', new.id, 'Venta completada', new.occurred_at, new.created_by
    from public.sale_items
    where sale_id = new.id
      and organization_id = new.organization_id
      and product_id is not null
    group by product_id;
  elsif old.status = 'completed' and new.status = 'cancelled' then
    insert into public.inventory_movements (
      organization_id, product_id, kind, quantity_delta, reference_type,
      reference_id, notes, occurred_at, created_by
    )
    select
      new.organization_id, product_id, 'return_in'::public.inventory_movement_kind,
      sum(quantity), 'sale_cancellation', new.id, new.cancellation_reason, now(), new.cancelled_by
    from public.sale_items
    where sale_id = new.id
      and organization_id = new.organization_id
      and product_id is not null
    group by product_id;
  end if;

  return new;
end;
$$;

drop function public.list_operational_sales(uuid, uuid, integer);
create function public.list_operational_sales(
  p_organization_id uuid,
  p_created_by uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_source text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
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
  actor_email text,
  source text,
  legacy_sale_number text,
  legacy_seller_name text,
  item_detail_status text,
  matching_count bigint
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
    coalesce(customer.name, sale.legacy_customer_name),
    coalesce(payment_method.name, sale.legacy_payment_method),
    count(item.id),
    sale.created_by,
    profile.display_name,
    profile.email,
    sale.source,
    sale.legacy_sale_number,
    sale.legacy_seller_name,
    sale.item_detail_status,
    count(*) over ()
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
    and (p_from is null or sale.occurred_at >= p_from)
    and (p_to is null or sale.occurred_at < p_to)
    and (p_source is null or sale.source = p_source)
    and (
      nullif(trim(p_search), '') is null
      or sale.reference ilike '%' || trim(p_search) || '%'
      or sale.legacy_sale_number ilike '%' || trim(p_search) || '%'
      or coalesce(customer.name, sale.legacy_customer_name, '') ilike '%' || trim(p_search) || '%'
      or coalesce(payment_method.name, sale.legacy_payment_method, '') ilike '%' || trim(p_search) || '%'
    )
    and (
      (actor_role in ('owner', 'admin') and (p_created_by is null or sale.created_by = p_created_by))
      or (actor_role = 'staff' and sale.created_by = actor_id)
    )
  group by sale.id, customer.name, payment_method.name, profile.display_name, profile.email
  order by sale.occurred_at desc, sale.id
  limit least(greatest(coalesce(p_limit, 100), 1), 250)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_operational_sales(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer
) from public, anon;
grant execute on function public.list_operational_sales(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer
) to authenticated, service_role;

create function private.import_legacy_sales_batch(
  p_organization_id uuid,
  p_source_name text,
  p_source_file_name text,
  p_source_file_sha256 text,
  p_total_rows integer,
  p_sales jsonb,
  p_issues jsonb default '[]'::jsonb,
  p_finalize boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id uuid;
  batch_status text;
  inserted_before integer;
  inserted_after integer;
  inserted_this_call integer;
  issue_total integer;
  error_total integer;
  warning_total integer;
  first_sale timestamptz;
  last_sale timestamptz;
  sales_total numeric(14, 2);
begin
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'Legacy sales imports require a trusted database session';
  end if;

  -- The normal insert trigger trusts auth.uid() and always opens an interactive
  -- draft. This transaction-local reset keeps the privileged importer on the
  -- historical path even when a test or maintenance session previously set JWT claims.
  perform set_config('request.jwt.claims', '{}'::text, true);

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception using errcode = '23503', message = 'Organization does not exist';
  end if;

  if nullif(trim(p_source_name), '') is null
    or nullif(trim(p_source_file_name), '') is null
    or p_source_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Import source metadata is invalid';
  end if;

  if p_total_rows is null or p_total_rows < 0 then
    raise exception using errcode = '22023', message = 'Import row count is invalid';
  end if;

  if jsonb_typeof(p_sales) <> 'array'
    or jsonb_array_length(p_sales) > 1000
    or jsonb_typeof(p_issues) <> 'array'
    or jsonb_array_length(p_issues) > 5000 then
    raise exception using errcode = '22023', message = 'Import payload is invalid or too large';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_source_file_sha256, 0));

  insert into public.legacy_sale_import_batches (
    organization_id, source_name, source_file_name, source_file_sha256,
    total_rows, detected_sales, created_by
  )
  values (
    p_organization_id, trim(p_source_name), trim(p_source_file_name),
    p_source_file_sha256, p_total_rows, p_total_rows, null
  )
  on conflict (organization_id, source_name, source_file_sha256) do nothing;

  select batch.id, batch.status
  into target_batch_id, batch_status
  from public.legacy_sale_import_batches as batch
  where batch.organization_id = p_organization_id
    and batch.source_name = trim(p_source_name)
    and batch.source_file_sha256 = p_source_file_sha256
  for update;

  if batch_status in ('failed', 'rolled_back') then
    raise exception using errcode = '23514', message = 'Import batch cannot be resumed in its current state';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_sales) as input(
      source_row integer,
      legacy_sale_number text,
      occurred_at timestamptz,
      subtotal numeric,
      vat_10_5 numeric,
      vat_21 numeric,
      rounding_adjustment numeric,
      discount numeric,
      total numeric
    )
    where input.source_row is null
      or input.source_row < 2
      or nullif(trim(input.legacy_sale_number), '') is null
      or input.occurred_at is null
      or input.subtotal is null
      or input.subtotal < 0
      or coalesce(input.vat_10_5, 0) < 0
      or coalesce(input.vat_21, 0) < 0
      or coalesce(input.discount, 0) < 0
      or input.total is null
      or input.total <= 0
      or abs(round(input.total - (
        input.subtotal + coalesce(input.vat_10_5, 0) + coalesce(input.vat_21, 0) - coalesce(input.discount, 0)
      ), 2)) > 0.05
  ) then
    raise exception using errcode = '22023', message = 'At least one legacy sale is invalid';
  end if;

  select count(*)
  into inserted_before
  from public.sales
  where import_batch_id = target_batch_id;

  insert into public.sales (
    organization_id,
    customer_id,
    payment_method_id,
    status,
    occurred_at,
    subtotal,
    discount,
    total,
    notes,
    created_by,
    source,
    import_batch_id,
    legacy_source_key,
    legacy_sale_number,
    legacy_source_row,
    legacy_document_type,
    legacy_point_of_sale,
    legacy_document_number,
    legacy_payment_method,
    legacy_customer_name,
    legacy_customer_tax_id,
    legacy_seller_name,
    legacy_status,
    original_time_known,
    item_detail_status,
    vat_10_5,
    vat_21,
    rounding_adjustment,
    legacy_payload
  )
  select
    p_organization_id,
    null,
    payment.id,
    'completed'::public.sale_status,
    input.occurred_at,
    round(input.subtotal, 2),
    round(coalesce(input.discount, 0), 2),
    round(input.total, 2),
    'Venta histórica importada. El libro de origen no incluye detalle de productos.',
    null,
    'legacy_import',
    target_batch_id,
    trim(p_source_name) || ':' || trim(input.legacy_sale_number),
    trim(input.legacy_sale_number),
    input.source_row,
    nullif(trim(input.document_type), ''),
    nullif(trim(input.point_of_sale), ''),
    nullif(trim(input.document_number), ''),
    nullif(trim(input.payment_method), ''),
    nullif(trim(input.customer_name), ''),
    nullif(trim(input.customer_tax_id), ''),
    nullif(trim(input.seller_name), ''),
    nullif(trim(input.legacy_status), ''),
    coalesce(input.original_time_known, true),
    'missing_from_source',
    round(coalesce(input.vat_10_5, 0), 2),
    round(coalesce(input.vat_21, 0), 2),
    round(input.total - (
      input.subtotal + coalesce(input.vat_10_5, 0) + coalesce(input.vat_21, 0) - coalesce(input.discount, 0)
    ), 2),
    coalesce(input.raw_data, '{}'::jsonb)
  from jsonb_to_recordset(p_sales) as input(
    source_row integer,
    legacy_sale_number text,
    occurred_at timestamptz,
    document_type text,
    point_of_sale text,
    document_number text,
    customer_name text,
    customer_tax_id text,
    payment_method text,
    seller_name text,
    legacy_status text,
    subtotal numeric,
    vat_10_5 numeric,
    vat_21 numeric,
    rounding_adjustment numeric,
    discount numeric,
    total numeric,
    original_time_known boolean,
    raw_data jsonb
  )
  left join lateral (
    select method.id
    from public.payment_methods as method
    where method.organization_id = p_organization_id
      and (
        (upper(trim(input.payment_method)) = 'CONTADO' and method.code = 'cash')
        or (upper(trim(input.payment_method)) = 'TRANSFERENCIA BANCARIA' and method.code = 'transfer')
        or upper(trim(method.name)) = upper(trim(input.payment_method))
      )
    order by method.is_active desc, method.sort_order, method.id
    limit 1
  ) as payment on true
  on conflict (organization_id, source, legacy_source_key)
    where source = 'legacy_import'
    do nothing;

  select count(*)
  into inserted_after
  from public.sales
  where import_batch_id = target_batch_id;
  inserted_this_call := inserted_after - inserted_before;

  insert into public.legacy_sale_import_issues (
    organization_id, batch_id, severity, source_row,
    legacy_sale_number, code, message, raw_data
  )
  select
    p_organization_id,
    target_batch_id,
    input.severity,
    input.source_row,
    nullif(trim(input.legacy_sale_number), ''),
    trim(input.code),
    trim(input.message),
    coalesce(input.raw_data, '{}'::jsonb)
  from jsonb_to_recordset(p_issues) as input(
    severity text,
    source_row integer,
    legacy_sale_number text,
    code text,
    message text,
    raw_data jsonb
  )
  where input.severity in ('warning', 'error')
    and nullif(trim(input.code), '') is not null
    and nullif(trim(input.message), '') is not null
  on conflict on constraint legacy_sale_import_issues_dedup_key do nothing;

  if p_finalize then
    select
      count(*),
      min(sale.occurred_at),
      max(sale.occurred_at),
      coalesce(sum(sale.total), 0)
    into inserted_after, first_sale, last_sale, sales_total
    from public.sales as sale
    where sale.import_batch_id = target_batch_id;

    select
      count(*),
      count(*) filter (where issue.severity = 'error'),
      count(*) filter (where issue.severity = 'warning')
    into issue_total, error_total, warning_total
    from public.legacy_sale_import_issues as issue
    where issue.batch_id = target_batch_id;

    update public.legacy_sale_import_batches
    set imported_sales = inserted_after,
        duplicate_sales = greatest(p_total_rows - inserted_after - error_total, 0),
        error_sales = error_total,
        warning_count = warning_total,
        first_occurred_at = first_sale,
        last_occurred_at = last_sale,
        imported_total = round(sales_total, 2),
        status = case when issue_total > 0 then 'completed_with_issues' else 'completed' end,
        summary = jsonb_build_object(
          'sales_without_item_detail', inserted_after,
          'products_linked', 0,
          'products_unlinked', 0,
          'customers_linked', 0,
          'payment_methods_mapped', (
            select count(*) from public.sales
            where import_batch_id = target_batch_id and payment_method_id is not null
          ),
          'payment_methods_unmapped', (
            select count(*) from public.sales
            where import_batch_id = target_batch_id and payment_method_id is null
          ),
          'stock_effect', 0,
          'source_has_item_detail', false
        ),
        completed_at = now()
    where id = target_batch_id;
  end if;

  return jsonb_build_object(
    'batch_id', target_batch_id,
    'status', case when p_finalize then (
      select status from public.legacy_sale_import_batches where id = target_batch_id
    ) else batch_status end,
    'inserted_this_call', inserted_this_call,
    'duplicates_this_call', jsonb_array_length(p_sales) - inserted_this_call,
    'sales_in_batch', inserted_after,
    'finalized', p_finalize
  );
end;
$$;

revoke all on function private.import_legacy_sales_batch(
  uuid, text, text, text, integer, jsonb, jsonb, boolean
) from public, anon, authenticated, service_role;

create function private.rollback_legacy_sale_import(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  removed_sales integer;
begin
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'Legacy sale rollback requires a trusted database session';
  end if;

  select organization_id
  into target_organization_id
  from public.legacy_sale_import_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Legacy sale import batch was not found';
  end if;

  delete from public.sales
  where import_batch_id = p_batch_id
    and organization_id = target_organization_id
    and source = 'legacy_import';
  get diagnostics removed_sales = row_count;

  update public.legacy_sale_import_batches
  set status = 'rolled_back',
      summary = summary || jsonb_build_object('rolled_back_sales', removed_sales, 'rolled_back_at', now()),
      completed_at = now()
  where id = p_batch_id;

  return jsonb_build_object('batch_id', p_batch_id, 'removed_sales', removed_sales);
end;
$$;

revoke all on function private.rollback_legacy_sale_import(uuid)
from public, anon, authenticated, service_role;
