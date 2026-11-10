begin;
select set_config('request.jwt.claim.sub',
  (select user_id::text from public.organization_members where role = 'owner' and is_active order by created_at limit 1), true);
set local role authenticated;

do $test$
declare
  org uuid;
  owner_id uuid := auth.uid();
  staff_id uuid;
  supplier uuid;
  product_a uuid;
  product_b uuid;
  request_id uuid := gen_random_uuid();
  loaded_order uuid;
  replayed_order uuid;
  items jsonb;
  invalid_items jsonb;
  item_a jsonb;
  item_b jsonb;
  orders_before bigint;
  cash_before bigint;
  sales_before bigint;
  closures_before bigint;
  failure boolean;
begin
  select organization_id into org from public.organization_members where user_id = owner_id and role = 'owner' and is_active limit 1;
  select user_id into staff_id from public.organization_members where organization_id = org and role = 'staff' and is_active limit 1;
  insert into public.suppliers(organization_id, business_name) values (org, 'Proveedor carga directa SQL') returning id into supplier;
  insert into public.products(organization_id, name, sku, cost_price, retail_price)
    values (org, 'Carga directa A', 'SQL-DIRECT-' || gen_random_uuid(), 10, 20) returning id into product_a;
  insert into public.products(organization_id, name, sku, cost_price, retail_price, wholesale_price)
    values (org, 'Carga directa B', 'SQL-DIRECT-' || gen_random_uuid(), 5, 9, 8) returning id into product_b;
  item_a := jsonb_build_object('product_id', product_a, 'quantity', 2.5, 'unit_cost', 12.50,
    'retail_price', 22.50, 'wholesale_price', 18.50, 'original_cost_price', 10, 'original_retail_price', 20, 'original_wholesale_price', null);
  item_b := jsonb_build_object('product_id', product_b, 'quantity', 1, 'unit_cost', 5,
    'retail_price', 9, 'wholesale_price', 8, 'original_cost_price', 5, 'original_retail_price', 9, 'original_wholesale_price', 8);
  items := jsonb_build_array(item_a, item_b);
  select count(*) into orders_before from public.purchase_orders where organization_id = org;
  select count(*) into cash_before from public.cash_movements where organization_id = org;
  select count(*) into sales_before from public.sales where organization_id = org;
  select count(*) into closures_before from public.daily_cash_closures where organization_id = org;

  -- The supplier error happens AFTER staged price edits: all must roll back.
  failure := false;
  begin
    perform public.load_received_purchase_order(org, gen_random_uuid(), gen_random_uuid(), current_date, items);
  exception when foreign_key_violation then failure := true;
  end;
  if not failure or (select cost_price from public.products where id = product_a) <> 10
    or (select retail_price from public.products where id = product_a) <> 20
    or (select count(*) from public.purchase_orders where organization_id = org) <> orders_before then
    raise exception 'Invalid supplier did not roll back the entire direct entry';
  end if;

  foreach invalid_items in array array[
    jsonb_build_array(item_a || '{"quantity":0}'::jsonb),
    jsonb_build_array(item_a || '{"quantity":-1}'::jsonb),
    jsonb_build_array(item_a || '{"quantity":1.0001}'::jsonb),
    jsonb_build_array(item_a || '{"unit_cost":1.005}'::jsonb),
    jsonb_build_array(item_a || '{"retail_price":-2}'::jsonb),
    jsonb_build_array(item_a || '{"wholesale_price":-1}'::jsonb),
    jsonb_build_array(item_a || '{"product_id":null}'::jsonb),
    jsonb_build_array(item_a, item_a), '[]'::jsonb, '{}'::jsonb
  ] loop
    failure := false;
    begin
      perform public.load_received_purchase_order(org, supplier, gen_random_uuid(), current_date, invalid_items);
    exception when invalid_parameter_value then failure := true;
    end;
    if not failure then raise exception 'Invalid direct entry was accepted: %', invalid_items; end if;
  end loop;
  failure := false;
  begin
    perform public.load_received_purchase_order(org, supplier, gen_random_uuid(), current_date + 1, items);
  exception when invalid_parameter_value then failure := true;
  end;
  if not failure then raise exception 'Future document date was accepted'; end if;

  update public.products set retail_price = 21 where id = product_a;
  failure := false;
  begin
    perform public.load_received_purchase_order(org, supplier, gen_random_uuid(), current_date, items);
  exception when sqlstate 'PT409' then failure := true;
  end;
  if not failure or (select cost_price from public.products where id = product_a) <> 10 then
    raise exception 'Conflicting price edit was accepted or partially applied';
  end if;
  update public.products set retail_price = 20 where id = product_a;
  update public.products set cost_price = 6, retail_price = 10, wholesale_price = 9 where id = product_b;
  perform public.adjust_inventory(org, product_a, 3, 'Concurrent inventory fixture');
  update public.products set is_active = false where id = product_b;
  failure := false;
  begin
    perform public.load_received_purchase_order(org, supplier, gen_random_uuid(), current_date, items);
  exception when foreign_key_violation then failure := true;
  end;
  if not failure then raise exception 'Inactive product was accepted'; end if;
  update public.products set is_active = true where id = product_b;

  failure := false;
  begin
    perform public.load_received_purchase_order(gen_random_uuid(), supplier, gen_random_uuid(), current_date, items);
  exception when insufficient_privilege then failure := true;
  end;
  if not failure then raise exception 'Foreign organization access was accepted'; end if;

  if staff_id is null then raise exception 'Active staff fixture is required'; end if;
  perform set_config('request.jwt.claim.sub', staff_id::text, true);
  loaded_order := public.load_received_purchase_order(org, supplier, request_id, current_date, items, 'REM-SQL-DIRECT', 'Ingreso controlado');
  if not exists (select 1 from public.purchase_orders where id = loaded_order and status = 'received'
      and received_at is not null and estimated_total = 36.25 and created_by = staff_id) then
    raise exception 'Direct entry did not become a received order';
  end if;
  if (select count(*) from public.purchase_order_items where purchase_order_id = loaded_order and quantity_received = quantity_ordered) <> 2
    or (select count(*) from public.inventory_movements where reference_type = 'purchase_receipt' and reference_id = request_id and kind = 'purchase' and created_by = staff_id) <> 2 then
    raise exception 'Receipt quantities or inventory ledger are incorrect';
  end if;
  if not exists (select 1 from public.products where id = product_a and current_stock = 5.5
      and cost_price = 12.50 and retail_price = 22.50 and wholesale_price = 18.50)
    or not exists (select 1 from public.products where id = product_b and current_stock = 1
      and cost_price = 6 and retail_price = 10 and wholesale_price = 9) then
    raise exception 'Stock increments or edited/untouched catalog prices are incorrect';
  end if;
  replayed_order := public.load_received_purchase_order(org, supplier, request_id, current_date, items, 'REM-SQL-DIRECT', 'Ingreso controlado');
  if replayed_order <> loaded_order or (select current_stock from public.products where id = product_a) <> 5.5
    or (select count(*) from public.purchase_orders where organization_id = org) <> orders_before + 1 then
    raise exception 'Retry duplicated stock or order';
  end if;
  failure := false;
  begin
    perform public.load_received_purchase_order(org, supplier, request_id, current_date, jsonb_build_array(item_a), 'REM-SQL-DIRECT', 'Ingreso controlado');
  exception when unique_violation then failure := true;
  end;
  if not failure then raise exception 'Request id reuse with changed data was accepted'; end if;
  failure := false;
  begin
    delete from private.direct_purchase_entries where id = request_id;
  exception when insufficient_privilege then failure := true;
  end;
  if not failure then raise exception 'Staff deleted an idempotency entry'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if (select count(*) from public.cash_movements where organization_id = org) <> cash_before
    or (select count(*) from public.sales where organization_id = org) <> sales_before
    or (select count(*) from public.daily_cash_closures where organization_id = org) <> closures_before then
    raise exception 'Direct receipt changed cash, sales, or historical closures';
  end if;
  if has_function_privilege('anon', 'public.load_received_purchase_order(uuid,uuid,uuid,date,jsonb,text,text)', 'EXECUTE')
    or (select prosecdef from pg_proc where oid = 'public.load_received_purchase_order(uuid,uuid,uuid,date,jsonb,text,text)'::regprocedure) then
    raise exception 'Direct receipt execute privilege or invoker security is incorrect';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
end;
$test$;
select 'passed: atomic direct receipt, staff permissions, price concurrency, exact stock increments, idempotency, validation, no cash impact, rollback' as result;
rollback;
