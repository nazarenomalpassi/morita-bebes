-- New salary advances are paid only from Personal. Existing expenses and
-- historical payroll records remain intact and readable.
alter table public.payroll_movements
  add column payment_method_id uuid,
  add column voided_at timestamptz,
  add column voided_by uuid references auth.users(id) on delete restrict,
  add column void_reason text;

alter table public.payroll_movements
  add constraint payroll_movements_payment_method_fk
    foreign key (payment_method_id, organization_id)
    references public.payment_methods(id, organization_id) on delete restrict,
  add constraint payroll_movements_void_complete_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null
      and char_length(trim(void_reason)) between 3 and 500)
  );

create index payroll_movements_active_advances_idx
  on public.payroll_movements (organization_id, employee_id, period_month)
  where kind = 'advance' and voided_at is null;

create or replace function private.guard_personnel_movement_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  workflow text := current_setting('morita.personnel_action', true);
begin
  if tg_op = 'INSERT' then
    if new.expense_id is not null
      and current_setting('morita.payroll_expense_sync', true) = 'sync'
    then return new; end if;
    if new.settlement_id is not null
      and current_setting('morita.payroll_action', true) = 'mark_paid'
    then return new; end if;
    if workflow = 'create_advance'
      and new.kind = 'advance'
      and new.expense_id is null
      and new.settlement_id is null
      and new.payment_method_id is not null
      and new.paid_at is not null
      and new.voided_at is null
    then return new; end if;
  elsif tg_op = 'DELETE' then
    if old.expense_id is not null
      and current_setting('morita.payroll_expense_sync', true) = 'sync'
    then return old; end if;
  elsif tg_op = 'UPDATE' then
    if old.expense_id is not null
      and current_setting('morita.payroll_expense_sync', true) = 'sync'
    then return new; end if;
    if workflow = 'void_advance'
      and old.kind = 'advance'
      and old.expense_id is null
      and old.settlement_id is null
      and old.payment_method_id is not null
      and old.voided_at is null
      and new.voided_at is not null
      and new.voided_by = (select auth.uid())
      and (new.id, new.organization_id, new.employee_id, new.kind,
        new.amount, new.period_month, new.paid_at, new.notes,
        new.created_by, new.created_at, new.expense_id,
        new.settlement_id, new.payment_method_id)
        is not distinct from
        (old.id, old.organization_id, old.employee_id, old.kind,
        old.amount, old.period_month, old.paid_at, old.notes,
        old.created_by, old.created_at, old.expense_id,
        old.settlement_id, old.payment_method_id)
    then return new; end if;
  end if;
  raise exception using errcode = '42501',
    message = 'Payroll movements are managed through Personal workflows';
end;
$$;

create or replace function public.settle_and_pay_employee_payroll(
  p_organization_id uuid, p_employee_id uuid,
  p_period_month date, p_paid_at date,
  p_payments jsonb, p_notes text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare settlement_id uuid;
begin
  settlement_id := public.settle_employee_payroll(
    p_organization_id, p_employee_id, p_period_month, p_notes);
  perform public.mark_payroll_settlement_paid_with_payments(
    p_organization_id, settlement_id, p_paid_at, p_payments, p_notes);
  return settlement_id;
end;
$$;

revoke all on function public.settle_and_pay_employee_payroll(
  uuid, uuid, date, date, jsonb, text
) from public, anon;
grant execute on function public.settle_and_pay_employee_payroll(
  uuid, uuid, date, date, jsonb, text
) to authenticated, service_role;

revoke all on function private.guard_personnel_movement_write()
  from public, anon, authenticated;
create trigger guard_personnel_movement_write
before insert or update or delete on public.payroll_movements
for each row execute function private.guard_personnel_movement_write();

create or replace function private.block_new_salary_expenses()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then
    return new;
  end if;
  if exists (
      select 1 from public.expense_categories category
      where category.id = new.category_id
        and category.organization_id = new.organization_id
        and category.is_payroll_advance
    ) then
    raise exception using errcode = '23514',
      message = 'Salary advances must be registered in Personal';
  end if;
  return new;
end;
$$;

revoke all on function private.block_new_salary_expenses()
  from public, anon, authenticated;
create trigger block_new_salary_expenses
before insert or update of category_id on public.expenses
for each row execute function private.block_new_salary_expenses();

create or replace function private.apply_personnel_advance_cash_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid;
  original public.cash_movements%rowtype;
  cutoff timestamptz;
begin
  if tg_op = 'INSERT'
    and new.kind = 'advance'
    and new.payment_method_id is not null
    and new.expense_id is null
  then
    select tracking_started_at into cutoff from public.cash_tracking_settings
    where organization_id = new.organization_id;
    if cutoff is null or private.cash_date_at_noon(new.paid_at) < cutoff then
      raise exception using errcode = '55000', message = 'Cash tracking is required for salary advances';
    end if;
    account_id := private.financial_cash_account_id(new.organization_id, new.payment_method_id);
    if account_id is null then
      raise exception using errcode = '23503', message = 'Payment method has no cash account';
    end if;
    perform private.append_cash_movement(
      new.organization_id, account_id, 'payroll', 'debit', new.amount,
      'payroll_advance', new.id, null, null,
      'payroll-advance:' || new.id::text,
      'Adelanto de sueldo', private.cash_date_at_noon(new.paid_at),
      new.created_by,
      jsonb_build_object('employee_id', new.employee_id,
        'period_month', new.period_month, 'concept', 'advance')
    );
  elsif tg_op = 'UPDATE'
    and old.voided_at is null and new.voided_at is not null
    and old.kind = 'advance' and old.payment_method_id is not null
  then
    select * into original from public.cash_movements
    where organization_id = old.organization_id
      and reference_type = 'payroll_advance'
      and reference_id = old.id
      and type = 'payroll' and direction = 'debit'
    order by created_at limit 1;
    if original.id is null then
      raise exception using errcode = 'P0002', message = 'Original advance cash movement was not found';
    end if;
    perform private.append_cash_movement(
      old.organization_id, original.cash_account_id, 'adjustment', 'credit', old.amount,
      'payroll_advance', old.id, null, original.id,
      'payroll-advance-void:' || old.id::text,
      'Anulacion de adelanto', new.voided_at, new.voided_by,
      jsonb_build_object('employee_id', old.employee_id,
        'period_month', old.period_month, 'concept', 'advance_void',
        'reason', new.void_reason)
    );
  end if;
  return new;
end;
$$;

revoke all on function private.apply_personnel_advance_cash_movement()
  from public, anon, authenticated;
create trigger apply_personnel_advance_cash_movement
after insert or update of voided_at on public.payroll_movements
for each row execute function private.apply_personnel_advance_cash_movement();

create or replace function public.register_payroll_advance(
  p_organization_id uuid, p_employee_id uuid, p_period_month date,
  p_amount numeric, p_paid_at date, p_payment_method_id uuid,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := private.require_cash_admin(p_organization_id);
  method_code text;
  movement_id uuid;
  local_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  latest_closure date;
  conditions public.employee_compensations%rowtype;
  sales_total numeric;
  advances_total numeric;
  generated_salary numeric;
begin
  if p_period_month is null
    or p_period_month <> date_trunc('month', p_period_month)::date
    or p_period_month > date_trunc('month', local_today)::date
    or p_amount is null or p_amount <= 0 or p_amount > 999999999
    or p_amount <> round(p_amount, 2)
    or p_paid_at is null or p_paid_at > local_today
    or p_notes is not null and char_length(trim(p_notes)) > 500
  then raise exception using errcode = '22023', message = 'Invalid salary advance details'; end if;

  select code into method_code from public.payment_methods
  where id = p_payment_method_id and organization_id = p_organization_id
    and is_active;
  if method_code not in ('cash', 'transfer') or method_code is null then
    raise exception using errcode = '23514', message = 'Use Cash or Transfer for salary advances';
  end if;
  perform 1 from public.employees
  where id = p_employee_id and organization_id = p_organization_id
    and status = 'active' for update;
  if not found then raise exception using errcode = 'P0002', message = 'Active employee not found'; end if;
  if exists (select 1 from public.payroll_settlements
    where organization_id = p_organization_id and employee_id = p_employee_id
      and period_month = p_period_month) then
    raise exception using errcode = '23514', message = 'Payroll for this period is already settled';
  end if;
  select * into conditions from public.employee_compensations
  where organization_id = p_organization_id and employee_id = p_employee_id
    and is_active and effective_from < (p_period_month + interval '1 month')::date
    and (effective_to is null or effective_to >= p_period_month)
  order by effective_from desc limit 1;
  if conditions.id is null then
    raise exception using errcode = 'P0002', message = 'Salary conditions are not configured for this period';
  end if;
  select gross_sales into sales_total from private.get_monthly_store_sales(
    p_organization_id, p_period_month);
  generated_salary := round(conditions.base_salary
    + round(coalesce(sales_total, 0) * conditions.commission_percentage / 100, 2), 2);
  select coalesce(sum(amount), 0) into advances_total
  from public.payroll_movements where organization_id = p_organization_id
    and employee_id = p_employee_id and period_month = p_period_month
    and kind = 'advance' and voided_at is null;
  if advances_total + p_amount > generated_salary then
    raise exception using errcode = '23514',
      message = 'Advance exceeds the salary generated for this period';
  end if;
  select max(business_date) into latest_closure from public.daily_cash_closures
  where organization_id = p_organization_id;
  if latest_closure is not null and p_paid_at <= latest_closure then
    raise exception using errcode = '22007',
      message = 'Payment date belongs to a closed cash day';
  end if;
  perform set_config('morita.personnel_action', 'create_advance', true);
  insert into public.payroll_movements (
    organization_id, employee_id, kind, amount, period_month,
    paid_at, notes, created_by, payment_method_id
  ) values (
    p_organization_id, p_employee_id, 'advance', p_amount, p_period_month,
    p_paid_at, nullif(trim(p_notes), ''), actor_id, p_payment_method_id
  ) returning id into movement_id;
  return movement_id;
end;
$$;

revoke all on function public.register_payroll_advance(
  uuid, uuid, date, numeric, date, uuid, text
) from public, anon;
grant execute on function public.register_payroll_advance(
  uuid, uuid, date, numeric, date, uuid, text
) to authenticated, service_role;

create or replace function public.void_payroll_advance(
  p_organization_id uuid, p_movement_id uuid, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := private.require_cash_admin(p_organization_id);
  target public.payroll_movements%rowtype;
begin
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'A cancellation reason is required';
  end if;
  select * into target from public.payroll_movements
  where id = p_movement_id and organization_id = p_organization_id for update;
  if target.id is null then raise exception using errcode = 'P0002', message = 'Advance not found'; end if;
  if target.voided_at is not null then return target.id; end if;
  if target.kind <> 'advance' or target.expense_id is not null
    or target.settlement_id is not null or target.payment_method_id is null then
    raise exception using errcode = '23514', message = 'Only new Personal advances can be voided here';
  end if;
  if exists (select 1 from public.payroll_settlements
    where organization_id = target.organization_id
      and employee_id = target.employee_id
      and period_month = target.period_month) then
    raise exception using errcode = '23514', message = 'A settled period cannot be changed';
  end if;
  perform set_config('morita.personnel_action', 'void_advance', true);
  update public.payroll_movements
  set voided_at = now(), voided_by = actor_id, void_reason = trim(p_reason)
  where id = target.id;
  return target.id;
end;
$$;

revoke all on function public.void_payroll_advance(uuid, uuid, text)
  from public, anon;
grant execute on function public.void_payroll_advance(uuid, uuid, text)
  to authenticated, service_role;

create or replace function private.guard_personnel_payment_method()
returns trigger language plpgsql set search_path = '' as $$
declare method_code text;
declare latest_closure date;
begin
  if tg_table_name = 'payroll_settlement_payments' then
    select code into method_code from public.payment_methods
    where id = new.payment_method_id and organization_id = new.organization_id;
    if method_code not in ('cash', 'transfer') or method_code is null then
      raise exception using errcode = '23514',
        message = 'Salary payments use Cash or Transfer only';
    end if;
  elsif old.status <> 'paid' and new.status = 'paid' then
    select max(business_date) into latest_closure
    from public.daily_cash_closures where organization_id = new.organization_id;
    if latest_closure is not null and new.paid_at <= latest_closure then
      raise exception using errcode = '22007',
        message = 'Payment date belongs to a closed cash day';
    end if;
    if new.payment_method_id is not null then
      select code into method_code from public.payment_methods
      where id = new.payment_method_id and organization_id = new.organization_id;
      if method_code not in ('cash', 'transfer') or method_code is null then
        raise exception using errcode = '23514',
          message = 'Salary payments use Cash or Transfer only';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_personnel_payment_method()
  from public, anon, authenticated;
create trigger guard_personnel_payment_allocation
before insert on public.payroll_settlement_payments
for each row execute function private.guard_personnel_payment_method();
create trigger guard_personnel_settlement_payment
before update of status on public.payroll_settlements
for each row execute function private.guard_personnel_payment_method();

create or replace function public.settle_employee_payroll(
  p_organization_id uuid, p_employee_id uuid,
  p_period_month date, p_notes text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  compensation public.employee_compensations%rowtype;
  totals record;
  settlement_id uuid;
  commission_value numeric(14, 2);
  gross_value numeric(14, 2);
  bonus_value numeric(14, 2) := 0;
  advance_value numeric(14, 2) := 0;
  deduction_value numeric(14, 2) := 0;
  net_value numeric(14, 2);
begin
  if actor_id is null or not private.has_org_role(
    p_organization_id, array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Administrator role is required';
  end if;
  if p_period_month is null
    or p_period_month <> date_trunc('month', p_period_month)::date
    or p_period_month >= date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')::date
  then
    raise exception using errcode = '22007', message = 'Only closed calendar months can be settled';
  end if;
  perform 1 from public.employees
  where id = p_employee_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Employee not found';
  end if;
  select candidate.* into compensation
  from public.employee_compensations candidate
  where candidate.organization_id = p_organization_id
    and candidate.employee_id = p_employee_id and candidate.is_active
    and candidate.effective_from < (p_period_month + interval '1 month')::date
    and (candidate.effective_to is null or candidate.effective_to >= p_period_month)
  order by candidate.effective_from desc limit 1;
  if compensation.id is null then
    raise exception using errcode = 'P0002', message = 'No salary conditions for this period';
  end if;
  select * into totals from private.get_monthly_store_sales(
    p_organization_id, p_period_month);
  commission_value := round(totals.gross_sales * compensation.commission_percentage / 100, 2);
  gross_value := round(compensation.base_salary + commission_value, 2);
  select
    coalesce(sum(amount) filter (where kind = 'bonus'), 0),
    coalesce(sum(amount) filter (where kind = 'advance'), 0),
    coalesce(sum(amount) filter (where kind = 'deduction'), 0)
  into bonus_value, advance_value, deduction_value
  from public.payroll_movements
  where organization_id = p_organization_id
    and employee_id = p_employee_id and period_month = p_period_month
    and kind in ('advance', 'bonus', 'deduction') and voided_at is null;
  net_value := round(gross_value + bonus_value - advance_value - deduction_value, 2);
  if net_value < 0 then
    raise exception using errcode = '23514',
      message = 'Advances and deductions exceed generated salary';
  end if;
  perform set_config('morita.payroll_action', 'settle', true);
  insert into public.payroll_settlements (
    organization_id, employee_id, compensation_id, period_month,
    base_salary, commission_percentage, commission_type,
    commission_base, commission_amount, gross_salary,
    bonus_amount, advance_amount, deduction_amount, net_salary,
    sales_count, status, settled_at, settled_by, notes
  ) values (
    p_organization_id, p_employee_id, compensation.id, p_period_month,
    compensation.base_salary, compensation.commission_percentage,
    compensation.commission_type, round(totals.gross_sales, 2),
    commission_value, gross_value, bonus_value, advance_value,
    deduction_value, net_value, totals.sale_count::integer,
    'settled', now(), actor_id, nullif(trim(p_notes), '')
  ) returning id into settlement_id;
  insert into public.payroll_settlement_adjustments (
    organization_id, settlement_id, source_movement_id, kind,
    amount, occurred_on, description, source_type
  )
  select movement.organization_id, settlement_id, movement.id,
    movement.kind, movement.amount,
    coalesce(expense.expense_date, movement.paid_at, movement.period_month),
    coalesce(expense.description, movement.notes, 'Adelanto de sueldo'),
    case when movement.expense_id is null then 'manual' else 'expense' end
  from public.payroll_movements movement
  left join public.expenses expense
    on expense.id = movement.expense_id
   and expense.organization_id = movement.organization_id
  where movement.organization_id = p_organization_id
    and movement.employee_id = p_employee_id
    and movement.period_month = p_period_month
    and movement.kind in ('advance', 'bonus', 'deduction')
    and movement.voided_at is null;
  return settlement_id;
exception when unique_violation then
  raise exception using errcode = '23505',
    message = 'Payroll for this employee and period is already settled';
end;
$$;

-- Keep the existing analytics definition intact except for the financial
-- classification CTEs. Historical salary expenses move from operating
-- expenses to payroll, without touching their rows or cash ledger.
do $migration$
declare
  definition text;
  start_at integer;
  finish_at integer;
begin
  definition := pg_get_functiondef(
    'public.get_business_analytics(uuid,date,date,date,date,date,uuid,uuid,uuid,boolean,text)'::regprocedure
  );
  start_at := position('  expense_rows as materialized (' in definition);
  finish_at := position('  expenses_by_period as (' in definition);
  if start_at = 0 or finish_at <= start_at
    or position('  payroll_rows as materialized (' in definition) = 0 then
    raise exception 'Analytics function structure changed; review required';
  end if;
  definition := substring(definition from 1 for start_at - 1) || $segment$
  expense_rows as materialized (
    select
      case when expense.expense_date between p_from and p_to then 'current' else 'previous' end as period,
      expense.expense_date as local_date,
      coalesce(category.name, 'Sin categoría') as category,
      expense.amount
    from public.expenses as expense
    left join public.expense_categories as category
      on category.id = expense.category_id
     and category.organization_id = expense.organization_id
    where expense.organization_id = p_organization_id
      and expense.status = 'posted'
      and coalesce(category.is_payroll_advance, false) = false
      and (expense.expense_date between p_from and p_to or expense.expense_date between p_compare_from and p_compare_to)
  ),
  payroll_events as materialized (
    select movement.paid_at as local_date,
      case when movement.kind = 'deduction' then -movement.amount else movement.amount end as amount
    from public.payroll_movements movement
    where movement.organization_id = p_organization_id
      and movement.paid_at is not null
    union all
    select (movement.voided_at at time zone 'America/Argentina/Buenos_Aires')::date,
      -movement.amount
    from public.payroll_movements movement
    where movement.organization_id = p_organization_id
      and movement.kind = 'advance' and movement.payment_method_id is not null
      and movement.voided_at is not null
    union all
    select expense.expense_date, expense.amount
    from public.expenses expense
    join public.expense_categories category
      on category.id = expense.category_id
     and category.organization_id = expense.organization_id
    where expense.organization_id = p_organization_id
      and expense.status = 'posted'
      and category.is_payroll_advance
  ),
  payroll_rows as materialized (
    select
      case when event.local_date between p_from and p_to then 'current' else 'previous' end as period,
      event.local_date,
      event.amount
    from payroll_events event
    where event.local_date between p_from and p_to
       or event.local_date between p_compare_from and p_compare_to
  ),
$segment$ || substring(definition from finish_at);
  execute definition;
end;
$migration$;
