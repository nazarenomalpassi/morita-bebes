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
  target_settlement_id uuid;
  commission_value numeric(14, 2);
  gross_value numeric(14, 2);
  bonus_value numeric(14, 2) := 0;
  advance_value numeric(14, 2) := 0;
  deduction_value numeric(14, 2) := 0;
  net_value numeric(14, 2);
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
  gross_value := round(compensation.base_salary + commission_value, 2);

  select
    coalesce(sum(movement.amount) filter (where movement.kind = 'bonus'), 0),
    coalesce(sum(movement.amount) filter (where movement.kind = 'advance'), 0),
    coalesce(sum(movement.amount) filter (where movement.kind = 'deduction'), 0)
  into bonus_value, advance_value, deduction_value
  from public.payroll_movements as movement
  where movement.organization_id = p_organization_id
    and movement.employee_id = p_employee_id
    and movement.period_month = p_period_month
    and movement.kind in ('advance', 'bonus', 'deduction');

  net_value := round(gross_value + bonus_value - advance_value - deduction_value, 2);

  if net_value < 0 then
    raise exception using
      errcode = '23514',
      message = 'Payroll advances and deductions exceed the salary total for this period';
  end if;

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
    bonus_amount,
    advance_amount,
    deduction_amount,
    net_salary,
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
    gross_value,
    bonus_value,
    advance_value,
    deduction_value,
    net_value,
    totals.sale_count::integer,
    'settled',
    now(),
    actor_id,
    nullif(trim(p_notes), '')
  )
  returning id into target_settlement_id;

  insert into public.payroll_settlement_adjustments (
    organization_id,
    settlement_id,
    source_movement_id,
    kind,
    amount,
    occurred_on,
    description,
    source_type
  )
  select
    movement.organization_id,
    target_settlement_id,
    movement.id,
    movement.kind,
    movement.amount,
    coalesce(expense.expense_date, movement.paid_at, movement.period_month),
    coalesce(expense.description, movement.notes, 'Ajuste salarial'),
    case when movement.expense_id is null then 'manual' else 'expense' end
  from public.payroll_movements as movement
  left join public.expenses as expense
    on expense.id = movement.expense_id
   and expense.organization_id = movement.organization_id
  where movement.organization_id = p_organization_id
    and movement.employee_id = p_employee_id
    and movement.period_month = p_period_month
    and movement.kind in ('advance', 'bonus', 'deduction');

  return target_settlement_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Payroll for this employee and period is already settled';
end;
$$;

revoke all on function public.settle_employee_payroll(uuid, uuid, date, text)
  from public, anon;
grant execute on function public.settle_employee_payroll(uuid, uuid, date, text)
  to authenticated, service_role;
