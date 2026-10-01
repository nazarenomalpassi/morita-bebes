begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('71111111-1111-4111-8111-111111111111', 'functional-audit@local.test', '{}', '{}');
alter table public.organizations disable trigger guard_organization_bootstrap;
insert into public.organizations (id, name, slug, created_by)
values ('71111111-aaaa-4111-8111-111111111111', 'Functional Audit', 'functional-audit', '71111111-1111-4111-8111-111111111111');
alter table public.organizations enable trigger guard_organization_bootstrap;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  org uuid := '71111111-aaaa-4111-8111-111111111111';
  product uuid;
  cash uuid;
  transfer uuid;
  expense uuid;
  employee uuid;
  advance uuid;
  supplier uuid;
  purchase uuid;
  purchase_item uuid;
  receipt uuid := gen_random_uuid();
  sale uuid;
  analytics jsonb;
  invalid_edit boolean := false;
  recorded_start timestamptz;
begin
  insert into public.products (organization_id, name, sku, retail_price, cost_price)
  values (org, 'Atomic product', 'AUDIT-ATOMIC', 10000, 5000) returning id into product;
  perform public.adjust_inventory(org, product, 10, 'Initial local audit inventory');
  perform public.adjust_inventory(org, product, -1, 'Concurrent sale simulation');
  perform public.update_product_details(org, product, '{"retail_price":12000}', 10, 10);
  if (select current_stock from public.products where id = product) <> 9 then
    raise exception 'A stale price form restored stock';
  end if;
  begin
    perform public.update_product_details(org, product, '{"retail_price":13000}', 10, 8);
  exception when serialization_failure then invalid_edit := true;
  end;
  if not invalid_edit or (select retail_price from public.products where id = product) <> 12000 then
    raise exception 'Conflicting stock correction was not rolled back atomically';
  end if;
  perform public.update_product_details(org, product, '{"retail_price":13000}', 9, 8);
  if (select current_stock from public.products where id = product) <> 8
    or (select retail_price from public.products where id = product) <> 13000 then
    raise exception 'Intentional inventory and price update did not commit together';
  end if;
  if (select sum(quantity_delta) from public.inventory_movements where product_id = product) <> 8 then
    raise exception 'Atomic edit bypassed inventory ledger';
  end if;
  invalid_edit := false;
  begin
    perform public.update_product_details(org, product, '{"id":"71111111-ffff-4111-8111-111111111111","current_stock":99}', 8, 8);
  exception when others then invalid_edit := true;
  end;
  if not exists (select 1 from public.products where id = product and current_stock = 8) then
    raise exception 'Product identity or stock could be altered through JSON';
  end if;
  insert into public.suppliers (organization_id, business_name)
  values (org, 'Audit supplier') returning id into supplier;
  purchase := public.create_purchase_order(org, supplier,
    jsonb_build_array(jsonb_build_object('product_id', product, 'quantity_ordered', 3, 'unit_cost', 5000)));
  update public.purchase_orders set status = 'sent' where id = purchase;
  select id into purchase_item from public.purchase_order_items where purchase_order_id = purchase;
  perform public.receive_purchase_order(purchase,
    jsonb_build_array(jsonb_build_object('purchase_order_item_id', purchase_item, 'quantity', 3, 'unit_cost', 5000)), null, receipt);
  perform public.receive_purchase_order(purchase,
    jsonb_build_array(jsonb_build_object('purchase_order_item_id', purchase_item, 'quantity', 3, 'unit_cost', 5000)), null, receipt);
  if (select current_stock from public.products where id = product) <> 11
    or (select status from public.purchase_orders where id = purchase) <> 'received' then
    raise exception 'Purchase receipt duplicated inventory or did not complete';
  end if;

  select id into cash from public.payment_methods where organization_id = org and code = 'cash';
  select id into transfer from public.payment_methods where organization_id = org and code = 'transfer';
  recorded_start := ((now() at time zone 'America/Argentina/Cordoba')::date + time '18:00')
    at time zone 'America/Argentina/Cordoba';
  perform public.initialize_cash_tracking(org, least(clock_timestamp(), recorded_start), (
    select jsonb_agg(jsonb_build_object('payment_method_id', id, 'amount', case when code in ('cash','transfer') then 100000 else 0 end))
    from public.payment_methods where organization_id = org and is_active
  ));
  insert into public.expenses (organization_id, description, amount, expense_date, payment_method_id, payment_allocations, created_by)
  values (org, 'Initial day combined expense', 1000, (now() at time zone 'America/Argentina/Cordoba')::date,
    null, jsonb_build_array(jsonb_build_object('payment_method_id', cash, 'amount', 400), jsonb_build_object('payment_method_id', transfer, 'amount', 600)), auth.uid())
  returning id into expense;
  if (select sum(signed_amount) from public.cash_movements where reference_id = expense and reference_type = 'expense') is distinct from -1000 then
    raise exception 'An expense on the cash initialization day was not debited';
  end if;
  insert into public.expenses (organization_id, description, amount, expense_date, payment_method_id, created_by)
  values (org, 'Before initial tracking day', 1000, (now() at time zone 'America/Argentina/Cordoba')::date - 1, cash, auth.uid())
  returning id into expense;
  if exists (select 1 from public.cash_movements where reference_id = expense and reference_type = 'expense') then
    raise exception 'Expense before tracking started affected cash';
  end if;
  insert into public.employees (organization_id, first_name, last_name, base_salary)
  values (org, 'Initial day', 'Payroll', 700000) returning id into employee;
  perform public.set_employee_compensation(org, employee, 700000, 1, date_trunc('month', now())::date);
  advance := public.register_payroll_advance(org, employee, date_trunc('month', now())::date,
    10000, (now() at time zone 'America/Argentina/Cordoba')::date, cash, 'Initial day advance');
  if (select sum(signed_amount) from public.cash_movements where reference_id = advance and reference_type = 'payroll_advance') is distinct from -10000 then
    raise exception 'A salary advance on the cash initialization day was not debited';
  end if;
  sale := public.create_sale_with_payments(org,
    jsonb_build_array(jsonb_build_object('product_id', product, 'quantity', 2)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash, 'amount', 20800)), null, 20);
  analytics := public.get_business_analytics(org,
    (now() at time zone 'America/Argentina/Cordoba')::date,
    (now() at time zone 'America/Argentina/Cordoba')::date,
    (now() at time zone 'America/Argentina/Cordoba')::date - 1,
    (now() at time zone 'America/Argentina/Cordoba')::date - 1, date_trunc('month', now())::date);
  if (analytics #>> '{summary,current,revenue}')::numeric <> 20800
    or (analytics #>> '{summary,current,unitsSold}')::numeric <> 2 then
    raise exception 'Reports did not reconcile the discounted net revenue and units';
  end if;
  if (select sum(signed_amount) from public.cash_movements where reference_id = sale and reference_type = 'sale') <> 20800 then
    raise exception 'Discounted sale cash entry did not match net revenue';
  end if;
end;
$$;
set local request.jwt.claims = '{"sub":"71222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare denied boolean := false;
begin
  begin
    perform public.update_product_details('71111111-aaaa-4111-8111-111111111111', gen_random_uuid(), '{}', 0, 0);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Unrelated user could edit inventory'; end if;
end;
$$;
rollback;
select 'Functional audit regression tests passed' as result;
