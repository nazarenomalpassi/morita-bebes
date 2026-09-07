begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('e1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'closure-owner@local.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('e2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'closure-staff@local.test', '{}'::jsonb, '{}'::jsonb, now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.organizations (id, name, slug, created_by)
values ('e1111111-aaaa-4111-8111-111111111111', 'Automatic Closure Test', 'automatic-closure-test', 'e1111111-1111-4111-8111-111111111111');

select public.add_organization_member_by_email(
  'e1111111-aaaa-4111-8111-111111111111',
  'closure-staff@local.test',
  'staff'
);

do $$
declare
  org constant uuid := 'e1111111-aaaa-4111-8111-111111111111';
  product_id constant uuid := 'e4444444-4444-4444-8444-444444444444';
  yesterday date := (now() at time zone 'America/Argentina/Cordoba')::date - 1;
begin
  insert into public.products (id, organization_id, name, sku, cost_price, retail_price, min_stock, target_stock)
  values (product_id, org, 'Producto cierre', 'CLOSE-001', 50000, 100000, 0, 100);
  perform public.adjust_inventory(org, product_id, 20, 'Stock para cierre', 50000, 'e5555555-5555-4555-8555-555555555555');

  perform public.initialize_cash_tracking(
    org,
    yesterday::timestamp at time zone 'America/Argentina/Cordoba',
    (
      select jsonb_agg(jsonb_build_object(
        'payment_method_id', method.id,
        'amount', case method.code when 'cash' then 50000 when 'transfer' then 100000 else 0 end
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
where organization_id = 'e1111111-aaaa-4111-8111-111111111111';
set local session_replication_role = origin;
set local role authenticated;

do $$
declare
  org constant uuid := 'e1111111-aaaa-4111-8111-111111111111';
  product_id constant uuid := 'e4444444-4444-4444-8444-444444444444';
  yesterday date := (now() at time zone 'America/Argentina/Cordoba')::date - 1;
  occurred_at timestamptz := (yesterday::timestamp + time '12:00') at time zone 'America/Argentina/Cordoba';
  cash_id uuid;
  transfer_id uuid;
  card_id uuid;
  zero_sale_id uuid;
begin
  select id into cash_id from public.payment_methods where organization_id = org and code = 'cash';
  select id into transfer_id from public.payment_methods where organization_id = org and code = 'transfer';
  select id into card_id from public.payment_methods where organization_id = org and code = 'card';

  perform public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', 100000)),
    null, 0, null, 'CASH-001', occurred_at
  );
  perform public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('payment_method_id', transfer_id, 'amount', 100000)),
    null, 0, null, 'TRANSFER-001', occurred_at
  );
  perform public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('payment_method_id', card_id, 'amount', 100000, 'card_type', 'debit')),
    null, 0, null, 'DEBIT-001', occurred_at
  );
  zero_sale_id := public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    '[]'::jsonb,
    null, 100, 'Consumo personal del dueño', 'ZERO-001', occurred_at
  );

  if not exists (
    select 1 from public.sales
    where id = zero_sale_id
      and subtotal = 100000
      and discount_percent = 100
      and discount = 100000
      and total = 0
      and payment_method_id is null
  ) then
    raise exception 'The 100-percent sale was not preserved correctly';
  end if;
  if exists (select 1 from public.sale_payments where sale_id = zero_sale_id)
    or exists (select 1 from public.cash_movements where reference_type = 'sale' and reference_id = zero_sale_id) then
    raise exception 'A fully discounted sale created a payment or cash movement';
  end if;
  if (select current_stock from public.products where id = product_id) <> 16 then
    raise exception 'The fully discounted sale did not decrement stock';
  end if;
end;
$$;

reset role;

do $$
declare
  org constant uuid := 'e1111111-aaaa-4111-8111-111111111111';
  yesterday date := (now() at time zone 'America/Argentina/Cordoba')::date - 1;
  created_closure_id uuid;
  cash_id uuid;
  transfer_id uuid;
  card_id uuid;
begin
  if not private.create_automatic_cash_closure(org, yesterday) then
    raise exception 'The automatic closure was not created';
  end if;
  if private.create_automatic_cash_closure(org, yesterday) then
    raise exception 'The automatic closure was duplicated';
  end if;

  select id into created_closure_id from public.daily_cash_closures
  where organization_id = org and business_date = yesterday;
  select id into cash_id from public.payment_methods where organization_id = org and code = 'cash';
  select id into transfer_id from public.payment_methods where organization_id = org and code = 'transfer';
  select id into card_id from public.payment_methods where organization_id = org and code = 'card';

  if not exists (
    select 1 from public.daily_cash_closures
    where id = created_closure_id
      and closure_type = 'automatic'
      and closed_by is null
      and expected_total = 450000
      and counted_total = 450000
      and difference_total = 0
  ) then
    raise exception 'The automatic closure header is incorrect';
  end if;
  if (select count(*) from public.daily_cash_closure_items as item where item.closure_id = created_closure_id) <> 2
    or not exists (
      select 1 from public.daily_cash_closure_items
      where closure_id = created_closure_id and payment_method_id = cash_id
        and opening_balance = 50000 and income = 100000 and expected_balance = 150000
    )
    or not exists (
      select 1 from public.daily_cash_closure_items
      where closure_id = created_closure_id and payment_method_id = transfer_id
        and opening_balance = 100000 and income = 200000 and expected_balance = 300000
    ) then
    raise exception 'Cash and transfer closure items are incorrect';
  end if;
  if (select current_balance from public.cash_accounts where organization_id = org and payment_method_id = card_id) <> 0
    or (select current_balance from public.cash_accounts where organization_id = org and payment_method_id = transfer_id) <> 300000 then
    raise exception 'Card funds were duplicated or posted outside transfer';
  end if;

  begin
    update public.daily_cash_closures set notes = 'Manipulated' where id = created_closure_id;
    raise exception 'An automatic closure was editable';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  org constant uuid := 'e1111111-aaaa-4111-8111-111111111111';
  yesterday date := (now() at time zone 'America/Argentina/Cordoba')::date - 1;
  workspace jsonb;
begin
  workspace := public.get_daily_cash_closure_workspace(org);
  if workspace #>> '{recent_closures,0,closure_type}' <> 'automatic' then
    raise exception 'The staff workspace does not expose the protected automatic status';
  end if;

  begin
    perform public.close_daily_cash(org, yesterday, '[]'::jsonb, null);
    raise exception 'Staff retained permission to create a manual closure';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.daily_cash_closures set notes = 'Staff manipulation';
    raise exception 'Staff could update an automatic closure';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select count(*) from cron.job where jobname = 'morita-daily-cash-closure-2200-cordoba') <> 1
    or (select schedule from cron.job where jobname = 'morita-daily-cash-closure-2200-cordoba') <> '0 1 * * *' then
    raise exception 'The 22:00 Cordoba cron is missing or duplicated';
  end if;
end;
$$;

rollback;
