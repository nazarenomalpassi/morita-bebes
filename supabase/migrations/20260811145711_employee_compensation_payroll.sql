create type public.commission_type as enum ('total_store_sales');
create type public.payroll_settlement_status as enum ('settled', 'paid');

alter table public.employees
  add column user_id uuid references auth.users(id) on delete set null;

create unique index employees_org_user_key
  on public.employees (organization_id, user_id)
  where user_id is not null;

create table public.employee_compensations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  base_salary numeric(14, 2) not null check (base_salary >= 0),
  commission_percentage numeric(7, 4) not null default 0
    check (commission_percentage between 0 and 100),
  commission_type public.commission_type not null default 'total_store_sales',
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_compensations_employee_fk foreign key (employee_id, organization_id)
    references public.employees(id, organization_id) on delete restrict,
  constraint employee_compensations_period_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint employee_compensations_start_key unique (employee_id, effective_from)
);

create index employee_compensations_lookup_idx
  on public.employee_compensations (organization_id, employee_id, effective_from desc)
  where is_active;

create table public.payroll_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  compensation_id uuid references public.employee_compensations(id) on delete restrict,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  base_salary numeric(14, 2) not null check (base_salary >= 0),
  commission_percentage numeric(7, 4) not null check (commission_percentage between 0 and 100),
  commission_type public.commission_type not null,
  commission_base numeric(14, 2) not null check (commission_base >= 0),
  commission_amount numeric(14, 2) not null check (commission_amount >= 0),
  gross_salary numeric(14, 2) not null check (gross_salary >= 0),
  sales_count integer not null default 0 check (sales_count >= 0),
  status public.payroll_settlement_status not null default 'settled',
  settled_at timestamptz not null default now(),
  settled_by uuid not null references auth.users(id) on delete restrict,
  paid_at date,
  paid_by uuid references auth.users(id) on delete restrict,
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_settlements_employee_fk foreign key (employee_id, organization_id)
    references public.employees(id, organization_id) on delete restrict,
  constraint payroll_settlements_period_key unique (employee_id, period_month),
  constraint payroll_settlements_total_check check (
    gross_salary = base_salary + commission_amount
  ),
  constraint payroll_settlements_payment_check check (
    (status = 'settled' and paid_at is null and paid_by is null)
    or
    (status = 'paid' and paid_at is not null and paid_by is not null)
  )
);

create index payroll_settlements_org_period_idx
  on public.payroll_settlements (organization_id, period_month desc, employee_id);

alter table public.payroll_movements
  add column settlement_id uuid references public.payroll_settlements(id) on delete restrict;

create unique index payroll_movements_settlement_key
  on public.payroll_movements (settlement_id)
  where settlement_id is not null;

create or replace function private.guard_settlement_payroll_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.settlement_id is not null then
    raise exception using errcode = '42501', message = 'Payroll movements created from settlements are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.guard_settlement_payroll_movement() from public, anon, authenticated;

create trigger payroll_movements_guard_settlement_link
before update or delete on public.payroll_movements
for each row execute function private.guard_settlement_payroll_movement();

create trigger employee_compensations_set_updated_at
before update on public.employee_compensations
for each row execute function private.set_updated_at();

create trigger payroll_settlements_set_updated_at
before update on public.payroll_settlements
for each row execute function private.set_updated_at();

create or replace function private.guard_employee_user_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is not null and not exists (
    select 1
    from public.organization_members as member
    where member.organization_id = new.organization_id
      and member.user_id = new.user_id
      and member.role = 'staff'
      and member.is_active
  ) then
    raise exception using
      errcode = '23514',
      message = 'Employee account must be an active staff member of the organization';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_employee_user_link() from public, anon, authenticated;

create trigger employees_guard_user_link
before insert or update of user_id, organization_id on public.employees
for each row execute function private.guard_employee_user_link();

create or replace function private.guard_compensation_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_active and exists (
    select 1
    from public.employee_compensations as compensation
    where compensation.employee_id = new.employee_id
      and compensation.organization_id = new.organization_id
      and compensation.id <> new.id
      and compensation.is_active
      and daterange(
        compensation.effective_from,
        coalesce(compensation.effective_to + 1, 'infinity'::date),
        '[)'
      ) && daterange(
        new.effective_from,
        coalesce(new.effective_to + 1, 'infinity'::date),
        '[)'
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'Compensation periods cannot overlap';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_compensation_period() from public, anon, authenticated;

create constraint trigger employee_compensations_guard_period
after insert or update on public.employee_compensations
deferrable initially deferred
for each row execute function private.guard_compensation_period();

create or replace function private.guard_payroll_settlement_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  payroll_action text := current_setting('morita.payroll_action', true);
begin
  if tg_op = 'INSERT' then
    if payroll_action <> 'settle' then
      raise exception using errcode = '42501', message = 'Payroll settlements must be created through the settlement workflow';
    end if;
    return new;
  end if;

  if payroll_action <> 'mark_paid' then
    raise exception using errcode = '42501', message = 'Payroll settlements can only be updated through the payment workflow';
  end if;

  if old.organization_id is distinct from new.organization_id
     or old.employee_id is distinct from new.employee_id
     or old.compensation_id is distinct from new.compensation_id
     or old.period_month is distinct from new.period_month
     or old.base_salary is distinct from new.base_salary
     or old.commission_percentage is distinct from new.commission_percentage
     or old.commission_type is distinct from new.commission_type
     or old.commission_base is distinct from new.commission_base
     or old.commission_amount is distinct from new.commission_amount
     or old.gross_salary is distinct from new.gross_salary
     or old.sales_count is distinct from new.sales_count
     or old.settled_at is distinct from new.settled_at
     or old.settled_by is distinct from new.settled_by then
    raise exception using errcode = '42501', message = 'Historical payroll amounts are immutable';
  end if;

  if old.status = 'paid' then
    raise exception using errcode = '42501', message = 'A paid payroll settlement is immutable';
  end if;

  if new.status <> 'paid' then
    raise exception using errcode = '23514', message = 'Invalid payroll settlement status transition';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_payroll_settlement_write() from public, anon, authenticated;

create trigger payroll_settlements_guard_write
before insert or update on public.payroll_settlements
for each row execute function private.guard_payroll_settlement_write();

create or replace function private.reject_payroll_settlement_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Payroll settlements cannot be deleted';
end;
$$;

revoke all on function private.reject_payroll_settlement_delete() from public, anon, authenticated;

create trigger payroll_settlements_reject_delete
before delete on public.payroll_settlements
for each row execute function private.reject_payroll_settlement_delete();

alter table public.employee_compensations enable row level security;
alter table public.payroll_settlements enable row level security;

create policy "authorized users read employee compensations"
on public.employee_compensations for select to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (
    private.has_org_role(organization_id, array['staff']::public.app_role[])
    and exists (
      select 1 from public.employees as employee
      where employee.id = employee_compensations.employee_id
        and employee.organization_id = employee_compensations.organization_id
        and employee.user_id = (select auth.uid())
    )
  )
);

create policy "owners and admins insert employee compensations"
on public.employee_compensations for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins update employee compensations"
on public.employee_compensations for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "authorized users read payroll settlements"
on public.payroll_settlements for select to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (
    private.has_org_role(organization_id, array['staff']::public.app_role[])
    and exists (
      select 1 from public.employees as employee
      where employee.id = payroll_settlements.employee_id
        and employee.organization_id = payroll_settlements.organization_id
        and employee.user_id = (select auth.uid())
    )
  )
);

create policy "owners and admins insert payroll settlements"
on public.payroll_settlements for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins update payroll settlements"
on public.payroll_settlements for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

drop policy "owners and admins manage employees" on public.employees;

create policy "authorized users read employee profiles"
on public.employees for select to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (
    user_id = (select auth.uid())
    and private.has_org_role(organization_id, array['staff']::public.app_role[])
  )
);

create policy "owners and admins insert employees"
on public.employees for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins update employees"
on public.employees for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins delete employees"
on public.employees for delete to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

grant select, insert, update on public.employee_compensations to authenticated;
grant select, insert, update on public.payroll_settlements to authenticated;
revoke delete on public.employee_compensations from authenticated;
revoke delete on public.payroll_settlements from authenticated;
grant all privileges on public.employee_compensations, public.payroll_settlements to service_role;

create trigger audit_employee_compensations
after insert or update or delete on public.employee_compensations
for each row execute function private.audit_row_change();

create trigger audit_payroll_settlements
after insert or update or delete on public.payroll_settlements
for each row execute function private.audit_row_change();

create or replace function private.get_monthly_store_sales(
  target_organization_id uuid,
  target_period_month date
)
returns table (
  gross_sales numeric,
  sale_count bigint,
  last_updated timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(sale.total), 0)::numeric as gross_sales,
    count(*)::bigint as sale_count,
    max(sale.updated_at) as last_updated
  from public.sales as sale
  where sale.organization_id = target_organization_id
    and sale.status = 'completed'
    and sale.occurred_at >= target_period_month::timestamp at time zone 'America/Argentina/Buenos_Aires'
    and sale.occurred_at < (target_period_month + interval '1 month')::timestamp at time zone 'America/Argentina/Buenos_Aires'
    and exists (
      select 1
      from public.organization_members as member
      where member.organization_id = target_organization_id
        and member.user_id = (select auth.uid())
        and member.is_active
    );
$$;

revoke all on function private.get_monthly_store_sales(uuid, date) from public, anon;
grant execute on function private.get_monthly_store_sales(uuid, date) to authenticated, service_role;

create or replace function public.get_payroll_dashboard(
  p_organization_id uuid,
  p_period_month date,
  p_employee_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_is_admin boolean;
  actor_employee_id uuid;
  period_end date;
  local_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  days_in_month integer;
  elapsed_days integer;
  sales_total numeric := 0;
  operations bigint := 0;
  sales_last_updated timestamptz;
  projection_available boolean := false;
  projected_sales numeric;
  employee_rows jsonb;
begin
  if actor_id is null or not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  if p_period_month <> date_trunc('month', p_period_month)::date then
    raise exception using errcode = '22007', message = 'Payroll period must be the first day of a month';
  end if;

  actor_is_admin := private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  );

  if not actor_is_admin then
    select employee.id into actor_employee_id
    from public.employees as employee
    where employee.organization_id = p_organization_id
      and employee.user_id = actor_id
      and employee.status = 'active';

    if p_employee_id is not null and p_employee_id is distinct from actor_employee_id then
      raise exception using errcode = '42501', message = 'Employees can only read their own payroll';
    end if;
  end if;

  period_end := (p_period_month + interval '1 month')::date;
  days_in_month := period_end - p_period_month;
  elapsed_days := case
    when local_today < p_period_month then 0
    when local_today >= period_end then days_in_month
    else local_today - p_period_month + 1
  end;

  select totals.gross_sales, totals.sale_count, totals.last_updated
  into sales_total, operations, sales_last_updated
  from private.get_monthly_store_sales(p_organization_id, p_period_month) as totals;

  projection_available := p_period_month = date_trunc('month', local_today)::date
    and elapsed_days >= 3
    and operations > 0;
  if projection_available then
    projected_sales := round((sales_total / elapsed_days) * days_in_month, 2);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', row_data.id,
      'userId', row_data.user_id,
      'name', trim(row_data.first_name || ' ' || row_data.last_name),
      'status', row_data.status,
      'configured', row_data.compensation_id is not null,
      'compensationId', row_data.compensation_id,
      'baseSalary', coalesce(row_data.base_salary, 0),
      'commissionPercentage', coalesce(row_data.commission_percentage, 0),
      'commissionType', coalesce(row_data.commission_type::text, 'total_store_sales'),
      'effectiveFrom', row_data.effective_from,
      'effectiveTo', row_data.effective_to,
      'grossSales', sales_total,
      'salesCount', operations,
      'commissionAmount', round(sales_total * coalesce(row_data.commission_percentage, 0) / 100, 2),
      'estimatedSalary', coalesce(row_data.base_salary, 0) + round(sales_total * coalesce(row_data.commission_percentage, 0) / 100, 2),
      'projectedSales', case when projection_available then projected_sales else null end,
      'projectedCommission', case when projection_available then round(projected_sales * coalesce(row_data.commission_percentage, 0) / 100, 2) else null end,
      'projectedSalary', case when projection_available then coalesce(row_data.base_salary, 0) + round(projected_sales * coalesce(row_data.commission_percentage, 0) / 100, 2) else null end,
      'lastUpdated', sales_last_updated,
      'settlement', case when row_data.settlement_id is null then null else jsonb_build_object(
        'id', row_data.settlement_id,
        'periodMonth', row_data.settlement_period,
        'baseSalary', row_data.settlement_base_salary,
        'commissionPercentage', row_data.settlement_percentage,
        'commissionBase', row_data.settlement_commission_base,
        'commissionAmount', row_data.settlement_commission_amount,
        'grossSalary', row_data.settlement_gross_salary,
        'salesCount', row_data.settlement_sales_count,
        'status', row_data.settlement_status,
        'settledAt', row_data.settled_at,
        'paidAt', row_data.paid_at,
        'paymentMethod', row_data.payment_method,
        'notes', row_data.settlement_notes
      ) end
    ) order by row_data.last_name, row_data.first_name
  ), '[]'::jsonb)
  into employee_rows
  from (
    select
      employee.id,
      employee.user_id,
      employee.first_name,
      employee.last_name,
      employee.status,
      compensation.id as compensation_id,
      compensation.base_salary,
      compensation.commission_percentage,
      compensation.commission_type,
      compensation.effective_from,
      compensation.effective_to,
      settlement.id as settlement_id,
      settlement.period_month as settlement_period,
      settlement.base_salary as settlement_base_salary,
      settlement.commission_percentage as settlement_percentage,
      settlement.commission_base as settlement_commission_base,
      settlement.commission_amount as settlement_commission_amount,
      settlement.gross_salary as settlement_gross_salary,
      settlement.sales_count as settlement_sales_count,
      settlement.status as settlement_status,
      settlement.settled_at,
      settlement.paid_at,
      settlement.payment_method,
      settlement.notes as settlement_notes
    from public.employees as employee
    left join lateral (
      select candidate.*
      from public.employee_compensations as candidate
      where candidate.organization_id = employee.organization_id
        and candidate.employee_id = employee.id
        and candidate.is_active
        and candidate.effective_from < period_end
        and (candidate.effective_to is null or candidate.effective_to >= p_period_month)
      order by candidate.effective_from desc
      limit 1
    ) as compensation on true
    left join public.payroll_settlements as settlement
      on settlement.organization_id = employee.organization_id
     and settlement.employee_id = employee.id
     and settlement.period_month = p_period_month
    where employee.organization_id = p_organization_id
      and (
        (actor_is_admin and (p_employee_id is null or employee.id = p_employee_id))
        or
        (not actor_is_admin and employee.id = actor_employee_id)
      )
  ) as row_data;

  return jsonb_build_object(
    'meta', jsonb_build_object(
      'periodMonth', p_period_month,
      'periodEnd', period_end - 1,
      'currentDate', local_today,
      'daysElapsed', elapsed_days,
      'daysInMonth', days_in_month,
      'isCurrentMonth', p_period_month = date_trunc('month', local_today)::date,
      'projectionAvailable', projection_available,
      'scope', 'total_store_sales',
      'generatedAt', now(),
      'employeeLinked', actor_is_admin or actor_employee_id is not null
    ),
    'employees', employee_rows
  );
end;
$$;

create or replace function public.set_employee_compensation(
  p_organization_id uuid,
  p_employee_id uuid,
  p_base_salary numeric,
  p_commission_percentage numeric,
  p_effective_from date,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  compensation_id uuid;
  next_effective_from date;
begin
  if actor_id is null or not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Administrator role is required';
  end if;
  if p_base_salary < 0 or p_base_salary > 999999999 then
    raise exception using errcode = '22003', message = 'Invalid base salary';
  end if;
  if p_commission_percentage < 0 or p_commission_percentage > 100 then
    raise exception using errcode = '22003', message = 'Invalid commission percentage';
  end if;
  if p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception using errcode = '22007', message = 'Compensation must start on the first day of a month';
  end if;
  if not exists (
    select 1 from public.employees
    where id = p_employee_id and organization_id = p_organization_id
  ) then
    raise exception using errcode = 'P0002', message = 'Employee not found';
  end if;

  select min(compensation.effective_from)
  into next_effective_from
  from public.employee_compensations as compensation
  where compensation.employee_id = p_employee_id
    and compensation.organization_id = p_organization_id
    and compensation.is_active
    and compensation.effective_from > p_effective_from;

  update public.employee_compensations
  set effective_to = p_effective_from - 1
  where employee_id = p_employee_id
    and organization_id = p_organization_id
    and is_active
    and effective_from < p_effective_from
    and (effective_to is null or effective_to >= p_effective_from);

  insert into public.employee_compensations (
    organization_id,
    employee_id,
    base_salary,
    commission_percentage,
    commission_type,
    effective_from,
    effective_to,
    is_active,
    notes,
    created_by
  ) values (
    p_organization_id,
    p_employee_id,
    round(p_base_salary, 2),
    round(p_commission_percentage, 4),
    'total_store_sales',
    p_effective_from,
    case when next_effective_from is null then null else next_effective_from - 1 end,
    true,
    nullif(trim(p_notes), ''),
    actor_id
  )
  on conflict (employee_id, effective_from) do update
  set base_salary = excluded.base_salary,
      commission_percentage = excluded.commission_percentage,
      commission_type = excluded.commission_type,
      effective_to = excluded.effective_to,
      is_active = true,
      notes = excluded.notes
  returning id into compensation_id;

  if p_effective_from <= (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    update public.employees
    set base_salary = round(p_base_salary, 2)
    where id = p_employee_id and organization_id = p_organization_id;
  end if;

  return compensation_id;
end;
$$;

create or replace function public.settle_employee_payroll(
  p_organization_id uuid,
  p_employee_id uuid,
  p_period_month date,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  compensation public.employee_compensations%rowtype;
  totals record;
  settlement_id uuid;
  commission_value numeric(14, 2);
begin
  if actor_id is null or not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Administrator role is required';
  end if;
  if p_period_month <> date_trunc('month', p_period_month)::date then
    raise exception using errcode = '22007', message = 'Payroll period must be the first day of a month';
  end if;
  if p_period_month >= date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception using errcode = '22023', message = 'The payroll period must be closed before settlement';
  end if;

  select candidate.* into compensation
  from public.employee_compensations as candidate
  where candidate.organization_id = p_organization_id
    and candidate.employee_id = p_employee_id
    and candidate.is_active
    and candidate.effective_from < p_period_month + interval '1 month'
    and (candidate.effective_to is null or candidate.effective_to >= p_period_month)
  order by candidate.effective_from desc
  limit 1;

  if compensation.id is null then
    raise exception using errcode = 'P0002', message = 'No compensation is configured for this period';
  end if;

  select * into totals
  from private.get_monthly_store_sales(p_organization_id, p_period_month);
  commission_value := round(totals.gross_sales * compensation.commission_percentage / 100, 2);

  perform set_config('morita.payroll_action', 'settle', true);
  insert into public.payroll_settlements (
    organization_id,
    employee_id,
    compensation_id,
    period_month,
    base_salary,
    commission_percentage,
    commission_type,
    commission_base,
    commission_amount,
    gross_salary,
    sales_count,
    status,
    settled_at,
    settled_by,
    notes
  ) values (
    p_organization_id,
    p_employee_id,
    compensation.id,
    p_period_month,
    compensation.base_salary,
    compensation.commission_percentage,
    compensation.commission_type,
    round(totals.gross_sales, 2),
    commission_value,
    compensation.base_salary + commission_value,
    totals.sale_count::integer,
    'settled',
    now(),
    actor_id,
    nullif(trim(p_notes), '')
  )
  returning id into settlement_id;

  return settlement_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Payroll for this employee and period is already settled';
end;
$$;

create or replace function public.mark_payroll_settlement_paid(
  p_organization_id uuid,
  p_settlement_id uuid,
  p_paid_at date,
  p_payment_method text,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  settlement public.payroll_settlements%rowtype;
begin
  if actor_id is null or not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Administrator role is required';
  end if;
  if p_paid_at is null or p_paid_at > (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception using errcode = '22007', message = 'Invalid payment date';
  end if;
  if nullif(trim(p_payment_method), '') is null or char_length(trim(p_payment_method)) > 80 then
    raise exception using errcode = '22023', message = 'Payment method is required';
  end if;

  select * into settlement
  from public.payroll_settlements
  where id = p_settlement_id and organization_id = p_organization_id
  for update;

  if settlement.id is null then
    raise exception using errcode = 'P0002', message = 'Payroll settlement not found';
  end if;
  if settlement.status = 'paid' then
    return settlement.id;
  end if;

  perform set_config('morita.payroll_action', 'mark_paid', true);
  update public.payroll_settlements
  set status = 'paid',
      paid_at = p_paid_at,
      paid_by = actor_id,
      payment_method = trim(p_payment_method),
      notes = coalesce(nullif(trim(p_notes), ''), notes)
  where id = settlement.id;

  insert into public.payroll_movements (
    organization_id,
    employee_id,
    kind,
    amount,
    period_month,
    paid_at,
    notes,
    created_by,
    settlement_id
  ) values (
    settlement.organization_id,
    settlement.employee_id,
    'salary',
    settlement.gross_salary,
    settlement.period_month,
    p_paid_at,
    'Liquidación mensual automática',
    actor_id,
    settlement.id
  )
  on conflict (settlement_id) where settlement_id is not null do nothing;

  return settlement.id;
end;
$$;

revoke all on function public.get_payroll_dashboard(uuid, date, uuid) from public, anon;
revoke all on function public.set_employee_compensation(uuid, uuid, numeric, numeric, date, text) from public, anon;
revoke all on function public.settle_employee_payroll(uuid, uuid, date, text) from public, anon;
revoke all on function public.mark_payroll_settlement_paid(uuid, uuid, date, text, text) from public, anon;

grant execute on function public.get_payroll_dashboard(uuid, date, uuid) to authenticated, service_role;
grant execute on function public.set_employee_compensation(uuid, uuid, numeric, numeric, date, text) to authenticated, service_role;
grant execute on function public.settle_employee_payroll(uuid, uuid, date, text) to authenticated, service_role;
grant execute on function public.mark_payroll_settlement_paid(uuid, uuid, date, text, text) to authenticated, service_role;

-- Link an existing employee only when their email already belongs to active staff.
update public.employees as employee
set user_id = member.user_id
from public.organization_members as member
join public.user_profiles as profile on profile.user_id = member.user_id
where member.organization_id = employee.organization_id
  and member.role = 'staff'
  and member.is_active
  and employee.user_id is null
  and employee.email is not null
  and lower(profile.email) = lower(employee.email);

-- Initial commercial conditions requested for the existing team, effective August 2026.
insert into public.employee_compensations (
  organization_id,
  employee_id,
  base_salary,
  commission_percentage,
  commission_type,
  effective_from,
  notes,
  created_by
)
select
  employee.organization_id,
  employee.id,
  employee.base_salary,
  1,
  'total_store_sales',
  date '2026-08-01',
  'Configuración inicial: 1% sobre ventas brutas válidas del local',
  organization.created_by
from public.employees as employee
join public.organizations as organization on organization.id = employee.organization_id
where not exists (
  select 1 from public.employee_compensations as existing
  where existing.employee_id = employee.id
    and existing.effective_from = date '2026-08-01'
);
