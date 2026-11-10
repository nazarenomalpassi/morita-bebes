begin;
select set_config('request.jwt.claim.sub',
  (select user_id::text from public.organization_members where role = 'owner' and is_active order by created_at limit 1), true);
set local role authenticated;

do $test$
declare
  org uuid;
  owner_id uuid := auth.uid();
  staff_id uuid;
  existing_id uuid := gen_random_uuid();
  new_id uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff1';
  only_new_id uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  before_orders bigint;
  before_receipts bigint;
  before_suppliers bigint;
  before_cash bigint;
  before_expenses bigint;
  before_sales bigint;
  before_closures bigint;
  existing_item jsonb;
  new_item jsonb;
  items jsonb;
  invalid_items jsonb;
  failed boolean;
  result uuid;
begin
  select organization_id into org from public.organization_members where user_id = owner_id and role = 'owner' and is_active limit 1;
  select user_id into staff_id from public.organization_members where organization_id = org and role = 'staff' and is_active limit 1;
  if staff_id is null then raise exception 'Staff fixture required'; end if;
  select count(*) into before_orders from public.purchase_orders;
  select count(*) into before_receipts from public.purchase_receipts;
  select count(*) into before_suppliers from public.suppliers;
  select count(*) into before_cash from public.cash_movements;
  select count(*) into before_expenses from public.expenses;
  select count(*) into before_sales from public.sales;
  select count(*) into before_closures from public.daily_cash_closures;
  insert into public.products(id, organization_id, name, sku, barcode, cost_price, retail_price)
  values(existing_id, org, 'Existente ingreso SQL', 'ENTRY-EXISTING-' || existing_id, 'ENTRY-BAR-' || existing_id, 10, 20);
  existing_item := jsonb_build_object('product_id', existing_id, 'quantity', 2.5, 'unit_cost', 12.50, 'retail_price', 25,
    'wholesale_price', 22, 'original_cost_price', 10, 'original_retail_price', 20, 'original_wholesale_price', null);
  new_item := jsonb_build_object('product_id', new_id, 'quantity', 4, 'unit_cost', 7.25, 'retail_price', 15,
    'wholesale_price', null, 'original_cost_price', 0, 'original_retail_price', 0, 'original_wholesale_price', null,
    'new_product', jsonb_build_object('name', 'Nuevo ingreso SQL', 'sku', E' 00012345006789\t', 'barcode', U&'\200B00012345006789', 'unit', 'paquete'));
  items := jsonb_build_array(existing_item, new_item);

  -- A late duplicate must roll back staged prices, stock and new products together.
  failed := false;
  begin
    perform public.load_inventory_entry(org, gen_random_uuid(), jsonb_build_array(existing_item,
      jsonb_set(new_item, '{new_product,sku}', to_jsonb('ENTRY-BAR-' || existing_id))));
  exception when unique_violation then failed := true;
  end;
  if not failed or (select cost_price from public.products where id=existing_id) <> 10
    or (select current_stock from public.products where id=existing_id) <> 0
    or exists(select 1 from public.products where id=new_id) then
    raise exception 'Duplicate code did not roll back the entire entry';
  end if;

  foreach invalid_items in array array[
    jsonb_build_array(existing_item || '{"quantity":0}'::jsonb),
    jsonb_build_array(existing_item || '{"quantity":-1}'::jsonb),
    jsonb_build_array(existing_item || '{"quantity":1.0001}'::jsonb),
    jsonb_build_array(existing_item || '{"unit_cost":2.001}'::jsonb),
    jsonb_build_array(existing_item || '{"retail_price":-1}'::jsonb),
    jsonb_build_array(jsonb_set(new_item, '{new_product,sku}', '12345'::jsonb)),
    jsonb_build_array(jsonb_set(new_item, '{new_product,unit}', '"invalida"'::jsonb)),
    jsonb_build_array(existing_item, existing_item), '[]'::jsonb, '{}'::jsonb
  ] loop
    failed := false;
    begin
      perform public.load_inventory_entry(org, gen_random_uuid(), invalid_items);
    exception when invalid_parameter_value then failed := true;
    end;
    if not failed then raise exception 'Invalid entry accepted: %', invalid_items; end if;
  end loop;
  failed := false;
  begin
    perform public.load_inventory_entry(org, gen_random_uuid(), jsonb_build_array(jsonb_set(new_item, '{new_product,sku}', '"7.79E+12"'::jsonb)));
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'Scientific identifier accepted'; end if;
  update public.products set is_active=false where id=existing_id;
  failed := false;
  begin
    perform public.load_inventory_entry(org, gen_random_uuid(), jsonb_build_array(existing_item,
      jsonb_set(new_item, '{product_id}', '"00000000-0000-4000-8000-000000000003"'::jsonb)));
  exception when foreign_key_violation then failed := true;
  end;
  if not failed or exists(select 1 from public.products where id='00000000-0000-4000-8000-000000000003') then
    raise exception 'Late invalid item left a newly created product behind';
  end if;
  update public.products set is_active=true where id=existing_id;
  update public.products set retail_price=21 where id=existing_id;
  failed := false;
  begin
    perform public.load_inventory_entry(org, gen_random_uuid(), items);
  exception when sqlstate 'PT409' then failed := true;
  end;
  if not failed or exists(select 1 from public.products where id=new_id) then raise exception 'Price conflict was not atomic'; end if;
  update public.products set retail_price=20 where id=existing_id;
  perform public.adjust_inventory(org, existing_id, 3, 'Concurrent stock fixture');
  failed := false;
  begin
    perform public.load_inventory_entry(gen_random_uuid(), gen_random_uuid(), items);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Foreign organization entry accepted'; end if;
  perform set_config('request.jwt.claim.sub', staff_id::text, true);
  result := public.load_inventory_entry(org, request_id, items, 'Sin proveedor ni documentos');
  if result <> request_id or (select current_stock from public.products where id=existing_id) <> 5.5
    or not exists(select 1 from public.products where id=new_id and sku='00012345006789' and barcode='00012345006789'
      and current_stock=4 and cost_price=7.25 and retail_price=15 and unit='paquete' and default_supplier_id is null and not is_published)
    or not exists(select 1 from public.products where id=existing_id and cost_price=12.5 and retail_price=25 and wholesale_price=22) then
    raise exception 'Mixed entry did not create products and update stock/prices';
  end if;
  if (select count(*) from public.inventory_movements where notes like 'Ingreso de mercaderia #' || request_id::text || '%' and created_by=staff_id) <> 2 then
    raise exception 'Entry movements or actor are incorrect';
  end if;
  if public.load_inventory_entry(org, request_id, items, 'Sin proveedor ni documentos') <> result
    or (select current_stock from public.products where id=new_id) <> 4 then raise exception 'Retry duplicated stock'; end if;
  failed := false;
  begin
    perform public.load_inventory_entry(org, request_id, jsonb_build_array(new_item), 'Sin proveedor ni documentos');
  exception when unique_violation then failed := true;
  end;
  if not failed then raise exception 'Changed retry accepted'; end if;
  failed := false;
  begin
    delete from private.inventory_entries where id=request_id;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'Staff deleted idempotency data'; end if;
  perform public.load_inventory_entry(org, gen_random_uuid(), jsonb_build_array(
    jsonb_set(jsonb_set(new_item, '{product_id}', to_jsonb(only_new_id)), '{new_product,sku}', to_jsonb('ONLY-NEW-' || only_new_id))
      #- '{new_product,barcode}'));
  if (select current_stock from public.products where id=only_new_id) <> 4 then raise exception 'New-only entry failed'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if (select count(*) from public.purchase_orders) <> before_orders or (select count(*) from public.purchase_receipts) <> before_receipts
    or (select count(*) from public.suppliers) <> before_suppliers or (select count(*) from public.cash_movements) <> before_cash
    or (select count(*) from public.expenses) <> before_expenses or (select count(*) from public.sales) <> before_sales
    or (select count(*) from public.daily_cash_closures) <> before_closures then
    raise exception 'Entry created purchase documents or changed financial/history records';
  end if;
  if has_function_privilege('anon','public.load_inventory_entry(uuid,uuid,jsonb,text)','EXECUTE')
    or (select prosecdef from pg_proc where oid='public.load_inventory_entry(uuid,uuid,jsonb,text)'::regprocedure) then
    raise exception 'Inventory entry privilege or invoker security is incorrect';
  end if;
end;
$test$;
select 'passed: standalone mixed entry, new products, atomic rollback, text identifiers, staff access, concurrency guard, idempotency and no purchase/financial side effects' as result;
rollback;
