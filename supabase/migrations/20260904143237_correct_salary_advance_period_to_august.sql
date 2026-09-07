-- The owner confirmed that both existing advances belong to August 2026.
do $$
declare
  target public.expenses%rowtype;
  cash_before jsonb;
  cash_after jsonb;
begin
  lock table public.payroll_settlements in share row exclusive mode;

  select * into target from public.expenses
  where id = '0217bbb0-90f7-4f2a-b07d-8d6443cb042f'
  for update;

  if not found then
    return;
  end if;
  if target.payroll_employee_id is distinct from '6aa7bd2a-3e5b-44c6-a232-bdb5517e1935'::uuid
    or target.amount <> 50000 or target.status <> 'posted'
    or target.payroll_period_month not in (date '2026-08-01', date '2026-09-01')
    or target.payroll_period_month is null then
    raise exception 'Salary advance differs from the verified record; manual review required';
  end if;
  if target.payroll_period_month = date '2026-08-01' then
    return;
  end if;
  if exists (
    select 1 from public.payroll_settlements
    where organization_id = target.organization_id
      and employee_id = target.payroll_employee_id
      and period_month in (date '2026-08-01', date '2026-09-01')
  ) then
    raise exception 'Cannot reassign an advance involving a settled payroll period';
  end if;

  select jsonb_agg(to_jsonb(m) order by m.id) into cash_before
  from public.cash_movements m where reference_id = target.id;

  update public.expenses set payroll_period_month = date '2026-08-01'
  where id = target.id;

  select jsonb_agg(to_jsonb(m) order by m.id) into cash_after
  from public.cash_movements m where reference_id = target.id;
  if cash_before is distinct from cash_after then
    raise exception 'Cash movements must remain unchanged';
  end if;
  if (select count(*) from public.payroll_movements
      where expense_id = target.id and period_month = date '2026-08-01'
        and kind = 'advance' and amount = target.amount) <> 1 then
    raise exception 'Salary advance synchronization failed';
  end if;
end;
$$;
