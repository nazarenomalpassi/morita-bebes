begin;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', member.user_id, 'role', 'authenticated')::text,
  true
)
from public.organization_members as member
where member.role = 'owner' and member.is_active
order by member.created_at
limit 1;

set local role authenticated;

do $$
declare
  v_employee_id constant uuid := 'd4444444-4444-4444-8444-444444444444';
  v_expense_id constant uuid := 'e4444444-4444-4444-8444-444444444444';
  org uuid;
  salary_category_id uuid;
  cash_method_id uuid;
  card_method_id uuid;
  target_settlement_id uuid;
  v_period_month date := date_trunc('month', current_date - interval '1 month')::date;
  cash_before numeric;
  transfer_before numeric;
begin
  select member.organization_id into org
  from public.organization_members as member
  where member.user_id = (select auth.uid())
    and member.role = 'owner'
    and member.is_active
  order by member.created_at
  limit 1;

  select id into salary_category_id
  from public.expense_categories
  where organization_id = org and is_payroll_advance
  order by created_at
  limit 1;

  select id into cash_method_id
  from public.payment_methods
  where organization_id = org and code = 'cash' and is_active;

  select id into card_method_id
  from public.payment_methods
  where organization_id = org and code = 'card' and is_active;

  if org is null or salary_category_id is null or cash_method_id is null or card_method_id is null then
    raise exception 'Salary expense payroll test prerequisites are missing';
  end if;

  select account.current_balance into cash_before
  from public.cash_accounts as account
  join public.payment_methods as method on method.id = account.payment_method_id
  where account.organization_id = org and method.code = 'cash';

  select account.current_balance into transfer_before
  from public.cash_accounts as account
  join public.payment_methods as method on method.id = account.payment_method_id
  where account.organization_id = org and method.code = 'transfer';

  insert into public.employees (
    id, organization_id, first_name, last_name, base_salary
  ) values (
    v_employee_id, org, 'Prueba', 'Adelanto', 800000
  );

  perform public.set_employee_compensation(
    org,
    v_employee_id,
    800000,
    0,
    v_period_month,
    'Condicion de prueba para adelantos'
  );

  insert into public.expenses (
    id,
    organization_id,
    category_id,
    payment_method_id,
    description,
    amount,
    expense_date,
    payroll_employee_id,
    payroll_period_month,
    created_by
  ) values (
    v_expense_id,
    org,
    salary_category_id,
    cash_method_id,
    'Adelanto de sueldo de prueba',
    100000,
    current_date,
    v_employee_id,
    v_period_month,
    (select auth.uid())
  );

  if not exists (
    select 1
    from public.payroll_movements
    where payroll_movements.expense_id = v_expense_id
      and payroll_movements.employee_id = v_employee_id
      and kind = 'advance'
      and amount = 100000
      and payroll_movements.period_month = v_period_month
      and paid_at is null
  ) then
    raise exception 'Salary expense did not create its linked payroll advance';
  end if;

  target_settlement_id := public.settle_employee_payroll(
    org,
    v_employee_id,
    v_period_month,
    'Liquidacion con adelanto de prueba'
  );

  if not exists (
    select 1
    from public.payroll_settlements
    where id = target_settlement_id
      and gross_salary = 800000
      and advance_amount = 100000
      and bonus_amount = 0
      and deduction_amount = 0
      and net_salary = 700000
  ) then
    raise exception 'Payroll settlement did not deduct the salary advance';
  end if;

  if not exists (
    select 1
    from public.payroll_settlement_adjustments
    where settlement_id = target_settlement_id
      and source_movement_id = (
        select id from public.payroll_movements where payroll_movements.expense_id = v_expense_id
      )
      and kind = 'advance'
      and amount = 100000
      and source_type = 'expense'
  ) then
    raise exception 'Payroll settlement did not preserve the advance detail snapshot';
  end if;

  perform public.mark_payroll_settlement_paid_with_payments(
    org,
    target_settlement_id,
    current_date,
    jsonb_build_array(
      jsonb_build_object('payment_method_id', cash_method_id, 'amount', 300000),
      jsonb_build_object('payment_method_id', card_method_id, 'amount', 400000)
    ),
    'Pago neto combinado de prueba'
  );

  if (
    select sum(amount)
    from public.payroll_settlement_payments
    where settlement_id = target_settlement_id
  ) <> 700000 then
    raise exception 'Payroll payment did not use the net salary';
  end if;

  if not exists (
    select 1
    from public.payroll_movements
    where settlement_id = target_settlement_id
      and kind = 'salary'
      and amount = 700000
  ) then
    raise exception 'Final payroll movement did not preserve the net payment';
  end if;

  if (
    select current_balance
    from public.cash_accounts as account
    join public.payment_methods as method on method.id = account.payment_method_id
    where account.organization_id = org and method.code = 'cash'
  ) <> cash_before - 400000 then
    raise exception 'Cash did not include one advance debit and the net cash allocation';
  end if;

  if (
    select current_balance
    from public.cash_accounts as account
    join public.payment_methods as method on method.id = account.payment_method_id
    where account.organization_id = org and method.code = 'transfer'
  ) <> transfer_before - 400000 then
    raise exception 'Card allocation did not debit the canonical transfer account';
  end if;
end;
$$;

rollback;
