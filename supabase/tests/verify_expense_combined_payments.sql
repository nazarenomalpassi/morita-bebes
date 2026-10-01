begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ea111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'expense-payments-owner@local.test', '{}', '{}', now(), now()),
  ('ea222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'expense-payments-staff@local.test', '{}', '{}', now(), now());

do $$
declare
  bootstrap_already_used boolean := exists (select 1 from private.organization_bootstrap_guard);
begin
  if bootstrap_already_used then
    execute 'alter table public.organizations disable trigger guard_organization_bootstrap';
  end if;
  insert into public.organizations (id, name, slug, created_by)
  values ('ea111111-aaaa-4111-8111-111111111111', 'Expense Payments Test', 'expense-payments-test', 'ea111111-1111-4111-8111-111111111111');
  if bootstrap_already_used then
    execute 'alter table public.organizations enable trigger guard_organization_bootstrap';
  end if;
end;
$$;

insert into public.organization_members (organization_id, user_id, role)
values ('ea111111-aaaa-4111-8111-111111111111', 'ea222222-2222-4222-8222-222222222222', 'staff');

set local role authenticated;
set local request.jwt.claims = '{"sub":"ea111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.initialize_cash_tracking(
  'ea111111-aaaa-4111-8111-111111111111',
  ((now() at time zone 'America/Argentina/Cordoba')::date - 1)::timestamp at time zone 'America/Argentina/Cordoba',
  (select jsonb_agg(jsonb_build_object('payment_method_id', id, 'amount',
    case when code in ('cash', 'transfer') then 100000 else 0 end))
   from public.payment_methods where organization_id = 'ea111111-aaaa-4111-8111-111111111111' and is_active)
);

reset role;
set local session_replication_role = replica;
update public.cash_tracking_settings
set automatic_closure_enabled_from = (now() at time zone 'America/Argentina/Cordoba')::date - 1
where organization_id = 'ea111111-aaaa-4111-8111-111111111111';
set local session_replication_role = origin;
select private.create_automatic_cash_closure('ea111111-aaaa-4111-8111-111111111111', (now() at time zone 'America/Argentina/Cordoba')::date - 1);
create temp table expense_test_closures as select id, to_jsonb(closure) as snapshot from public.daily_cash_closures closure;

set local role authenticated;
set local request.jwt.claims = '{"sub":"ea111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  org constant uuid := 'ea111111-aaaa-4111-8111-111111111111';
  expense constant uuid := 'ea333333-3333-4333-8333-333333333333';
  legacy constant uuid := 'ea444444-4444-4444-8444-444444444444';
  invalid constant uuid := 'ea555555-5555-4555-8555-555555555555';
  cash_id uuid;
  transfer_id uuid;
  card_id uuid;
  cash_account uuid;
  transfer_account uuid;
  today date := (now() at time zone 'America/Argentina/Cordoba')::date;
  movement_count integer;
  invalid_allocations jsonb;
begin
  select id into cash_id from public.payment_methods where organization_id = org and code = 'cash';
  select id into transfer_id from public.payment_methods where organization_id = org and code = 'transfer';
  select id into card_id from public.payment_methods where organization_id = org and code = 'card';
  select id into cash_account from public.cash_accounts where organization_id = org and payment_method_id = cash_id;
  select id into transfer_account from public.cash_accounts where organization_id = org and payment_method_id = transfer_id;

  insert into public.expenses (id, organization_id, description, amount, expense_date, payment_allocations)
  values (expense, org, 'Combined expense', 10000, today, jsonb_build_array(
    jsonb_build_object('payment_method_id', cash_id, 'amount', 4000),
    jsonb_build_object('payment_method_id', transfer_id, 'amount', 6000)));
  if (select current_balance from public.cash_accounts where id = cash_account) <> 96000
    or (select current_balance from public.cash_accounts where id = transfer_account) <> 94000
    or (select sum(amount) from public.cash_movements where reference_id = expense) <> 10000
    or (select count(*) from public.expenses where id = expense) <> 1 then
    raise exception 'Combined expense must post one expense with two exact debits';
  end if;

  begin
    insert into public.expenses (id, organization_id, description, amount, expense_date, payment_allocations)
    values (invalid, org, 'Wrong sum', 9000, today, jsonb_build_array(
      jsonb_build_object('payment_method_id', cash_id, 'amount', 4000),
      jsonb_build_object('payment_method_id', transfer_id, 'amount', 6000)));
    raise exception 'Mismatched total was accepted';
  exception when check_violation then null;
  end;
  for invalid_allocations in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', 5000), jsonb_build_object('payment_method_id', cash_id, 'amount', 5000)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', -100)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', 0)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', 100.001)),
    jsonb_build_array(jsonb_build_object('payment_method_id', invalid, 'amount', 10000))
  )) loop
    begin
      insert into public.expenses (id, organization_id, description, amount, expense_date, payment_allocations)
      values (invalid, org, 'Invalid allocation', 10000, today, invalid_allocations);
      raise exception 'Invalid allocation was accepted';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  if exists (select 1 from public.expenses where id = invalid)
    or exists (select 1 from public.cash_movements where reference_id = invalid) then
    raise exception 'Invalid expense left partial writes';
  end if;

  update public.expenses set payment_allocations = jsonb_build_array(
    jsonb_build_object('payment_method_id', cash_id, 'amount', 2000),
    jsonb_build_object('payment_method_id', transfer_id, 'amount', 8000)) where id = expense;
  if (select current_balance from public.cash_accounts where id = cash_account) <> 98000
    or (select current_balance from public.cash_accounts where id = transfer_account) <> 92000 then
    raise exception 'Correction did not reverse the previous allocation';
  end if;
  select count(*) into movement_count from public.cash_movements where reference_id = expense;
  update public.expenses set payment_allocations = payment_allocations, notes = 'Only notes' where id = expense;
  if (select count(*) from public.cash_movements where reference_id = expense) <> movement_count then
    raise exception 'An unchanged allocation duplicated cash movements';
  end if;

  update public.expenses set amount = 12000, payment_method_id = transfer_id,
    payment_allocations = jsonb_build_array(jsonb_build_object('payment_method_id', transfer_id, 'amount', 12000))
  where id = expense;
  if (select current_balance from public.cash_accounts where id = cash_account) <> 100000
    or (select current_balance from public.cash_accounts where id = transfer_account) <> 88000 then
    raise exception 'Combined to single payment correction failed';
  end if;

  update public.expenses set amount = 10000, payment_method_id = null,
    payment_allocations = jsonb_build_array(
      jsonb_build_object('payment_method_id', cash_id, 'amount', 2000),
      jsonb_build_object('payment_method_id', transfer_id, 'amount', 3000),
      jsonb_build_object('payment_method_id', card_id, 'amount', 5000)) where id = expense;
  if (select current_balance from public.cash_accounts where id = cash_account) <> 98000
    or (select current_balance from public.cash_accounts where id = transfer_account) <> 92000
    or (select sum(case when direction = 'debit' then amount else -amount end) from public.cash_movements where reference_id = expense) <> 10000 then
    raise exception 'Card and transfer must share one financial account without duplication';
  end if;
  perform public.cancel_expense(expense, 'Test cancellation');
  if (select current_balance from public.cash_accounts where id = cash_account) <> 100000
    or (select current_balance from public.cash_accounts where id = transfer_account) <> 100000 then
    raise exception 'Cancellation must restore both financial balances';
  end if;
  begin
    update public.expenses set notes = 'Changed after cancellation' where id = expense;
    raise exception 'Cancelled expense was mutable';
  exception when insufficient_privilege then null;
  end;

  insert into public.expenses (id, organization_id, description, amount, expense_date, payment_method_id)
  values (legacy, org, 'Legacy single payment', 1000, today, cash_id);
  update public.expenses set payment_method_id = null, payment_allocations = jsonb_build_array(
    jsonb_build_object('payment_method_id', cash_id, 'amount', 400),
    jsonb_build_object('payment_method_id', transfer_id, 'amount', 600)) where id = legacy;
  if (select current_balance from public.cash_accounts where id = cash_account) <> 99600
    or (select current_balance from public.cash_accounts where id = transfer_account) <> 99400 then
    raise exception 'Legacy single to combined correction failed';
  end if;
  perform public.cancel_expense(legacy, 'Cancel legacy correction');

  insert into public.expenses (id, organization_id, description, amount, expense_date, payment_method_id)
  values (invalid, org, 'Before tracking', 7000, today - 7, cash_id);
  perform public.cancel_expense(invalid, 'No actual cash to reverse');
  if (select current_balance from public.cash_accounts where id = cash_account) <> 100000 then
    raise exception 'An untracked legacy expense created a fictitious refund';
  end if;

  insert into public.expenses (id, organization_id, description, amount, expense_date, payment_allocations)
  values ('ea666666-6666-4666-8666-666666666666', org, 'Backdated combined', 6000, today - 1, jsonb_build_array(
    jsonb_build_object('payment_method_id', cash_id, 'amount', 1000),
    jsonb_build_object('payment_method_id', transfer_id, 'amount', 5000)));
  if (select count(*) from public.cash_movements
    where reference_id = 'ea666666-6666-4666-8666-666666666666'
      and metadata->>'recorded_after_closure' = 'true'
      and (occurred_at at time zone 'America/Argentina/Cordoba')::date = today) <> 2 then
    raise exception 'Backdated combined expense must affect the current cash day';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"ea222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare
  org constant uuid := 'ea111111-aaaa-4111-8111-111111111111';
  expense constant uuid := 'ea777777-7777-4777-8777-777777777777';
  cash_id uuid;
  transfer_id uuid;
begin
  select id into cash_id from public.payment_methods where organization_id = org and code = 'cash';
  select id into transfer_id from public.payment_methods where organization_id = org and code = 'transfer';
  insert into public.expenses (id, organization_id, description, amount, expense_date, payment_allocations)
  values (expense, org, 'Staff combined expense', 1000, current_date, jsonb_build_array(
    jsonb_build_object('payment_method_id', cash_id, 'amount', 300),
    jsonb_build_object('payment_method_id', transfer_id, 'amount', 700)));
  update public.expenses set notes = 'Unauthorized edit' where id = expense;
  if exists (select 1 from public.expenses where id = expense and notes = 'Unauthorized edit') then
    raise exception 'Staff modified an expense';
  end if;
  begin
    perform public.cancel_expense(expense, 'Unauthorized cancellation');
    raise exception 'Staff cancelled an expense';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
begin
  if exists (select 1 from expense_test_closures before
    join public.daily_cash_closures after using (id)
    where before.snapshot is distinct from to_jsonb(after)) then
    raise exception 'A historical closure changed';
  end if;
end;
$$;

select 'combined expense, validation, correction, cancellation, cards, legacy, closed days and staff permissions: passed' as result;
rollback;
