create table private.sale_submission_keys (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  sale_id uuid references public.sales(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, created_by, idempotency_key),
  unique (sale_id)
);

comment on table private.sale_submission_keys is
  'Server-side idempotency ledger. A client submission key can create at most one internal sale.';

revoke all on table private.sale_submission_keys from public, anon, authenticated;

create function public.create_idempotent_sale_with_payments(
  p_organization_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_idempotency_key uuid,
  p_customer_id uuid default null,
  p_discount numeric default 0,
  p_notes text default null,
  p_reference text default null,
  p_occurred_at timestamptz default now(),
  p_manual_surcharge numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  existing_sale_id uuid;
  created_sale_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'A sale submission key is required';
  end if;
  if not exists (
    select 1
    from public.organization_members as member
    where member.organization_id = p_organization_id
      and member.user_id = actor_id
      and member.is_active
  ) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || actor_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select submission.sale_id
  into existing_sale_id
  from private.sale_submission_keys as submission
  where submission.organization_id = p_organization_id
    and submission.created_by = actor_id
    and submission.idempotency_key = p_idempotency_key;

  if found and existing_sale_id is not null then
    return existing_sale_id;
  end if;

  insert into private.sale_submission_keys (
    organization_id,
    created_by,
    idempotency_key
  ) values (
    p_organization_id,
    actor_id,
    p_idempotency_key
  )
  on conflict (organization_id, created_by, idempotency_key) do nothing;

  created_sale_id := public.create_sale_with_payments(
    p_organization_id,
    p_items,
    p_payments,
    p_customer_id,
    p_discount,
    p_notes,
    p_reference,
    p_occurred_at,
    p_manual_surcharge
  );

  update private.sale_submission_keys
  set sale_id = created_sale_id
  where organization_id = p_organization_id
    and created_by = actor_id
    and idempotency_key = p_idempotency_key;

  return created_sale_id;
end;
$$;

revoke all on function public.create_idempotent_sale_with_payments(uuid, jsonb, jsonb, uuid, uuid, numeric, text, text, timestamptz, numeric) from public, anon;
grant execute on function public.create_idempotent_sale_with_payments(uuid, jsonb, jsonb, uuid, uuid, numeric, text, text, timestamptz, numeric) to authenticated, service_role;

comment on function public.create_idempotent_sale_with_payments(uuid, jsonb, jsonb, uuid, uuid, numeric, text, text, timestamptz, numeric) is
  'Creates one atomic sale per authenticated user and submission UUID, returning the original sale on safe retries.';

create or replace function private.guard_sale_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  calculated_subtotal numeric(14, 2);
  calculated_discount numeric(14, 2);
  calculated_surcharge numeric(14, 2);
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
      or new.discount_percent is distinct from old.discount_percent
      or new.manual_surcharge is distinct from old.manual_surcharge
      or new.surcharge is distinct from old.surcharge
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
      and not private.has_org_role(old.organization_id, array['owner', 'admin']::public.app_role[]) then
      raise exception using errcode = '42501', message = 'Only the sale creator or an administrator can complete it';
    end if;

    select count(*), round(coalesce(sum(line_total), 0), 2)
    into item_count, calculated_subtotal
    from public.sale_items
    where sale_id = old.id and organization_id = old.organization_id;

    if item_count = 0 then
      raise exception using errcode = '23514', message = 'A sale requires at least one item';
    end if;
    if new.discount_percent is null or new.discount_percent < 0 or new.discount_percent > 100 then
      raise exception using errcode = '23514', message = 'Sale discount percentage must be between zero and one hundred';
    end if;
    if new.manual_surcharge is null or new.manual_surcharge < 0 or new.manual_surcharge > 999999999 then
      raise exception using errcode = '23514', message = 'Sale manual surcharge must be between zero and 999999999';
    end if;

    calculated_discount := round(calculated_subtotal * new.discount_percent / 100, 2);
    select round(coalesce(sum(payment.surcharge_amount), 0), 2)
    into calculated_surcharge
    from public.sale_payments as payment
    where payment.sale_id = old.id and payment.organization_id = old.organization_id;

    new.subtotal := calculated_subtotal;
    new.discount := calculated_discount;
    new.vat_10_5 := 0;
    new.vat_21 := 0;
    new.rounding_adjustment := 0;
    new.surcharge := calculated_surcharge;
    new.total := calculated_subtotal + new.manual_surcharge + calculated_surcharge - calculated_discount;
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
    return new;
  end if;

  if old.status = 'completed' and new.status = 'cancelled' then
    if actor_id is not null
      and actor_id <> old.created_by
      and not private.has_org_role(old.organization_id, array['owner', 'admin']::public.app_role[]) then
      raise exception using errcode = '42501', message = 'Only the sale creator or an administrator can cancel it';
    end if;
    if new.cancellation_reason is null or char_length(trim(new.cancellation_reason)) < 3 then
      raise exception using errcode = '23514', message = 'A cancellation reason is required';
    end if;

    new.cancelled_at := now();
    new.cancelled_by := coalesce(actor_id, new.cancelled_by);
    new.subtotal := old.subtotal;
    new.discount := old.discount;
    new.discount_percent := old.discount_percent;
    new.manual_surcharge := old.manual_surcharge;
    new.surcharge := old.surcharge;
    new.total := old.total;
    return new;
  end if;

  raise exception using errcode = '23514',
    message = format('Invalid sale status transition: %s to %s', old.status, new.status);
end;
$$;

drop policy "owners and admins update sales" on public.sales;
create policy "administrators and creators cancel sales"
on public.sales for update to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (
    private.has_org_role(organization_id, array['staff']::public.app_role[])
    and created_by = (select auth.uid())
    and status = 'completed'
  )
)
with check (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (
    private.has_org_role(organization_id, array['staff']::public.app_role[])
    and created_by = (select auth.uid())
    and status = 'cancelled'
  )
);

create or replace function public.cancel_sale(p_sale_id uuid, p_reason text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  sale_organization_id uuid;
  sale_creator_id uuid;
  current_status public.sale_status;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'A cancellation reason is required';
  end if;

  select sale.organization_id, sale.created_by, sale.status, member.role
  into sale_organization_id, sale_creator_id, current_status, actor_role
  from public.sales as sale
  join public.organization_members as member
    on member.organization_id = sale.organization_id
   and member.user_id = actor_id
   and member.is_active
  where sale.id = p_sale_id
  for update of sale;

  if not found then
    raise exception using errcode = 'P0002', message = 'Sale was not found';
  end if;
  if actor_role not in ('owner', 'admin') and sale_creator_id is distinct from actor_id then
    raise exception using errcode = '42501', message = 'Staff can only cancel their own sales';
  end if;
  if current_status = 'cancelled' then
    raise exception using errcode = '55000', message = 'Sale is already cancelled';
  end if;
  if current_status <> 'completed' then
    raise exception using errcode = '55000', message = 'Only completed sales can be cancelled';
  end if;

  update public.sales
  set cancellation_reason = left(trim(p_reason), 500),
      status = 'cancelled'
  where id = p_sale_id;

  return p_sale_id;
end;
$$;

revoke all on function public.cancel_sale(uuid, text) from public, anon;
grant execute on function public.cancel_sale(uuid, text) to authenticated, service_role;

drop function public.list_operational_sales(uuid, uuid, timestamptz, timestamptz, text, text, integer, integer);
create function public.list_operational_sales(
  p_organization_id uuid,
  p_created_by uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_source text default null,
  p_search text default null,
  p_status text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid, reference text, occurred_at timestamptz, total numeric,
  status public.sale_status, cancellation_reason text, customer_name text,
  payment_method_name text, item_count bigint, created_by uuid,
  actor_name text, actor_email text, source text, legacy_sale_number text,
  legacy_seller_name text, item_detail_status text, matching_count bigint
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
  select member.role into actor_role from public.organization_members as member
  where member.organization_id = p_organization_id and member.user_id = actor_id and member.is_active;
  if actor_id is null or not found then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  if coalesce(p_status, 'all') not in ('all', 'active', 'cancelled') then
    raise exception using errcode = '22023', message = 'Invalid sale status filter';
  end if;

  return query
  select sale.id, sale.reference, sale.occurred_at, sale.total, sale.status,
    sale.cancellation_reason, coalesce(customer.name, sale.legacy_customer_name),
    coalesce(payment_summary.names, sale.legacy_payment_method), coalesce(item_summary.count, 0),
    sale.created_by, profile.display_name, profile.email, sale.source,
    sale.legacy_sale_number, sale.legacy_seller_name, sale.item_detail_status, count(*) over ()
  from public.sales as sale
  left join public.customers as customer on customer.id = sale.customer_id and customer.organization_id = sale.organization_id
  left join public.user_profiles as profile on profile.user_id = sale.created_by
  left join lateral (
    select string_agg(method.name, ' + ' order by method.sort_order, method.name) as names
    from public.sale_payments as payment
    join public.payment_methods as method on method.id = payment.payment_method_id and method.organization_id = payment.organization_id
    where payment.sale_id = sale.id and payment.organization_id = sale.organization_id
  ) as payment_summary on true
  left join lateral (
    select count(*) as count from public.sale_items as item
    where item.sale_id = sale.id and item.organization_id = sale.organization_id
  ) as item_summary on true
  where sale.organization_id = p_organization_id
    and (p_from is null or sale.occurred_at >= p_from)
    and (p_to is null or sale.occurred_at < p_to)
    and (p_source is null or sale.source = p_source)
    and (coalesce(p_status, 'all') = 'all'
      or (p_status = 'active' and sale.status = 'completed')
      or (p_status = 'cancelled' and sale.status = 'cancelled'))
    and (nullif(trim(p_search), '') is null
      or sale.reference ilike '%' || trim(p_search) || '%'
      or sale.legacy_sale_number ilike '%' || trim(p_search) || '%'
      or coalesce(customer.name, sale.legacy_customer_name, '') ilike '%' || trim(p_search) || '%'
      or coalesce(payment_summary.names, sale.legacy_payment_method, '') ilike '%' || trim(p_search) || '%')
    and ((actor_role in ('owner', 'admin') and (p_created_by is null or sale.created_by = p_created_by))
      or (actor_role = 'staff' and sale.created_by = actor_id))
  order by sale.occurred_at desc, sale.id
  limit least(greatest(coalesce(p_limit, 100), 1), 250)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.list_operational_sales(uuid, uuid, timestamptz, timestamptz, text, text, text, integer, integer) from public, anon;
grant execute on function public.list_operational_sales(uuid, uuid, timestamptz, timestamptz, text, text, text, integer, integer) to authenticated, service_role;

create or replace function public.get_sale_receipt(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_sale public.sales%rowtype;
  receipt jsonb;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'Authentication is required'; end if;
  select sale.* into target_sale
  from public.sales as sale
  join public.organization_members as member on member.organization_id = sale.organization_id
    and member.user_id = actor_id and member.is_active
  where sale.id = p_sale_id
    and (member.role in ('owner', 'admin') or (member.role = 'staff' and sale.created_by = actor_id));
  if not found then raise exception using errcode = 'P0002', message = 'Sale receipt was not found'; end if;

  select jsonb_build_object(
    'display_number', coalesce(nullif(trim(target_sale.legacy_sale_number), ''), nullif(trim(target_sale.reference), ''), upper(substr(replace(target_sale.id::text, '-', ''), 1, 8))),
    'source', target_sale.source, 'status', target_sale.status, 'occurred_at', target_sale.occurred_at,
    'original_time_known', target_sale.original_time_known, 'item_detail_status', target_sale.item_detail_status,
    'subtotal', target_sale.subtotal, 'discount', target_sale.discount,
    'discount_percent', target_sale.discount_percent, 'vat_10_5', target_sale.vat_10_5,
    'vat_21', target_sale.vat_21, 'rounding_adjustment', target_sale.rounding_adjustment,
    'manual_surcharge', target_sale.manual_surcharge,
    'surcharge', target_sale.surcharge, 'total', target_sale.total,
    'cancelled_at', target_sale.cancelled_at,
    'cancellation_reason', target_sale.cancellation_reason,
    'cancelled_by_name', coalesce(nullif(trim(canceller.display_name), ''), nullif(trim(canceller.email), '')),
    'customer', case when customer.id is null and nullif(trim(target_sale.legacy_customer_name), '') is null then null else jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(customer.name, nullif(trim(target_sale.legacy_customer_name), '')),
      'phone', coalesce(nullif(trim(customer.whatsapp), ''), nullif(trim(customer.phone), ''))
    )) end,
    'seller_name', coalesce(nullif(trim(profile.display_name), ''), nullif(trim(target_sale.legacy_seller_name), '')),
    'payments', case
      when jsonb_array_length(coalesce(payments.rows, '[]'::jsonb)) > 0 then payments.rows
      when nullif(trim(target_sale.legacy_payment_method), '') is not null then jsonb_build_array(jsonb_build_object('method', target_sale.legacy_payment_method, 'amount', target_sale.total))
      else '[]'::jsonb end,
    'business', jsonb_strip_nulls(jsonb_build_object('name', organization.name, 'address', nullif(trim(settings.address), ''), 'whatsapp', nullif(trim(settings.whatsapp), ''), 'email', nullif(trim(settings.email), ''))),
    'items', coalesce(items.rows, '[]'::jsonb)
  ) into receipt
  from public.organizations as organization
  left join public.customers as customer on customer.id = target_sale.customer_id and customer.organization_id = target_sale.organization_id
  left join public.user_profiles as profile on profile.user_id = target_sale.created_by
  left join public.user_profiles as canceller on canceller.user_id = target_sale.cancelled_by
  left join public.site_settings as settings on settings.organization_id = target_sale.organization_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'method', case payment.card_type when 'debit' then method.name || ' de débito' when 'credit' then method.name || ' de crédito' else method.name end,
      'amount', payment.amount, 'base_amount', payment.base_amount, 'card_type', payment.card_type,
      'surcharge_percentage', payment.surcharge_percentage, 'surcharge_amount', payment.surcharge_amount
    ) order by method.sort_order, method.name) as rows
    from public.sale_payments as payment
    join public.payment_methods as method on method.id = payment.payment_method_id and method.organization_id = payment.organization_id
    where payment.sale_id = target_sale.id and payment.organization_id = target_sale.organization_id
  ) as payments on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'name', item.product_name_snapshot, 'sku', item.product_sku_snapshot,
      'quantity', item.quantity, 'unit_price', item.unit_price,
      'discount', item.discount, 'line_total', item.line_total
    ) order by item.created_at, item.id) as rows
    from public.sale_items as item
    where item.sale_id = target_sale.id and item.organization_id = target_sale.organization_id
  ) as items on true
  where organization.id = target_sale.organization_id;

  return receipt;
end;
$$;

comment on function public.get_sale_receipt(uuid) is
  'Returns the immutable sale snapshot plus cancellation actor, timestamp and reason for operational audit.';
