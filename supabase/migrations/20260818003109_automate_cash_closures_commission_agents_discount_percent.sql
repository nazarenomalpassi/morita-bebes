create extension if not exists pg_cron;

-- Keep the original payment method for reporting while exposing one canonical
-- financial account for cash-control totals.
alter table public.payment_methods
  add column financial_account_code text generated always as (
    case when code = 'cash' then 'cash' else 'transfer' end
  ) stored;

alter table public.payment_methods
  add constraint payment_methods_financial_account_code_check
  check (financial_account_code in ('cash', 'transfer'));

create index payment_methods_org_financial_account_idx
  on public.payment_methods (organization_id, financial_account_code, sort_order);

comment on column public.payment_methods.financial_account_code is
  'Canonical cash-control account. Cash remains cash; transfer, debit, credit and every other non-cash method settle in transfer.';

-- Historical sales retain their exact monetary discount. New sales additionally
-- snapshot the percentage entered by the operator.
alter table public.sales
  add column discount_percent numeric(5, 2),
  add constraint sales_discount_percent_check
    check (discount_percent is null or discount_percent between 0 and 100);

comment on column public.sales.discount_percent is
  'Percentage snapshot for sales created after the percentage-discount rollout. Historical fixed discounts remain null.';

create table public.commission_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  first_name text not null,
  last_name text not null,
  phone text not null,
  route_description text not null,
  notes text,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_agents_name_check check (
    char_length(trim(first_name)) between 2 and 80
    and char_length(trim(last_name)) between 2 and 80
  ),
  constraint commission_agents_phone_check check (char_length(trim(phone)) between 6 and 40),
  constraint commission_agents_route_check check (char_length(trim(route_description)) between 3 and 500),
  constraint commission_agents_notes_check check (notes is null or char_length(trim(notes)) between 2 and 1000)
);

create index commission_agents_org_active_name_idx
  on public.commission_agents (organization_id, is_active, last_name, first_name);

alter table public.commission_agents enable row level security;

create policy "members read commission agents"
on public.commission_agents for select to authenticated
using (private.is_org_member(organization_id));

create policy "admins create commission agents"
on public.commission_agents for insert to authenticated
with check (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  and created_by = (select auth.uid())
);

create policy "admins update commission agents"
on public.commission_agents for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

revoke insert, update, delete on public.commission_agents from anon, authenticated;
grant select on public.commission_agents to authenticated;
grant all on public.commission_agents to service_role;

create trigger commission_agents_set_updated_at
before update on public.commission_agents
for each row execute function private.set_updated_at();

create function public.upsert_commission_agent(
  p_organization_id uuid,
  p_id uuid default null,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_route_description text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_id uuid;
begin
  if actor_id is null or not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Owner or administrator access is required';
  end if;

  if char_length(trim(coalesce(p_first_name, ''))) < 2
    or char_length(trim(coalesce(p_last_name, ''))) < 2
    or char_length(trim(coalesce(p_phone, ''))) < 6
    or char_length(trim(coalesce(p_route_description, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Complete the commission agent required fields';
  end if;

  if p_id is null then
    insert into public.commission_agents (
      organization_id, first_name, last_name, phone, route_description, notes, created_by
    ) values (
      p_organization_id,
      trim(p_first_name),
      trim(p_last_name),
      trim(p_phone),
      trim(p_route_description),
      nullif(trim(p_notes), ''),
      actor_id
    ) returning id into target_id;
  else
    update public.commission_agents
    set first_name = trim(p_first_name),
        last_name = trim(p_last_name),
        phone = trim(p_phone),
        route_description = trim(p_route_description),
        notes = nullif(trim(p_notes), '')
    where id = p_id
      and organization_id = p_organization_id
    returning id into target_id;

    if target_id is null then
      raise exception using errcode = 'P0002', message = 'Commission agent was not found';
    end if;
  end if;

  return target_id;
end;
$$;

create function public.set_commission_agent_active(
  p_organization_id uuid,
  p_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Owner or administrator access is required';
  end if;

  update public.commission_agents
  set is_active = p_is_active
  where id = p_id and organization_id = p_organization_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Commission agent was not found';
  end if;
end;
$$;

revoke all on function public.upsert_commission_agent(uuid, uuid, text, text, text, text, text) from public, anon;
revoke all on function public.set_commission_agent_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.upsert_commission_agent(uuid, uuid, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.set_commission_agent_active(uuid, uuid, boolean) to authenticated, service_role;

comment on table public.commission_agents is
  'Independent commission-agent directory. Staff may read; owners and administrators manage entries through controlled RPCs.';

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
    if new.discount_percent is null or new.discount_percent < 0 or new.discount_percent > 100 then
      raise exception using errcode = '23514', message = 'Sale discount percentage must be between zero and one hundred';
    end if;

    calculated_discount := round(calculated_subtotal * new.discount_percent / 100, 2);

    select round(coalesce(sum(payment.surcharge_amount), 0), 2)
    into calculated_surcharge
    from public.sale_payments as payment
    where payment.sale_id = old.id
      and payment.organization_id = old.organization_id;

    new.subtotal := calculated_subtotal;
    new.discount := calculated_discount;
    new.vat_10_5 := 0;
    new.vat_21 := 0;
    new.rounding_adjustment := 0;
    new.surcharge := calculated_surcharge;
    new.total := calculated_subtotal + calculated_surcharge - calculated_discount;
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
    if new.cancellation_reason is null or char_length(trim(new.cancellation_reason)) < 3 then
      raise exception using errcode = '23514', message = 'A cancellation reason is required';
    end if;

    new.cancelled_at := now();
    new.cancelled_by := coalesce(actor_id, new.cancelled_by);
    new.subtotal := old.subtotal;
    new.discount := old.discount;
    new.discount_percent := old.discount_percent;
    new.surcharge := old.surcharge;
    new.total := old.total;
    return new;
  end if;

  raise exception using
    errcode = '23514',
    message = format('Invalid sale status transition: %s to %s', old.status, new.status);
end;
$$;

create or replace function public.create_sale_with_payments(
  p_organization_id uuid,
  p_items jsonb,
  p_payments jsonb,
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
  created_sale_id uuid;
  inserted_count integer;
  payment_count integer := 0;
  effective_occurred_at timestamptz;
  sale_subtotal numeric(14, 2);
  discount_amount numeric(14, 2);
  base_sale_total numeric(14, 2);
  single_method_id uuid;
begin
  select member.role into actor_role from public.organization_members as member
  where member.organization_id = p_organization_id and member.user_id = actor_id and member.is_active;
  if actor_id is null or not found then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 250 then
    raise exception using errcode = '22023', message = 'A sale requires between 1 and 250 product lines';
  end if;
  if p_discount is null or p_discount < 0 or p_discount > 100 then
    raise exception using errcode = '22023', message = 'Sale discount percentage must be between zero and one hundred';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, discount numeric)
    where product_id is null or quantity is null or quantity <= 0 or quantity > 100000
      or (discount is not null and discount < 0)
  ) or (select count(*) from jsonb_to_recordset(p_items) as input(product_id uuid)) <>
       (select count(distinct product_id) from jsonb_to_recordset(p_items) as input(product_id uuid)) then
    raise exception using errcode = '22023', message = 'Sale item values are invalid or duplicated';
  end if;
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception using errcode = '22023', message = 'Sale payment allocations must be an array';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id
      and organization_id = p_organization_id and is_active
  ) then
    raise exception using errcode = '23503', message = 'Customer is missing or inactive';
  end if;

  effective_occurred_at := case when actor_role = 'staff' then now() else coalesce(p_occurred_at, now()) end;
  insert into public.sales (
    organization_id, customer_id, payment_method_id, reference, occurred_at, notes, created_by
  ) values (
    p_organization_id, p_customer_id, null,
    nullif(trim(p_reference), ''), effective_occurred_at, nullif(trim(p_notes), ''), actor_id
  ) returning id into created_sale_id;

  insert into public.sale_items (
    organization_id, sale_id, product_id, quantity, unit_price, unit_cost, discount
  )
  select p_organization_id, created_sale_id, product.id, input.quantity,
    product.retail_price, product.cost_price, coalesce(input.discount, 0)
  from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, discount numeric)
  join public.products as product on product.id = input.product_id
    and product.organization_id = p_organization_id and product.is_active;
  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(p_items) then
    raise exception using errcode = '23503', message = 'One or more sale products are missing or inactive';
  end if;

  select round(sum(item.line_total), 2) into sale_subtotal
  from public.sale_items as item
  where item.sale_id = created_sale_id and item.organization_id = p_organization_id;
  discount_amount := round(sale_subtotal * p_discount / 100, 2);
  base_sale_total := sale_subtotal - discount_amount;

  select count(*), (array_agg(payment_method_id))[1] into payment_count, single_method_id
  from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text);
  payment_count := coalesce(payment_count, 0);

  if payment_count > 0 and (
    payment_count <> (
      select count(distinct payment_method_id)
      from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid)
    ) or exists (
      select 1
      from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text)
      left join public.payment_methods as method on method.id = payment.payment_method_id
        and method.organization_id = p_organization_id
        and method.is_active
        and method.code in ('cash', 'transfer', 'card')
      where method.id is null
        or payment.amount is null
        or payment.amount <= 0
        or payment.amount > 999999999
        or (method.code = 'card' and coalesce(payment.card_type, '') not in ('debit', 'credit'))
        or (method.code <> 'card' and payment.card_type is not null)
    )
  ) then
    raise exception using errcode = '22023', message = 'Payment allocations are invalid or duplicated';
  end if;

  if base_sale_total > 0 then
    if payment_count = 0 then
      raise exception using errcode = '22023', message = 'A charged sale requires a payment allocation';
    end if;
    if round((
      select sum(amount)
      from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text)
    ), 2) is distinct from base_sale_total then
      raise exception using errcode = '23514', message = 'Payment allocations must equal the exact sale base total';
    end if;
  elsif base_sale_total = 0 then
    if payment_count <> 0 then
      raise exception using errcode = '23514', message = 'A fully discounted sale must not allocate a payment';
    end if;
  else
    raise exception using errcode = '23514', message = 'Sale total cannot be negative';
  end if;

  if payment_count > 0 then
    perform set_config('morita.sale_payment_write', 'append', true);
    insert into public.sale_payments (
      organization_id, sale_id, payment_method_id, amount, base_amount,
      card_type, surcharge_percentage, surcharge_amount
    )
    select
      p_organization_id,
      created_sale_id,
      payment.payment_method_id,
      round(payment.amount, 2) + calculated.surcharge_amount,
      round(payment.amount, 2),
      case when method.code = 'card' then payment.card_type else null end,
      calculated.surcharge_percentage,
      calculated.surcharge_amount
    from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text)
    join public.payment_methods as method on method.id = payment.payment_method_id
      and method.organization_id = p_organization_id
    cross join lateral (
      select case
        when method.code = 'card' and payment.card_type = 'debit' then method.debit_surcharge_percent
        when method.code = 'card' and payment.card_type = 'credit' then method.credit_surcharge_percent
        else 0::numeric
      end as surcharge_percentage
    ) as percentage
    cross join lateral (
      select percentage.surcharge_percentage,
        round(round(payment.amount, 2) * percentage.surcharge_percentage / 100, 2) as surcharge_amount
    ) as calculated;
  end if;

  update public.sales
  set discount_percent = p_discount,
      discount = discount_amount,
      payment_method_id = case when payment_count = 1 then single_method_id else null end,
      status = 'completed'
  where id = created_sale_id;

  return created_sale_id;
end;
$$;

revoke all on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz) to authenticated, service_role;

comment on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz) is
  'Creates an atomic sale. p_discount is a percentage from 0 to 100; a 100-percent sale records stock output without payment or cash movement.';

create function private.financial_cash_account_id(
  p_organization_id uuid,
  p_payment_method_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select canonical_account.id
  from public.payment_methods as source_method
  join public.payment_methods as canonical_method
    on canonical_method.organization_id = source_method.organization_id
   and canonical_method.code = source_method.financial_account_code
  join public.cash_accounts as canonical_account
    on canonical_account.organization_id = canonical_method.organization_id
   and canonical_account.payment_method_id = canonical_method.id
  where source_method.organization_id = p_organization_id
    and source_method.id = p_payment_method_id
$$;

revoke all on function private.financial_cash_account_id(uuid, uuid) from public, anon, authenticated;

create or replace function private.apply_sale_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  payment record;
  target_account_id uuid;
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if not exists (select 1 from public.sale_payments where sale_id = new.id) and new.payment_method_id is not null then
      perform set_config('morita.sale_payment_write', 'append', true);
      insert into public.sale_payments (
        organization_id, sale_id, payment_method_id, amount, base_amount
      ) values (
        new.organization_id, new.id, new.payment_method_id, new.total, new.total
      ) on conflict (sale_id, payment_method_id) do nothing;
    end if;

    select tracking_started_at into cutoff
    from public.cash_tracking_settings
    where organization_id = new.organization_id;
    if cutoff is null or new.occurred_at < cutoff then return new; end if;

    for payment in select * from public.sale_payments where sale_id = new.id loop
      target_account_id := private.financial_cash_account_id(
        new.organization_id,
        payment.payment_method_id
      );
      if target_account_id is null then
        raise exception using errcode = '23503', message = 'Sale payment has no canonical financial account';
      end if;

      perform private.append_cash_movement(
        new.organization_id,
        target_account_id,
        'sale',
        'credit',
        payment.base_amount,
        'sale',
        new.id,
        null,
        null,
        'sale:' || new.id::text || ':' || payment.payment_method_id::text,
        'Ingreso por venta',
        new.occurred_at,
        new.created_by,
        jsonb_strip_nulls(jsonb_build_object(
          'original_payment_method_id', payment.payment_method_id,
          'charged_amount', payment.amount,
          'card_type', payment.card_type,
          'surcharge_percentage', payment.surcharge_percentage,
          'surcharge_amount', payment.surcharge_amount
        ))
      );
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status = 'cancelled' then
    select tracking_started_at into cutoff
    from public.cash_tracking_settings
    where organization_id = new.organization_id;
    if cutoff is null or coalesce(new.cancelled_at, now()) < cutoff then return new; end if;

    for payment in select * from public.sale_payments where sale_id = new.id loop
      target_account_id := private.financial_cash_account_id(
        new.organization_id,
        payment.payment_method_id
      );
      if target_account_id is null then
        raise exception using errcode = '23503', message = 'Sale payment has no canonical financial account';
      end if;

      perform private.append_cash_movement(
        new.organization_id,
        target_account_id,
        'sale_reversal',
        'debit',
        payment.base_amount,
        'sale',
        new.id,
        null,
        null,
        'sale-reversal:' || new.id::text || ':' || payment.payment_method_id::text,
        'Anulación de venta',
        coalesce(new.cancelled_at, now()),
        new.cancelled_by,
        jsonb_build_object(
          'reason', new.cancellation_reason,
          'original_payment_method_id', payment.payment_method_id,
          'charged_amount', payment.amount,
          'surcharge_amount', payment.surcharge_amount
        )
      );
    end loop;
  end if;
  return new;
end;
$$;

comment on function private.apply_sale_cash_movement() is
  'Posts each payment exactly once to its canonical account: cash remains cash and every non-cash method settles in transfer. Card surcharge is never credited.';

-- Existing closure rows are classified as manual without changing any amount,
-- date, author or timestamp. Automation starts only on deployment day.
alter table public.cash_tracking_settings
  add column automatic_closure_enabled_from date not null
  default ((now() at time zone 'America/Argentina/Cordoba')::date);

alter table public.daily_cash_closures
  add column closure_type text not null default 'manual';

alter table public.daily_cash_closures
  alter column closed_by drop not null,
  drop constraint daily_cash_closures_counted_total_check,
  add constraint daily_cash_closures_type_check
    check (closure_type in ('manual', 'automatic')),
  add constraint daily_cash_closures_actor_check check (
    (closure_type = 'manual' and closed_by is not null)
    or (closure_type = 'automatic' and closed_by is null)
  );

alter table public.daily_cash_closure_items
  drop constraint daily_cash_closure_items_counted_check;

comment on column public.daily_cash_closures.closure_type is
  'Manual for preserved legacy closures; automatic for immutable 22:00 America/Argentina/Cordoba snapshots.';
comment on column public.cash_tracking_settings.automatic_closure_enabled_from is
  'First business date eligible for automatic closure. Dates before rollout are never backfilled.';

create or replace function private.cash_business_date(target_time timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (target_time at time zone 'America/Argentina/Cordoba')::date
$$;

create or replace function private.first_unclosed_cash_day(
  p_organization_id uuid,
  p_before_date date
)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select min(activity.business_date)
  from (
    select distinct private.cash_business_date(movement.occurred_at) as business_date
    from public.cash_movements as movement
    join public.cash_tracking_settings as settings
      on settings.organization_id = movement.organization_id
    where movement.organization_id = p_organization_id
      and private.cash_business_date(movement.occurred_at) >= settings.automatic_closure_enabled_from
      and private.cash_business_date(movement.occurred_at) < p_before_date
  ) as activity
  where not exists (
    select 1
    from public.daily_cash_closures as closure
    where closure.organization_id = p_organization_id
      and closure.business_date = activity.business_date
  )
$$;

create function private.create_automatic_cash_closure(
  p_organization_id uuid,
  p_business_date date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  enabled_from date;
  close_time timestamptz;
  day_start timestamptz;
  created_closure_id uuid;
  expected_total numeric(14, 2);
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'morita:auto-close:' || p_organization_id::text || ':' || p_business_date::text,
      0
    )
  );

  select settings.automatic_closure_enabled_from into enabled_from
  from public.cash_tracking_settings as settings
  where settings.organization_id = p_organization_id;

  if enabled_from is null or p_business_date < enabled_from then
    return false;
  end if;

  day_start := p_business_date::timestamp at time zone 'America/Argentina/Cordoba';
  close_time := (p_business_date::timestamp + time '22:00') at time zone 'America/Argentina/Cordoba';

  if clock_timestamp() < close_time then
    return false;
  end if;

  if exists (
    select 1 from public.daily_cash_closures
    where organization_id = p_organization_id and business_date = p_business_date
  ) then
    return false;
  end if;

  if (
    select count(*)
    from public.payment_methods as method
    join public.cash_accounts as account
      on account.organization_id = method.organization_id
     and account.payment_method_id = method.id
    where method.organization_id = p_organization_id
      and method.code in ('cash', 'transfer')
  ) <> 2 then
    raise exception using errcode = '23514', message = 'Cash and transfer accounts must be configured before automatic closure';
  end if;

  with canonical_values as (
    select
      canonical_method.code,
      round(coalesce(sum(movement.signed_amount) filter (
        where movement.occurred_at < day_start
      ), 0), 2) as opening_balance,
      round(coalesce(sum(movement.amount) filter (
        where movement.occurred_at >= day_start
          and movement.occurred_at < close_time
          and movement.direction = 'credit'
      ), 0), 2) as income,
      round(coalesce(sum(movement.amount) filter (
        where movement.occurred_at >= day_start
          and movement.occurred_at < close_time
          and movement.direction = 'debit'
      ), 0), 2) as expense
    from public.payment_methods as canonical_method
    join public.cash_accounts as canonical_account
      on canonical_account.organization_id = canonical_method.organization_id
     and canonical_account.payment_method_id = canonical_method.id
    left join public.payment_methods as source_method
      on source_method.organization_id = canonical_method.organization_id
     and source_method.financial_account_code = canonical_method.code
    left join public.cash_accounts as source_account
      on source_account.organization_id = source_method.organization_id
     and source_account.payment_method_id = source_method.id
    left join public.cash_movements as movement
      on movement.organization_id = source_account.organization_id
     and movement.cash_account_id = source_account.id
     and movement.occurred_at < close_time
    where canonical_method.organization_id = p_organization_id
      and canonical_method.code in ('cash', 'transfer')
    group by canonical_method.code
  )
  select round(sum(opening_balance + income - expense), 2)
  into expected_total
  from canonical_values;

  perform set_config('morita.daily_cash_closure_write', 'close', true);
  insert into public.daily_cash_closures (
    organization_id,
    business_date,
    closure_type,
    status,
    expected_total,
    counted_total,
    difference_total,
    absolute_difference_total,
    notes,
    closed_at,
    closed_by
  ) values (
    p_organization_id,
    p_business_date,
    'automatic',
    'balanced',
    expected_total,
    expected_total,
    0,
    0,
    'Cierre automático de las 22:00',
    clock_timestamp(),
    null
  )
  returning id into created_closure_id;

  perform set_config('morita.daily_cash_closure_write', 'close', true);
  insert into public.daily_cash_closure_items (
    organization_id,
    closure_id,
    cash_account_id,
    payment_method_id,
    payment_method_name,
    sort_order,
    opening_balance,
    income,
    expense,
    expected_balance,
    counted_balance,
    difference
  )
  select
    p_organization_id,
    created_closure_id,
    canonical_account.id,
    canonical_method.id,
    canonical_method.name,
    canonical_method.sort_order,
    account_values.opening_balance,
    account_values.income,
    account_values.expense,
    account_values.opening_balance + account_values.income - account_values.expense,
    account_values.opening_balance + account_values.income - account_values.expense,
    0
  from public.payment_methods as canonical_method
  join public.cash_accounts as canonical_account
    on canonical_account.organization_id = canonical_method.organization_id
   and canonical_account.payment_method_id = canonical_method.id
  cross join lateral (
    select
      round(coalesce(sum(movement.signed_amount) filter (
        where movement.occurred_at < day_start
      ), 0), 2) as opening_balance,
      round(coalesce(sum(movement.amount) filter (
        where movement.occurred_at >= day_start
          and movement.occurred_at < close_time
          and movement.direction = 'credit'
      ), 0), 2) as income,
      round(coalesce(sum(movement.amount) filter (
        where movement.occurred_at >= day_start
          and movement.occurred_at < close_time
          and movement.direction = 'debit'
      ), 0), 2) as expense
    from public.payment_methods as source_method
    join public.cash_accounts as source_account
      on source_account.organization_id = source_method.organization_id
     and source_account.payment_method_id = source_method.id
    left join public.cash_movements as movement
      on movement.organization_id = source_account.organization_id
     and movement.cash_account_id = source_account.id
     and movement.occurred_at < close_time
    where source_method.organization_id = p_organization_id
      and source_method.financial_account_code = canonical_method.code
  ) as account_values
  where canonical_method.organization_id = p_organization_id
    and canonical_method.code in ('cash', 'transfer');

  return true;
end;
$$;

create function private.catch_up_automatic_cash_closures(
  p_organization_id uuid,
  p_through_date date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  enabled_from date;
  candidate date;
  created_count integer := 0;
begin
  select settings.automatic_closure_enabled_from into enabled_from
  from public.cash_tracking_settings as settings
  where settings.organization_id = p_organization_id;

  if enabled_from is null or p_through_date is null or p_through_date < enabled_from then
    return 0;
  end if;

  for candidate in
    select day::date
    from generate_series(enabled_from, p_through_date, interval '1 day') as day
    order by day
  loop
    if private.create_automatic_cash_closure(p_organization_id, candidate) then
      created_count := created_count + 1;
    end if;
  end loop;

  return created_count;
end;
$$;

create function private.run_automatic_cash_closures()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := clock_timestamp() at time zone 'America/Argentina/Cordoba';
  eligible_date date;
  setting record;
  created_count integer := 0;
begin
  eligible_date := case
    when local_now::time >= time '22:00' then local_now::date
    else local_now::date - 1
  end;

  for setting in
    select organization_id
    from public.cash_tracking_settings
    where automatic_closure_enabled_from <= eligible_date
    order by organization_id
  loop
    created_count := created_count
      + private.catch_up_automatic_cash_closures(setting.organization_id, eligible_date);
  end loop;

  return created_count;
end;
$$;

revoke all on function private.create_automatic_cash_closure(uuid, date) from public, anon, authenticated;
revoke all on function private.catch_up_automatic_cash_closures(uuid, date) from public, anon, authenticated;
revoke all on function private.run_automatic_cash_closures() from public, anon, authenticated;

create or replace function private.require_open_cash_day(
  p_organization_id uuid,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_date date := private.cash_business_date(p_occurred_at);
  enabled_from date;
  eligible_date date;
  pending_date date;
begin
  select settings.automatic_closure_enabled_from into enabled_from
  from public.cash_tracking_settings as settings
  where settings.organization_id = p_organization_id
  for update;

  if enabled_from is null or target_date < enabled_from then
    return;
  end if;

  eligible_date := case
    when (p_occurred_at at time zone 'America/Argentina/Cordoba')::time >= time '22:00'
      then target_date
    else target_date - 1
  end;
  perform private.catch_up_automatic_cash_closures(p_organization_id, eligible_date);

  if exists (
    select 1 from public.daily_cash_closures
    where organization_id = p_organization_id and business_date = target_date
  ) then
    raise exception using
      errcode = '23514',
      message = 'Daily cash closure already exists for this business date';
  end if;

  pending_date := private.first_unclosed_cash_day(p_organization_id, target_date);
  if pending_date is not null then
    raise exception using
      errcode = '23514',
      message = format('Daily cash closure is required for %s before new operations', pending_date);
  end if;
end;
$$;

-- Manual closing is retained only for historical compatibility and service-level
-- recovery. Normal users cannot create, edit, delete or recreate a closure.
revoke execute on function public.close_daily_cash(uuid, date, jsonb, text) from authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'morita-daily-cash-closure-2200-cordoba';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'morita-daily-cash-closure-2200-cordoba',
    '0 1 * * *',
    'select private.run_automatic_cash_closures();'
  );
end;
$$;

comment on function private.run_automatic_cash_closures() is
  'Runs at 01:00 UTC, equivalent to 22:00 America/Argentina/Cordoba, and catches up only missing eligible dates.';

create or replace function public.get_daily_cash_closure_workspace(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  local_now timestamp := now() at time zone 'America/Argentina/Cordoba';
  today date := local_now::date;
  configured boolean;
  result jsonb;
begin
  select member.role into actor_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = actor_id
    and member.is_active;
  if actor_id is null or not found then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;

  configured := exists (
    select 1 from public.cash_tracking_settings where organization_id = p_organization_id
  );
  if not configured then
    return jsonb_build_object(
      'configured', false,
      'business_date', null,
      'automatic_enabled_from', null,
      'next_close_at', null,
      'today_closed', false,
      'methods', '[]'::jsonb,
      'recent_closures', '[]'::jsonb
    );
  end if;

  select jsonb_build_object(
    'configured', true,
    'business_date', today,
    'automatic_enabled_from', settings.automatic_closure_enabled_from,
    'next_close_at', case
      when local_now::time < time '22:00'
        then (today::timestamp + time '22:00') at time zone 'America/Argentina/Cordoba'
      else ((today + 1)::timestamp + time '22:00') at time zone 'America/Argentina/Cordoba'
    end,
    'today_closed', exists (
      select 1 from public.daily_cash_closures
      where organization_id = p_organization_id and business_date = today
    ),
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_method_id', method.id,
        'name', method.name,
        'code', method.code
      ) order by method.sort_order)
      from public.payment_methods as method
      join public.cash_accounts as account
        on account.organization_id = method.organization_id
       and account.payment_method_id = method.id
      where method.organization_id = p_organization_id
        and method.code in ('cash', 'transfer')
    ), '[]'::jsonb),
    'recent_closures', coalesce((
      select jsonb_agg(row_data order by business_date desc)
      from (
        select
          closure.business_date,
          closure.closure_type,
          closure.status,
          closure.closed_at,
          closure.absolute_difference_total
        from public.daily_cash_closures as closure
        where closure.organization_id = p_organization_id
          and (actor_role in ('owner', 'admin') or closure.closure_type = 'automatic')
        order by closure.business_date desc
        limit 7
      ) as row_data
    ), '[]'::jsonb)
  ) into result
  from public.cash_tracking_settings as settings
  where settings.organization_id = p_organization_id;

  return result;
end;
$$;

create or replace function public.list_daily_cash_closures(
  p_organization_id uuid,
  p_limit integer default 90,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_cash_admin(p_organization_id);

  select jsonb_build_object(
    'count', (select count(*) from public.daily_cash_closures where organization_id = p_organization_id),
    'closures', coalesce(jsonb_agg(row_data order by business_date desc), '[]'::jsonb)
  ) into result
  from (
    select
      closure.id,
      closure.business_date,
      closure.closure_type,
      closure.status,
      closure.expected_total,
      closure.counted_total,
      closure.difference_total,
      closure.absolute_difference_total,
      closure.notes,
      closure.closed_at,
      closure.closed_by,
      case
        when closure.closure_type = 'automatic' then 'Sistema automático'
        else coalesce(nullif(trim(profile.display_name), ''), profile.email, closure.closed_by::text)
      end as closed_by_name,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'payment_method_id', item.payment_method_id,
          'name', item.payment_method_name,
          'opening_balance', item.opening_balance,
          'income', item.income,
          'expense', item.expense,
          'expected_balance', item.expected_balance,
          'counted_balance', item.counted_balance,
          'difference', item.difference
        ) order by item.sort_order, item.payment_method_name)
        from public.daily_cash_closure_items as item
        where item.closure_id = closure.id and item.organization_id = closure.organization_id
      ), '[]'::jsonb) as items
    from public.daily_cash_closures as closure
    left join public.user_profiles as profile on profile.user_id = closure.closed_by
    where closure.organization_id = p_organization_id
    order by closure.business_date desc
    limit least(greatest(coalesce(p_limit, 90), 1), 366)
    offset greatest(coalesce(p_offset, 0), 0)
  ) as row_data;

  return coalesce(result, jsonb_build_object('count', 0, 'closures', '[]'::jsonb));
end;
$$;

create or replace function public.get_cash_dashboard(
  p_organization_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_payment_method_id uuid default null,
  p_type public.cash_movement_type default null,
  p_direction public.cash_movement_direction default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  selected_financial_code text;
  month_start timestamptz := date_trunc(
    'month', now() at time zone 'America/Argentina/Cordoba'
  ) at time zone 'America/Argentina/Cordoba';
begin
  perform private.require_cash_admin(p_organization_id);

  if p_payment_method_id is not null then
    select method.financial_account_code into selected_financial_code
    from public.payment_methods as method
    where method.id = p_payment_method_id and method.organization_id = p_organization_id;
    if selected_financial_code is null then
      raise exception using errcode = '23503', message = 'Payment method does not belong to this organization';
    end if;
  end if;

  select jsonb_build_object(
    'configured', exists(select 1 from public.cash_tracking_settings where organization_id = p_organization_id),
    'tracking_started_at', (select tracking_started_at from public.cash_tracking_settings where organization_id = p_organization_id),
    'total_balance', coalesce((
      select sum(account.current_balance)
      from public.cash_accounts as account
      where account.organization_id = p_organization_id
    ), 0),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', canonical_account.id,
        'payment_method_id', canonical_method.id,
        'name', canonical_method.name,
        'code', canonical_method.code,
        'is_active', canonical_method.is_active,
        'balance', coalesce(totals.balance, 0),
        'month_income', coalesce(totals.month_income, 0),
        'month_expense', coalesce(totals.month_expense, 0),
        'movement_count', coalesce(totals.movement_count, 0),
        'updated_at', totals.updated_at
      ) order by canonical_method.sort_order)
      from public.payment_methods as canonical_method
      join public.cash_accounts as canonical_account
        on canonical_account.organization_id = canonical_method.organization_id
       and canonical_account.payment_method_id = canonical_method.id
      left join lateral (
        select
          sum(source_account.current_balance) as balance,
          max(source_account.updated_at) as updated_at,
          sum(coalesce(monthly.income, 0)) as month_income,
          sum(coalesce(monthly.expense, 0)) as month_expense,
          sum(coalesce(monthly.movement_count, 0)) as movement_count
        from public.payment_methods as source_method
        join public.cash_accounts as source_account
          on source_account.organization_id = source_method.organization_id
         and source_account.payment_method_id = source_method.id
        left join lateral (
          select
            sum(case when movement.direction = 'credit' then movement.amount else 0 end) as income,
            sum(case when movement.direction = 'debit' then movement.amount else 0 end) as expense,
            count(*) as movement_count
          from public.cash_movements as movement
          where movement.cash_account_id = source_account.id
            and movement.occurred_at >= month_start
        ) as monthly on true
        where source_method.organization_id = p_organization_id
          and source_method.financial_account_code = canonical_method.code
      ) as totals on true
      where canonical_method.organization_id = p_organization_id
        and canonical_method.code in ('cash', 'transfer')
    ), '[]'::jsonb),
    'daily_flow', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', flow.day,
        'income', flow.income,
        'expense', flow.expense
      ) order by flow.day)
      from (
        select
          (movement.occurred_at at time zone 'America/Argentina/Cordoba')::date as day,
          sum(case when movement.direction = 'credit' then movement.amount else 0 end) as income,
          sum(case when movement.direction = 'debit' then movement.amount else 0 end) as expense
        from public.cash_movements as movement
        where movement.organization_id = p_organization_id
          and movement.occurred_at >= now() - interval '14 days'
        group by 1
      ) as flow
    ), '[]'::jsonb),
    'movement_count', (
      select count(*)
      from public.cash_movements as movement
      join public.cash_accounts as account on account.id = movement.cash_account_id
      join public.payment_methods as method on method.id = account.payment_method_id
      where movement.organization_id = p_organization_id
        and (p_date_from is null or movement.occurred_at >= p_date_from)
        and (p_date_to is null or movement.occurred_at < p_date_to)
        and (selected_financial_code is null or method.financial_account_code = selected_financial_code)
        and (p_type is null or movement.type = p_type)
        and (p_direction is null or movement.direction = p_direction)
        and (nullif(trim(p_search), '') is null
          or movement.description ilike '%' || trim(p_search) || '%'
          or coalesce(movement.reference_type, '') ilike '%' || trim(p_search) || '%')
    ),
    'movements', coalesce((
      select jsonb_agg(to_jsonb(entry) order by entry.occurred_at desc, entry.id desc)
      from (
        select
          movement.id,
          movement.occurred_at,
          movement.type,
          movement.direction,
          movement.amount,
          movement.signed_amount,
          movement.balance_before,
          movement.balance_after,
          movement.description,
          movement.reference_type,
          movement.reference_id,
          movement.transfer_id,
          movement.created_by,
          canonical_method.name as account_name,
          canonical_method.id as payment_method_id,
          coalesce(profile.display_name, profile.email, 'Sistema') as actor_name
        from public.cash_movements as movement
        join public.cash_accounts as account on account.id = movement.cash_account_id
        join public.payment_methods as method on method.id = account.payment_method_id
        join public.payment_methods as canonical_method
          on canonical_method.organization_id = method.organization_id
         and canonical_method.code = method.financial_account_code
        left join public.user_profiles as profile on profile.user_id = movement.created_by
        where movement.organization_id = p_organization_id
          and (p_date_from is null or movement.occurred_at >= p_date_from)
          and (p_date_to is null or movement.occurred_at < p_date_to)
          and (selected_financial_code is null or method.financial_account_code = selected_financial_code)
          and (p_type is null or movement.type = p_type)
          and (p_direction is null or movement.direction = p_direction)
          and (nullif(trim(p_search), '') is null
            or movement.description ilike '%' || trim(p_search) || '%'
            or coalesce(movement.reference_type, '') ilike '%' || trim(p_search) || '%')
        order by movement.occurred_at desc, movement.id desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) as entry
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

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
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;
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
    'surcharge', target_sale.surcharge, 'total', target_sale.total,
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
  left join public.site_settings as settings on settings.organization_id = target_sale.organization_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'method', case payment.card_type
        when 'debit' then method.name || ' de débito'
        when 'credit' then method.name || ' de crédito'
        else method.name
      end,
      'amount', payment.amount,
      'base_amount', payment.base_amount,
      'card_type', payment.card_type,
      'surcharge_percentage', payment.surcharge_percentage,
      'surcharge_amount', payment.surcharge_amount
    ) order by method.sort_order, method.name) as rows
    from public.sale_payments as payment
    join public.payment_methods as method on method.id = payment.payment_method_id and method.organization_id = payment.organization_id
    where payment.sale_id = target_sale.id and payment.organization_id = target_sale.organization_id
  ) as payments on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'name', item.product_name_snapshot,
      'sku', item.product_sku_snapshot,
      'quantity', item.quantity,
      'unit_price', item.unit_price,
      'discount', item.discount,
      'line_total', item.line_total
    ) order by item.created_at, item.id) as rows
    from public.sale_items as item
    where item.sale_id = target_sale.id and item.organization_id = target_sale.organization_id
  ) as items on true
  where organization.id = target_sale.organization_id;

  return receipt;
end;
$$;

comment on function public.get_sale_receipt(uuid) is
  'Returns an immutable customer-safe receipt including historical monetary discount and, for new sales, its percentage snapshot.';

create function public.get_sales_discount_summary(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_compare_from date,
  p_compare_to date,
  p_category_id uuid default null,
  p_product_id uuid default null,
  p_created_by uuid default null,
  p_unassigned_only boolean default false,
  p_payment_key text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  result jsonb;
begin
  select member.role into actor_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = actor_id
    and member.is_active;

  if actor_id is null or not found or actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'Administrator access is required';
  end if;
  if p_from is null or p_to is null or p_from > p_to
    or p_compare_from is null or p_compare_to is null or p_compare_from > p_compare_to then
    raise exception using errcode = '22023', message = 'Invalid discount summary date range';
  end if;

  with candidate_sales as (
    select
      sale.*,
      case
        when sale.occurred_at >= p_from::timestamp at time zone 'America/Argentina/Cordoba'
          and sale.occurred_at < (p_to + 1)::timestamp at time zone 'America/Argentina/Cordoba'
          then 'current'
        else 'previous'
      end as period
    from public.sales as sale
    where sale.organization_id = p_organization_id
      and sale.status = 'completed'
      and (
        (sale.occurred_at >= p_from::timestamp at time zone 'America/Argentina/Cordoba'
          and sale.occurred_at < (p_to + 1)::timestamp at time zone 'America/Argentina/Cordoba')
        or
        (sale.occurred_at >= p_compare_from::timestamp at time zone 'America/Argentina/Cordoba'
          and sale.occurred_at < (p_compare_to + 1)::timestamp at time zone 'America/Argentina/Cordoba')
      )
      and (p_created_by is null or sale.created_by = p_created_by)
      and (not p_unassigned_only or sale.created_by is null)
      and (
        p_payment_key is null
        or coalesce(
          sale.payment_method_id::text,
          'legacy:' || lower(coalesce(nullif(trim(sale.legacy_payment_method), ''), 'sin-registrar'))
        ) = p_payment_key
      )
  ), weighted_sales as (
    select
      sale.period,
      sale.subtotal,
      sale.discount,
      sale.total,
      sale.surcharge,
      case
        when p_product_id is null and p_category_id is null then 1::numeric
        else coalesce(rollup.matched_line_total / nullif(sale.subtotal, 0), 0)
      end as weight
    from candidate_sales as sale
    left join lateral (
      select coalesce(sum(item.line_total), 0) as matched_line_total
      from public.sale_items as item
      left join public.products as product
        on product.id = item.product_id
       and product.organization_id = item.organization_id
      where item.sale_id = sale.id
        and item.organization_id = sale.organization_id
        and (p_product_id is null or item.product_id = p_product_id)
        and (p_category_id is null or product.category_id = p_category_id)
    ) as rollup on true
    where (p_product_id is null and p_category_id is null)
      or rollup.matched_line_total > 0
  ), totals as (
    select
      periods.period,
      round(coalesce(sum(weighted.subtotal * weighted.weight), 0), 2) as gross_revenue,
      round(coalesce(sum(weighted.discount * weighted.weight), 0), 2) as discounts,
      round(coalesce(sum((weighted.subtotal - weighted.discount) * weighted.weight), 0), 2) as net_revenue,
      round(coalesce(sum(weighted.surcharge * weighted.weight), 0), 2) as card_surcharge_preview,
      round(coalesce(sum(weighted.total * weighted.weight), 0), 2) as customer_charged_total
    from (values ('current'::text), ('previous'::text)) as periods(period)
    left join weighted_sales as weighted on weighted.period = periods.period
    group by periods.period
  )
  select jsonb_build_object(
    'current', (select to_jsonb(totals) - 'period' from totals where period = 'current'),
    'previous', (select to_jsonb(totals) - 'period' from totals where period = 'previous')
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_sales_discount_summary(uuid, date, date, date, date, uuid, uuid, uuid, boolean, text) from public, anon;
grant execute on function public.get_sales_discount_summary(uuid, date, date, date, date, uuid, uuid, uuid, boolean, text) to authenticated, service_role;

comment on function public.get_sales_discount_summary(uuid, date, date, date, date, uuid, uuid, uuid, boolean, text) is
  'Separates gross merchandise value, monetary discounts and real net revenue. Card surcharge remains a collection preview and is reported separately.';
