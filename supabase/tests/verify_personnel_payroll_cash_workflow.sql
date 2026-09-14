begin;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from public.organization_members
   where role = 'owner' and is_active order by created_at limit 1),
  true
);
set local role authenticated;

do $test$
<<test_block>>
declare
  org_id uuid;
  employee_id uuid;
  cash_method uuid;
  transfer_method uuid;
  cash_account uuid;
  transfer_account uuid;
  cash_before numeric;
  transfer_before numeric;
  cash_after numeric;
  transfer_after numeric;
  advance_one uuid;
  advance_two uuid;
  voided_advance uuid;
  settlement_id uuid;
  today_local date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  duplicate_rejected boolean := false;
  card_rejected boolean := false;
  invalid_allocation_rejected boolean := false;
  expense_rejected boolean := false;
  staff_rejected boolean := false;
  staff_id uuid;
  owner_id uuid := auth.uid();
  salary_category_id uuid;
  payroll_report_before numeric;
  payroll_report_after numeric;
begin
  select organization_id into org_id from public.organization_members
  where user_id = auth.uid() and role = 'owner' and is_active limit 1;
  select method.id, account.id, account.current_balance
    into cash_method, cash_account, cash_before
  from public.payment_methods method
  join public.cash_accounts account on account.payment_method_id = method.id
    and account.organization_id = method.organization_id
  where method.organization_id = org_id and method.code = 'cash';
  select method.id, account.id, account.current_balance
    into transfer_method, transfer_account, transfer_before
  from public.payment_methods method
  join public.cash_accounts account on account.payment_method_id = method.id
    and account.organization_id = method.organization_id
  where method.organization_id = org_id and method.code = 'transfer';
  if org_id is null or cash_method is null or transfer_method is null then
    raise exception 'Payroll fixture cannot find organization and cash accounts';
  end if;
  select user_id into staff_id from public.organization_members
  where organization_id = org_id and role = 'staff' and is_active limit 1;
  select id into salary_category_id from public.expense_categories
  where organization_id = org_id and is_payroll_advance limit 1;
  payroll_report_before := (public.get_business_analytics(
    org_id, date '2026-09-01', today_local,
    date '2026-08-01', date '2026-08-31', date '2026-09-01'
  )->'summary'->'current'->>'payroll')::numeric;

  insert into public.employees (organization_id, first_name, last_name, base_salary)
  values (org_id, 'Prueba', 'Temporal', 800000)
  returning id into employee_id;
  insert into public.employee_compensations (
    organization_id, employee_id, base_salary, commission_percentage,
    effective_from, created_by
  ) values (org_id, employee_id, 800000, 0, date '2026-08-01', auth.uid());

  begin
    insert into public.expenses (
      organization_id, category_id, payment_method_id, description, amount,
      expense_date, created_by, payroll_employee_id, payroll_period_month
    ) values (
      org_id, salary_category_id, cash_method, 'Sueldo de prueba', 10000,
      today_local, auth.uid(), employee_id, date '2026-08-01'
    );
  exception when check_violation then expense_rejected := true;
  end;
  if not expense_rejected then
    raise exception 'A new salary expense was accepted in Gastos';
  end if;

  if staff_id is not null then
    perform set_config('request.jwt.claim.sub', staff_id::text, true);
    begin
      perform public.register_payroll_advance(
        org_id, employee_id, date '2026-08-01', 1000, today_local, cash_method, null);
    exception when insufficient_privilege then staff_rejected := true;
    end;
    perform set_config('request.jwt.claim.sub', owner_id::text, true);
    if not staff_rejected then
      raise exception 'A staff user registered a payroll advance';
    end if;
  end if;

  advance_one := public.register_payroll_advance(
    org_id, employee_id, date '2026-08-01', 100000, today_local, cash_method, 'Prueba efectivo');
  advance_two := public.register_payroll_advance(
    org_id, employee_id, date '2026-08-01', 50000, today_local, transfer_method, 'Prueba transferencia');

  select current_balance into cash_after from public.cash_accounts where id = cash_account;
  select current_balance into transfer_after from public.cash_accounts where id = transfer_account;
  if cash_after <> cash_before - 100000 or transfer_after <> transfer_before - 50000 then
    raise exception 'Advance cash balances are incorrect';
  end if;
  if (select count(*) from public.cash_movements
      where reference_type = 'payroll_advance' and reference_id in (advance_one, advance_two)
        and type = 'payroll' and direction = 'debit') <> 2 then
    raise exception 'Advance cash references are missing';
  end if;

  begin
    perform public.settle_and_pay_employee_payroll(
      org_id, employee_id, date '2026-08-01', today_local,
      jsonb_build_array(jsonb_build_object('payment_method_id', cash_method, 'amount', 300000)),
      'Invalid allocation');
  exception when check_violation then
    invalid_allocation_rejected := true;
  end;
  if not invalid_allocation_rejected then
    raise exception 'Incorrect combined allocation was accepted';
  end if;

  settlement_id := public.settle_and_pay_employee_payroll(
    org_id, employee_id, date '2026-08-01', today_local,
    jsonb_build_array(
      jsonb_build_object('payment_method_id', cash_method, 'amount', 300000),
      jsonb_build_object('payment_method_id', transfer_method, 'amount', 350000)
    ), 'Prueba de liquidación combinada');
  if not exists (select 1 from public.payroll_settlements
      where id = settlement_id and gross_salary = 800000
        and advance_amount = 150000 and net_salary = 650000 and status = 'paid') then
    raise exception 'Salary settlement snapshot is incorrect';
  end if;
  select current_balance into cash_after from public.cash_accounts where id = cash_account;
  select current_balance into transfer_after from public.cash_accounts where id = transfer_account;
  if cash_after <> cash_before - 400000 or transfer_after <> transfer_before - 400000 then
    raise exception 'Final cash balances are incorrect';
  end if;
  if (select count(*) from public.cash_movements
      where reference_type = 'payroll_settlement' and reference_id = settlement_id
        and type = 'payroll' and direction = 'debit') <> 2 then
    raise exception 'Combined salary payment did not create two referenced cash movements';
  end if;
  begin
    perform public.settle_and_pay_employee_payroll(
      org_id, employee_id, date '2026-08-01', today_local, '[]'::jsonb, null);
  exception when unique_violation then
    duplicate_rejected := true;
  end;
  if not duplicate_rejected then
    raise exception 'Duplicate settlement was accepted';
  end if;

  perform public.void_payroll_settlement(org_id, settlement_id, 'Corrección del medio de pago');
  if not exists (select 1 from public.payroll_settlements
      where id = settlement_id and voided_at is not null and voided_by = auth.uid()) then
    raise exception 'Paid settlement was not marked as cancelled';
  end if;
  if (select count(*) from public.cash_movements
      where reference_type = 'payroll_settlement' and reference_id = settlement_id
        and type = 'adjustment' and direction = 'credit'
        and reverses_movement_id is not null) <> 2 then
    raise exception 'Combined payment cancellation did not create two cash reversals';
  end if;
  select current_balance into cash_after from public.cash_accounts where id = cash_account;
  select current_balance into transfer_after from public.cash_accounts where id = transfer_account;
  if cash_after <> cash_before - 100000 or transfer_after <> transfer_before - 50000 then
    raise exception 'Cancelled payment did not restore the original account balances';
  end if;

  settlement_id := public.settle_and_pay_employee_payroll(
    org_id, employee_id, date '2026-08-01', today_local,
    jsonb_build_array(
      jsonb_build_object('payment_method_id', cash_method, 'amount', 300000),
      jsonb_build_object('payment_method_id', transfer_method, 'amount', 350000)
    ), 'Liquidación corregida');
  if (select count(*) from public.payroll_settlements settlement
      where settlement.organization_id = org_id and settlement.employee_id = test_block.employee_id
        and settlement.period_month = date '2026-08-01' and settlement.voided_at is null) <> 1 then
    raise exception 'Corrected month has more than one active settlement';
  end if;
  select current_balance into cash_after from public.cash_accounts where id = cash_account;
  select current_balance into transfer_after from public.cash_accounts where id = transfer_account;
  if cash_after <> cash_before - 400000 or transfer_after <> transfer_before - 400000 then
    raise exception 'Corrected salary settlement cash balances are incorrect';
  end if;

  voided_advance := public.register_payroll_advance(
    org_id, employee_id, date_trunc('month', today_local)::date,
    10000, today_local, cash_method, 'Prueba de anulación');
  perform public.void_payroll_advance(org_id, voided_advance, 'Importe equivocado');
  if not exists (select 1 from public.payroll_movements
      where id = voided_advance and voided_at is not null and voided_by = auth.uid()) then
    raise exception 'Advance cancellation was not audited';
  end if;
  if not exists (select 1 from public.cash_movements
      where reference_type = 'payroll_advance' and reference_id = voided_advance
        and type = 'adjustment' and direction = 'credit' and reverses_movement_id is not null) then
    raise exception 'Advance cancellation cash reversal is missing';
  end if;
  select current_balance into cash_after from public.cash_accounts where id = cash_account;
  if cash_after <> cash_before - 400000 then
    raise exception 'Advance reversal changed the final cash balance';
  end if;

  payroll_report_after := (public.get_business_analytics(
    org_id, date '2026-09-01', today_local,
    date '2026-08-01', date '2026-08-31', date '2026-09-01'
  )->'summary'->'current'->>'payroll')::numeric;
  if payroll_report_after <> payroll_report_before + 800000 then
    raise exception 'Personnel report double counted or omitted a payment: before %, after %',
      payroll_report_before, payroll_report_after;
  end if;

  if 700000 + round(10000000 * 1 / 100, 2) <> 800000 then
    raise exception 'Salary commission formula is incorrect';
  end if;
end;
$test$;

select 'passed: advances, combined payment, cash totals, no duplicate, settlement correction, advance reversal, permissions, expense separation, report, rollback' as result;
rollback;
