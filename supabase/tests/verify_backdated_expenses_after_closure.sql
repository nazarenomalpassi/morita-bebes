begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('e9111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'backdated-expense-owner@local.test', '{}'::jsonb, '{}'::jsonb, now(), now());

do $$
declare
  bootstrap_already_used boolean := exists (
    select 1 from private.organization_bootstrap_guard
  );
begin
  if bootstrap_already_used then
    execute 'alter table public.organizations disable trigger guard_organization_bootstrap';
  end if;

  insert into public.organizations (id, name, slug, created_by)
  values ('e9111111-aaaa-4111-8111-111111111111', 'Backdated Expense Test', 'backdated-expense-test', 'e9111111-1111-4111-8111-111111111111');

  if bootstrap_already_used then
    execute 'alter table public.organizations enable trigger guard_organization_bootstrap';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e9111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  org constant uuid := 'e9111111-aaaa-4111-8111-111111111111';
  yesterday date := (now() at time zone 'America/Argentina/Cordoba')::date - 1;
begin
  perform public.initialize_cash_tracking(
    org,
    yesterday::timestamp at time zone 'America/Argentina/Cordoba',
    (
      select jsonb_agg(jsonb_build_object(
        'payment_method_id', method.id,
        'amount', case method.code when 'cash' then 100000 else 0 end
      ) order by method.sort_order)
      from public.payment_methods as method
      where method.organization_id = org and method.is_active
    )
  );
end;
$$;

reset role;
set local session_replication_role = replica;
update public.cash_tracking_settings
set automatic_closure_enabled_from = (now() at time zone 'America/Argentina/Cordoba')::date - 1
where organization_id = 'e9111111-aaaa-4111-8111-111111111111';
set local session_replication_role = origin;

do $$
declare
  org constant uuid := 'e9111111-aaaa-4111-8111-111111111111';
  yesterday date := (now() at time zone 'America/Argentina/Cordoba')::date - 1;
begin
  if not private.create_automatic_cash_closure(org, yesterday) then
    raise exception 'The historical closure was not created';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e9111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  org constant uuid := 'e9111111-aaaa-4111-8111-111111111111';
  actor constant uuid := 'e9111111-1111-4111-8111-111111111111';
  yesterday date := (now() at time zone 'America/Argentina/Cordoba')::date - 1;
  cash_method_id uuid;
  expense_id uuid := 'e9222222-2222-4222-8222-222222222222';
  closure_id uuid;
  expected_before numeric;
  counted_before numeric;
  difference_before numeric;
begin
  select id into cash_method_id
  from public.payment_methods
  where organization_id = org and code = 'cash';

  select id, expected_total, counted_total, difference_total
  into closure_id, expected_before, counted_before, difference_before
  from public.daily_cash_closures
  where organization_id = org and business_date = yesterday;

  insert into public.expenses (
    id, organization_id, description, amount, expense_date,
    payment_method_id, created_by
  ) values (
    expense_id, org, 'Gasto informado despues del cierre', 10000, yesterday,
    cash_method_id, actor
  );

  if not exists (
    select 1 from public.expenses
    where id = expense_id and expense_date = yesterday and amount = 10000
  ) then
    raise exception 'The expense did not preserve its original date';
  end if;

  if not exists (
    select 1 from public.cash_movements
    where reference_type = 'expense'
      and reference_id = expense_id
      and (occurred_at at time zone 'America/Argentina/Cordoba')::date = yesterday + 1
      and metadata->>'expense_date' = yesterday::text
      and metadata->>'recorded_after_closure' = 'true'
  ) then
    raise exception 'The cash movement was not posted to the current open day';
  end if;

  if exists (
    select 1 from public.daily_cash_closures
    where id = closure_id
      and (expected_total, counted_total, difference_total)
        is distinct from (expected_before, counted_before, difference_before)
  ) then
    raise exception 'The historical closure was modified';
  end if;

  if (select current_balance from public.cash_accounts where organization_id = org and payment_method_id = cash_method_id) <> 90000 then
    raise exception 'The current cash balance did not include the backdated expense';
  end if;
end;
$$;

rollback;
