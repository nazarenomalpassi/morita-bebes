alter table public.cash_tracking_settings
  add column daily_closure_required_from date not null
  default ((now() at time zone 'America/Argentina/Buenos_Aires')::date);

create table public.daily_cash_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  business_date date not null,
  status text not null,
  expected_total numeric(14, 2) not null,
  counted_total numeric(14, 2) not null,
  difference_total numeric(14, 2) not null,
  absolute_difference_total numeric(14, 2) not null,
  notes text,
  closed_at timestamptz not null default now(),
  closed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint daily_cash_closures_id_org_unique unique (id, organization_id),
  constraint daily_cash_closures_date_unique unique (organization_id, business_date),
  constraint daily_cash_closures_status_check check (status in ('balanced', 'difference')),
  constraint daily_cash_closures_counted_total_check check (counted_total >= 0),
  constraint daily_cash_closures_difference_check check (
    difference_total = counted_total - expected_total
  ),
  constraint daily_cash_closures_absolute_difference_check check (absolute_difference_total >= 0),
  constraint daily_cash_closures_notes_check check (
    notes is null or char_length(trim(notes)) between 2 and 500
  )
);

create table public.daily_cash_closure_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  closure_id uuid not null,
  cash_account_id uuid not null,
  payment_method_id uuid not null,
  payment_method_name text not null,
  sort_order integer not null,
  opening_balance numeric(14, 2) not null,
  income numeric(14, 2) not null,
  expense numeric(14, 2) not null,
  expected_balance numeric(14, 2) not null,
  counted_balance numeric(14, 2) not null,
  difference numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  constraint daily_cash_closure_items_closure_fk
    foreign key (closure_id, organization_id)
    references public.daily_cash_closures(id, organization_id) on delete restrict,
  constraint daily_cash_closure_items_account_fk
    foreign key (cash_account_id, organization_id)
    references public.cash_accounts(id, organization_id) on delete restrict,
  constraint daily_cash_closure_items_method_fk
    foreign key (payment_method_id, organization_id)
    references public.payment_methods(id, organization_id) on delete restrict,
  constraint daily_cash_closure_items_method_unique unique (closure_id, payment_method_id),
  constraint daily_cash_closure_items_name_check check (char_length(trim(payment_method_name)) between 2 and 80),
  constraint daily_cash_closure_items_flow_check check (income >= 0 and expense >= 0),
  constraint daily_cash_closure_items_counted_check check (counted_balance >= 0),
  constraint daily_cash_closure_items_expected_check check (
    expected_balance = opening_balance + income - expense
  ),
  constraint daily_cash_closure_items_difference_check check (
    difference = counted_balance - expected_balance
  )
);

create index daily_cash_closures_org_date_idx
  on public.daily_cash_closures (organization_id, business_date desc);
create index daily_cash_closure_items_org_closure_idx
  on public.daily_cash_closure_items (organization_id, closure_id, sort_order);

alter table public.daily_cash_closures enable row level security;
alter table public.daily_cash_closure_items enable row level security;

create policy "authorized members read daily cash closures"
on public.daily_cash_closures for select to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (closed_by = (select auth.uid()) and private.is_org_member(organization_id))
);

create policy "authorized members read daily cash closure items"
on public.daily_cash_closure_items for select to authenticated
using (
  exists (
    select 1
    from public.daily_cash_closures as closure
    where closure.id = daily_cash_closure_items.closure_id
      and closure.organization_id = daily_cash_closure_items.organization_id
      and (
        private.has_org_role(closure.organization_id, array['owner', 'admin']::public.app_role[])
        or (closure.closed_by = (select auth.uid()) and private.is_org_member(closure.organization_id))
      )
  )
);

revoke insert, update, delete on public.daily_cash_closures, public.daily_cash_closure_items from anon, authenticated;
grant select on public.daily_cash_closures, public.daily_cash_closure_items to authenticated, service_role;
grant all on public.daily_cash_closures, public.daily_cash_closure_items to service_role;

create or replace function private.cash_business_date(target_time timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (target_time at time zone 'America/Argentina/Buenos_Aires')::date
$$;

revoke all on function private.cash_business_date(timestamptz) from public, anon, authenticated;

create function private.first_unclosed_cash_day(
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
      and private.cash_business_date(movement.occurred_at) >= settings.daily_closure_required_from
      and private.cash_business_date(movement.occurred_at) < p_before_date
  ) as activity
  where not exists (
    select 1
    from public.daily_cash_closures as closure
    where closure.organization_id = p_organization_id
      and closure.business_date = activity.business_date
  )
$$;

revoke all on function private.first_unclosed_cash_day(uuid, date) from public, anon, authenticated;

create function private.require_open_cash_day(
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
  required_from date;
  pending_date date;
begin
  select settings.daily_closure_required_from into required_from
  from public.cash_tracking_settings as settings
  where settings.organization_id = p_organization_id
  for update;

  if required_from is null or target_date < required_from then
    return;
  end if;

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

revoke all on function private.require_open_cash_day(uuid, timestamptz) from public, anon, authenticated;

create or replace function private.guard_cash_movement_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and current_setting('morita.cash_movement_write', true) = 'append' then
    if coalesce(new.reference_type, '') <> 'daily_cash_closure' then
      perform private.require_open_cash_day(new.organization_id, new.occurred_at);
    end if;
    return new;
  end if;
  raise exception using errcode = '42501', message = 'Cash movements are immutable and must use the ledger workflow';
end;
$$;

create function private.guard_sale_business_day()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'system' then
    perform private.require_open_cash_day(new.organization_id, new.occurred_at);
  end if;
  return new;
end;
$$;

revoke all on function private.guard_sale_business_day() from public, anon, authenticated;

create trigger guard_sale_business_day
before insert on public.sales
for each row execute function private.guard_sale_business_day();

create function private.guard_daily_cash_closure_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and current_setting('morita.daily_cash_closure_write', true) = 'close' then
    return new;
  end if;
  raise exception using errcode = '42501', message = 'Daily cash closures are immutable and workflow-managed';
end;
$$;

revoke all on function private.guard_daily_cash_closure_write() from public, anon, authenticated;

create trigger daily_cash_closures_guard_write
before insert or update or delete on public.daily_cash_closures
for each row execute function private.guard_daily_cash_closure_write();

create trigger daily_cash_closure_items_guard_write
before insert or update or delete on public.daily_cash_closure_items
for each row execute function private.guard_daily_cash_closure_write();

create function public.get_daily_cash_closure_workspace(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  target_date date;
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
      'is_overdue', false,
      'methods', '[]'::jsonb,
      'recent_closures', '[]'::jsonb
    );
  end if;

  target_date := private.first_unclosed_cash_day(p_organization_id, today);
  if target_date is null and not exists (
    select 1 from public.daily_cash_closures
    where organization_id = p_organization_id and business_date = today
  ) then
    target_date := today;
  end if;

  select jsonb_build_object(
    'configured', true,
    'business_date', target_date,
    'is_overdue', target_date is not null and target_date < today,
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_method_id', method.id,
        'name', method.name,
        'code', method.code
      ) order by method.sort_order, method.name)
      from public.cash_accounts as account
      join public.payment_methods as method
        on method.id = account.payment_method_id
       and method.organization_id = account.organization_id
      where account.organization_id = p_organization_id and method.is_active
    ), '[]'::jsonb),
    'recent_closures', coalesce((
      select jsonb_agg(row_data order by business_date desc)
      from (
        select
          closure.business_date,
          closure.status,
          closure.closed_at,
          closure.absolute_difference_total
        from public.daily_cash_closures as closure
        where closure.organization_id = p_organization_id
          and (actor_role in ('owner', 'admin') or closure.closed_by = actor_id)
        order by closure.business_date desc
        limit 7
      ) as row_data
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_daily_cash_closure_workspace(uuid) from public, anon;
grant execute on function public.get_daily_cash_closure_workspace(uuid) to authenticated, service_role;

create function public.close_daily_cash(
  p_organization_id uuid,
  p_business_date date,
  p_counted_balances jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  target_date date;
  required_from date;
  expected_count integer;
  supplied_count integer;
  distinct_count integer;
  day_start timestamptz;
  day_end timestamptz;
  effective_close_time timestamptz;
  created_closure_id uuid;
  expected_total numeric(14, 2);
  counted_total numeric(14, 2);
  difference_total numeric(14, 2);
  absolute_difference_total numeric(14, 2);
  closure_status text;
  item record;
  result jsonb;
begin
  if actor_id is null or not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;

  select settings.daily_closure_required_from into required_from
  from public.cash_tracking_settings as settings
  where settings.organization_id = p_organization_id
  for update;
  if required_from is null then
    raise exception using errcode = '23514', message = 'Cash tracking must be configured first';
  end if;
  if p_business_date is null or p_business_date < required_from or p_business_date > today then
    raise exception using errcode = '22007', message = 'Invalid daily cash closure date';
  end if;
  if jsonb_typeof(p_counted_balances) <> 'array' then
    raise exception using errcode = '22023', message = 'Counted balances must be an array';
  end if;

  target_date := private.first_unclosed_cash_day(p_organization_id, today);
  if target_date is null and not exists (
    select 1 from public.daily_cash_closures
    where organization_id = p_organization_id and business_date = today
  ) then
    target_date := today;
  end if;
  if target_date is null or p_business_date <> target_date then
    raise exception using errcode = '23514', message = 'Close the oldest pending business date first';
  end if;

  select count(*) into expected_count
  from public.cash_accounts as account
  join public.payment_methods as method
    on method.id = account.payment_method_id
   and method.organization_id = account.organization_id
  where account.organization_id = p_organization_id and method.is_active;

  select count(*), count(distinct payment_method_id)
  into supplied_count, distinct_count
  from jsonb_to_recordset(p_counted_balances) as counted(payment_method_id uuid, counted_balance numeric)
  where counted_balance is not null and counted_balance >= 0 and counted_balance <= 999999999;

  if supplied_count <> distinct_count or supplied_count <> expected_count or exists (
    select 1
    from jsonb_to_recordset(p_counted_balances) as counted(payment_method_id uuid, counted_balance numeric)
    left join public.cash_accounts as account
      on account.payment_method_id = counted.payment_method_id
     and account.organization_id = p_organization_id
    left join public.payment_methods as method
      on method.id = account.payment_method_id
     and method.organization_id = account.organization_id
     and method.is_active
    where method.id is null
      or counted.counted_balance is null
      or counted.counted_balance < 0
      or counted.counted_balance > 999999999
  ) then
    raise exception using errcode = '22023', message = 'Provide one valid counted balance for every active payment method';
  end if;

  day_start := p_business_date::timestamp at time zone 'America/Argentina/Buenos_Aires';
  day_end := (p_business_date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  effective_close_time := least(now(), day_end - interval '1 microsecond');

  with account_values as (
    select
      account.id as cash_account_id,
      counted.counted_balance,
      coalesce(sum(movement.signed_amount) filter (where movement.occurred_at < day_start), 0) as opening_balance,
      coalesce(sum(movement.amount) filter (
        where movement.occurred_at >= day_start and movement.occurred_at < day_end and movement.direction = 'credit'
      ), 0) as income,
      coalesce(sum(movement.amount) filter (
        where movement.occurred_at >= day_start and movement.occurred_at < day_end and movement.direction = 'debit'
      ), 0) as expense
    from public.cash_accounts as account
    join public.payment_methods as method
      on method.id = account.payment_method_id
     and method.organization_id = account.organization_id
     and method.is_active
    join jsonb_to_recordset(p_counted_balances) as counted(payment_method_id uuid, counted_balance numeric)
      on counted.payment_method_id = account.payment_method_id
    left join public.cash_movements as movement
      on movement.cash_account_id = account.id
     and movement.organization_id = account.organization_id
     and movement.occurred_at < day_end
    where account.organization_id = p_organization_id
    group by account.id, counted.counted_balance
  ), calculated as (
    select
      counted_balance,
      opening_balance + income - expense as expected_balance
    from account_values
  )
  select
    round(sum(expected_balance), 2),
    round(sum(counted_balance), 2),
    round(sum(counted_balance - expected_balance), 2),
    round(sum(abs(counted_balance - expected_balance)), 2)
  into expected_total, counted_total, difference_total, absolute_difference_total
  from calculated;

  closure_status := case when absolute_difference_total = 0 then 'balanced' else 'difference' end;
  perform set_config('morita.daily_cash_closure_write', 'close', true);
  insert into public.daily_cash_closures (
    organization_id, business_date, status, expected_total, counted_total,
    difference_total, absolute_difference_total, notes, closed_at, closed_by
  ) values (
    p_organization_id, p_business_date, closure_status, expected_total, counted_total,
    difference_total, absolute_difference_total, nullif(trim(p_notes), ''), now(), actor_id
  ) returning id into created_closure_id;

  perform set_config('morita.daily_cash_closure_write', 'close', true);
  insert into public.daily_cash_closure_items (
    organization_id, closure_id, cash_account_id, payment_method_id,
    payment_method_name, sort_order, opening_balance, income, expense,
    expected_balance, counted_balance, difference
  )
  select
    p_organization_id,
    created_closure_id,
    account.id,
    method.id,
    method.name,
    method.sort_order,
    movement_totals.opening_balance,
    movement_totals.income,
    movement_totals.expense,
    movement_totals.opening_balance + movement_totals.income - movement_totals.expense,
    round(counted.counted_balance, 2),
    round(counted.counted_balance - (
      movement_totals.opening_balance + movement_totals.income - movement_totals.expense
    ), 2)
  from public.cash_accounts as account
  join public.payment_methods as method
    on method.id = account.payment_method_id
   and method.organization_id = account.organization_id
   and method.is_active
  join jsonb_to_recordset(p_counted_balances) as counted(payment_method_id uuid, counted_balance numeric)
    on counted.payment_method_id = account.payment_method_id
  cross join lateral (
    select
      coalesce(sum(movement.signed_amount) filter (where movement.occurred_at < day_start), 0) as opening_balance,
      coalesce(sum(movement.amount) filter (
        where movement.occurred_at >= day_start and movement.occurred_at < day_end and movement.direction = 'credit'
      ), 0) as income,
      coalesce(sum(movement.amount) filter (
        where movement.occurred_at >= day_start and movement.occurred_at < day_end and movement.direction = 'debit'
      ), 0) as expense
    from public.cash_movements as movement
    where movement.cash_account_id = account.id
      and movement.organization_id = account.organization_id
      and movement.occurred_at < day_end
  ) as movement_totals
  where account.organization_id = p_organization_id;

  for item in
    select * from public.daily_cash_closure_items as closure_item
    where closure_item.closure_id = created_closure_id
      and closure_item.organization_id = p_organization_id
      and closure_item.difference <> 0
    order by sort_order, payment_method_name
  loop
    perform private.append_cash_movement(
      p_organization_id,
      item.cash_account_id,
      'adjustment',
      case when item.difference > 0 then 'credit'::public.cash_movement_direction else 'debit'::public.cash_movement_direction end,
      abs(item.difference),
      'daily_cash_closure',
      created_closure_id,
      null,
      null,
      'daily-closure:' || created_closure_id::text || ':' || item.payment_method_id::text,
      case when item.difference > 0 then 'Sobrante detectado en cierre diario' else 'Faltante detectado en cierre diario' end,
      effective_close_time,
      actor_id,
      jsonb_build_object(
        'business_date', p_business_date,
        'expected_balance', item.expected_balance,
        'counted_balance', item.counted_balance,
        'difference', item.difference
      )
    );
  end loop;

  select jsonb_build_object(
    'id', closure.id,
    'business_date', closure.business_date,
    'status', closure.status,
    'expected_total', closure.expected_total,
    'counted_total', closure.counted_total,
    'difference_total', closure.difference_total,
    'absolute_difference_total', closure.absolute_difference_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_method_id', entry.payment_method_id,
        'name', entry.payment_method_name,
        'expected_balance', entry.expected_balance,
        'counted_balance', entry.counted_balance,
        'difference', entry.difference
      ) order by entry.sort_order, entry.payment_method_name)
      from public.daily_cash_closure_items as entry
      where entry.closure_id = closure.id and entry.organization_id = closure.organization_id
    ), '[]'::jsonb)
  ) into result
  from public.daily_cash_closures as closure
  where closure.id = created_closure_id and closure.organization_id = p_organization_id;
  return result;
end;
$$;

revoke all on function public.close_daily_cash(uuid, date, jsonb, text) from public, anon;
grant execute on function public.close_daily_cash(uuid, date, jsonb, text) to authenticated, service_role;

create function public.list_daily_cash_closures(
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
      closure.status,
      closure.expected_total,
      closure.counted_total,
      closure.difference_total,
      closure.absolute_difference_total,
      closure.notes,
      closure.closed_at,
      closure.closed_by,
      coalesce(nullif(trim(profile.display_name), ''), profile.email, closure.closed_by::text) as closed_by_name,
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

revoke all on function public.list_daily_cash_closures(uuid, integer, integer) from public, anon;
grant execute on function public.list_daily_cash_closures(uuid, integer, integer) to authenticated, service_role;

comment on table public.daily_cash_closures is
  'Immutable daily control header with the expected, counted and original difference totals.';
comment on table public.daily_cash_closure_items is
  'Immutable per-payment-method snapshots captured before any balancing adjustment is appended to the ledger.';
