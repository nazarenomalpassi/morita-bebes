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
  employee_id constant uuid := 'd3333333-3333-4333-8333-333333333333';
  org uuid;
  cash_id uuid;
  card_id uuid;
  target_settlement_id uuid;
  period_month date := date_trunc('month', current_date - interval '1 month')::date;
  movement_count integer;
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

  if org is null then
    raise exception 'Combined payroll test requires an active owner';
  end if;

  select id into cash_id
  from public.payment_methods
  where organization_id = org and code = 'cash';

  select id into card_id
  from public.payment_methods
  where organization_id = org and code = 'card';

  if not exists (
    select 1 from public.cash_tracking_settings where organization_id = org
  ) then
    raise exception 'Combined payroll test requires configured cash tracking';
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
    employee_id, org, 'Ana', 'Combinado', 800000
  );

  perform public.set_employee_compensation(
    org,
    employee_id,
    800000,
    0,
    period_month,
    'Condicion de prueba'
  );

  target_settlement_id := public.settle_employee_payroll(
    org,
    employee_id,
    period_month,
    'Liquidacion combinada de prueba'
  );

  perform public.mark_payroll_settlement_paid_with_payments(
    org,
    target_settlement_id,
    current_date,
    jsonb_build_array(
      jsonb_build_object('payment_method_id', cash_id, 'amount', 300000),
      jsonb_build_object('payment_method_id', card_id, 'amount', 500000)
    ),
    'Pago combinado de prueba'
  );

  if (
    select count(*)
    from public.payroll_settlement_payments as payment
    where payment.settlement_id = target_settlement_id
  ) <> 2 then
    raise exception 'Combined payroll did not preserve both allocations';
  end if;

  if (
    select sum(amount)
    from public.payroll_settlement_payments as payment
    where payment.settlement_id = target_settlement_id
  ) <> 800000 then
    raise exception 'Combined payroll allocations do not equal the settlement total';
  end if;

  if not exists (
    select 1
    from public.payroll_settlements
    where id = target_settlement_id
      and status = 'paid'
      and payment_method = 'Pago combinado'
      and payment_method_id is null
  ) then
    raise exception 'Combined payroll settlement summary is incorrect';
  end if;

  if (
    select current_balance
    from public.cash_accounts as account
    join public.payment_methods as method on method.id = account.payment_method_id
    where account.organization_id = org and method.code = 'cash'
  ) <> cash_before - 300000 then
    raise exception 'Cash payroll allocation did not debit cash correctly';
  end if;

  if (
    select current_balance
    from public.cash_accounts as account
    join public.payment_methods as method on method.id = account.payment_method_id
    where account.organization_id = org and method.code = 'transfer'
  ) <> transfer_before - 500000 then
    raise exception 'Non-cash payroll allocation did not debit transfer correctly';
  end if;

  select count(*) into movement_count
  from public.cash_movements
  where reference_type = 'payroll_settlement'
    and reference_id = target_settlement_id;

  if movement_count <> 2 then
    raise exception 'Combined payroll did not create exactly one ledger movement per allocation';
  end if;

  perform public.mark_payroll_settlement_paid_with_payments(
    org,
    target_settlement_id,
    current_date,
    jsonb_build_array(
      jsonb_build_object('payment_method_id', cash_id, 'amount', 300000),
      jsonb_build_object('payment_method_id', card_id, 'amount', 500000)
    ),
    'Idempotent retry'
  );

  if (
    select count(*)
    from public.cash_movements
    where reference_type = 'payroll_settlement'
      and reference_id = target_settlement_id
  ) <> movement_count then
    raise exception 'Payroll payment retry duplicated cash movements';
  end if;
end;
$$;

rollback;
