begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('c1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'cash-owner@local.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'cash-staff@local.test', '{}'::jsonb, '{}'::jsonb, now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.organizations (id, name, slug, created_by)
values ('c1111111-aaaa-4111-8111-111111111111', 'Cash Ledger Test', 'cash-ledger-test', 'c1111111-1111-4111-8111-111111111111');

select public.add_organization_member_by_email('c1111111-aaaa-4111-8111-111111111111', 'cash-staff@local.test', 'staff');

do $$
declare
  org constant uuid := 'c1111111-aaaa-4111-8111-111111111111';
  cash_id uuid;
  transfer_method_id uuid;
  product_id uuid;
  historical_sale_id uuid;
  single_sale_id uuid;
  combined_sale_id uuid;
  expense_id uuid;
  employee_id uuid := 'c3333333-3333-4333-8333-333333333333';
  settlement_id uuid;
  before_count integer;
  after_count integer;
  total_before numeric;
  total_after numeric;
  dashboard jsonb;
begin
  select id into cash_id from public.payment_methods where organization_id = org and code = 'cash';
  select id into transfer_method_id from public.payment_methods where organization_id = org and code = 'transfer';

  insert into public.products (organization_id, name, sku, cost_price, retail_price, min_stock, target_stock)
  values (org, 'Producto caja', 'CASH-001', 50000, 100000, 0, 100)
  returning id into product_id;
  perform public.adjust_inventory(org, product_id, 20, 'Stock para pruebas de caja', 50000, 'c5555555-5555-4555-8555-555555555555');

  -- Case 10: the historical sale is normalized but predates the cutoff.
  historical_sale_id := public.create_sale(org, jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)), cash_id, null, 0, null, 'HIST-CASH', '2026-08-10T12:00:00-03:00');

  perform public.initialize_cash_tracking(
    org,
    '2026-08-11T09:00:00-03:00',
    (select jsonb_agg(jsonb_build_object(
      'payment_method_id', method.id,
      'amount', case method.code when 'cash' then 500000 when 'transfer' then 1000000 else 0 end
    ) order by method.sort_order) from public.payment_methods as method where method.organization_id = org and method.is_active)
  );

  if (select sum(current_balance) from public.cash_accounts where organization_id = org) <> 1500000 then
    raise exception 'Initial balances or historical cutoff were applied incorrectly';
  end if;
  if (select count(*) from public.cash_movements where organization_id = org and reference_id = historical_sale_id) <> 0 then
    raise exception 'Case 10 historical sale affected current cash';
  end if;

  -- Case 1: a valid cash sale credits exactly once.
  single_sale_id := public.create_sale(org, jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)), cash_id, null, 0, null, null, '2026-08-11T10:00:00-03:00');
  if (select current_balance from public.cash_accounts where organization_id = org and payment_method_id = cash_id) <> 600000 then
    raise exception 'Case 1 sale did not credit cash';
  end if;

  -- Case 2: a posted expense debits its selected method.
  insert into public.expenses (organization_id, description, amount, expense_date, payment_method_id, created_by)
  values (org, 'Limpieza', 50000, '2026-08-11', cash_id, 'c1111111-1111-4111-8111-111111111111') returning id into expense_id;
  if (select current_balance from public.cash_accounts where organization_id = org and payment_method_id = cash_id) <> 550000 then
    raise exception 'Case 2 expense did not debit cash';
  end if;

  -- Case 3: a transfer changes distribution, never the total.
  select sum(current_balance) into total_before from public.cash_accounts where organization_id = org;
  perform public.transfer_cash(org, cash_id, transfer_method_id, 100000, '2026-08-11T11:00:00-03:00', 'Deposito bancario');
  select sum(current_balance) into total_after from public.cash_accounts where organization_id = org;
  if total_after <> total_before then raise exception 'Case 3 transfer changed total availability'; end if;
  if (select count(distinct cash_account_id) from public.cash_movements where organization_id = org and transfer_id is not null) <> 2 then
    raise exception 'Case 3 transfer did not create two linked legs';
  end if;

  -- Case 4 and 11: cancellation compensates, while retries do not duplicate.
  perform public.cancel_sale(single_sale_id, 'Cliente desistio');
  if (select sum(signed_amount) from public.cash_movements where organization_id = org and reference_type = 'sale' and reference_id = single_sale_id) <> 0 then
    raise exception 'Case 4 cancelled sale retained a net cash impact';
  end if;
  if (select count(*) from public.cash_movements where organization_id = org and reference_type = 'sale' and reference_id = single_sale_id) <> 2 then
    raise exception 'Case 11 sale or reversal was duplicated';
  end if;

  -- Case 6: combined payment credits exactly 40k cash and 60k transfer.
  combined_sale_id := public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', 40000), jsonb_build_object('payment_method_id', transfer_method_id, 'amount', 60000)),
    null, 0, null, null, '2026-08-11T12:00:00-03:00'
  );
  if (select sum(payment.amount) from public.sale_payments as payment where payment.sale_id = combined_sale_id) <> 100000 then
    raise exception 'Case 6 combined allocation is not exact';
  end if;
  if (select sum(signed_amount) from public.cash_movements where reference_id = combined_sale_id and cash_account_id = (select id from public.cash_accounts where organization_id = org and payment_method_id = cash_id)) <> 40000 then
    raise exception 'Case 6 cash leg is wrong';
  end if;
  if (select sum(signed_amount) from public.cash_movements where reference_id = combined_sale_id and cash_account_id = (select id from public.cash_accounts where organization_id = org and payment_method_id = transfer_method_id)) <> 60000 then
    raise exception 'Case 6 transfer leg is wrong';
  end if;

  -- Case 12: correcting an expense reverses the old method and applies the new state.
  update public.expenses set amount = 40000, payment_method_id = transfer_method_id where id = expense_id;
  if (select sum(signed_amount) from public.cash_movements where reference_type = 'expense' and reference_id = expense_id) <> -40000 then
    raise exception 'Case 12 expense correction has the wrong net impact';
  end if;
  if (select count(*) from public.cash_movements where reference_type = 'expense' and reference_id = expense_id) <> 3 then
    raise exception 'Case 12 expense correction did not preserve all history';
  end if;
  update public.expenses set amount = 50000, payment_method_id = cash_id where id = expense_id;
  update public.expenses set amount = 40000, payment_method_id = transfer_method_id where id = expense_id;
  if (select sum(signed_amount) from public.cash_movements where reference_type = 'expense' and reference_id = expense_id) <> -40000 then
    raise exception 'Case 12 repeated correction cycle diverged from its current state';
  end if;
  if (select count(*) from public.cash_movements where reference_type = 'expense' and reference_id = expense_id) <> 7 then
    raise exception 'Case 12 repeated correction cycle lost its audit trail';
  end if;

  -- Case 7: reconciliation stores the computed delta and mandatory reason.
  perform public.reconcile_cash_account(org, cash_id, (select current_balance - 5000 from public.cash_accounts where organization_id = org and payment_method_id = cash_id), 'Diferencia de arqueo', '2026-08-11T13:00:00-03:00');
  if not exists (select 1 from public.cash_movements where organization_id = org and type = 'adjustment' and amount = 5000 and direction = 'debit') then
    raise exception 'Case 7 reconciliation adjustment is missing';
  end if;

  -- Idempotency is enforced when an external workflow is retried.
  select count(*) into before_count from public.cash_movements where organization_id = org;
  begin
    perform public.cancel_sale(single_sale_id, 'Reintento de anulacion');
    raise exception 'A second sale cancellation unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
  select count(*) into after_count from public.cash_movements where organization_id = org;
  if after_count <> before_count then raise exception 'Idempotent retry duplicated a movement'; end if;

  -- Dashboard reads the cached balance, which must equal the immutable ledger sum.
  if exists (
    select 1 from public.cash_accounts as account
    where account.organization_id = org and account.current_balance <>
      (select coalesce(sum(movement.signed_amount), 0) from public.cash_movements as movement where movement.cash_account_id = account.id)
  ) then raise exception 'Cached balance diverged from ledger source of truth'; end if;
  dashboard := public.get_cash_dashboard(org, null, null, null, null, null, null, 50, 0);
  if not (dashboard ->> 'configured')::boolean then raise exception 'Cash dashboard is not configured'; end if;

  begin
    update public.payment_methods set is_active = false where id = cash_id;
    raise exception 'A payment method with non-zero tracked balance was deactivated';
  exception when check_violation then null;
  end;

  -- Prepare a settled payroll snapshot; calculating/settling alone has no cash impact.
  insert into public.employees (id, organization_id, first_name, last_name, base_salary)
  values (employee_id, org, 'Ana', 'Caja', 800000);
  perform public.set_employee_compensation(org, employee_id, 800000, 0, '2026-01-01', 'Condicion de prueba');
  settlement_id := public.settle_employee_payroll(org, employee_id, '2026-07-01', 'Liquidacion de prueba');
  select sum(current_balance) into total_before from public.cash_accounts where organization_id = org;
  perform public.mark_payroll_settlement_paid_v2(org, settlement_id, '2026-08-11', transfer_method_id, 'Pago mensual');
  select sum(current_balance) into total_after from public.cash_accounts where organization_id = org;
  if total_after <> total_before - 800000 then raise exception 'Case 5 paid payroll did not debit the selected account'; end if;
  perform public.mark_payroll_settlement_paid_v2(org, settlement_id, '2026-08-11', transfer_method_id, 'Retry');
  if (select count(*) from public.cash_movements where reference_type = 'payroll_settlement' and reference_id = settlement_id) <> 1 then
    raise exception 'Case 5 payroll retry duplicated cash movement';
  end if;
end;
$$;

-- Cases 8 and 9: staff cannot read balances or call administrative workflows.
set local request.jwt.claims = '{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.cash_accounts) <> 0 then raise exception 'Case 8 staff read cash accounts'; end if;
  begin
    perform public.get_cash_dashboard('c1111111-aaaa-4111-8111-111111111111', null, null, null, null, null, null, 50, 0);
    raise exception 'Case 9 staff called cash dashboard';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_manual_cash_movement('c1111111-aaaa-4111-8111-111111111111', (select id from public.payment_methods where organization_id = 'c1111111-aaaa-4111-8111-111111111111' and code = 'cash'), 'credit', 100, 'Unauthorized', now(), null);
    raise exception 'Case 9 staff created a cash movement';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
