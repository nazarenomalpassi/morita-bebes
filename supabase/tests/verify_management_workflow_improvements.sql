begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.organization_members where role = 'owner' and is_active order by created_at limit 1), true);
set local role authenticated;

do $test$
declare org uuid; owner_id uuid := auth.uid(); staff_id uuid; a uuid; b uuid; category uuid; brand uuid; request_id uuid := gen_random_uuid(); new_id uuid := gen_random_uuid();
  changes jsonb; entry_items jsonb; closures_before text; sales_before text; cash_before text; rejected boolean;
begin
  select organization_id into org from public.organization_members where user_id = owner_id and role = 'owner' and is_active limit 1;
  select user_id into staff_id from public.organization_members where organization_id = org and role = 'staff' and is_active limit 1;
  select md5(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text, '[]')) into closures_before from public.daily_cash_closures c where organization_id = org;
  select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text, '[]')) into sales_before from public.sales s where organization_id = org;
  select md5(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text, '[]')) into cash_before from public.cash_movements c where organization_id = org;
  insert into public.categories(organization_id, name, slug) values (org, 'Prueba gestion ' || gen_random_uuid(), 'gestion-' || gen_random_uuid()) returning id into category;
  insert into public.brands(organization_id, name) values (org, 'Prueba marca ' || gen_random_uuid()) returning id into brand;
  insert into public.products(organization_id, name, sku, cost_price, retail_price) values (org, 'Pañales Bebé Premium XXG', '0770-' || gen_random_uuid(), 10, 20) returning id into a;
  insert into public.products(organization_id, name, sku, cost_price, retail_price, wholesale_price) values (org, 'Otra presentacion', '0771-' || gen_random_uuid(), 15, 30, 25) returning id into b;
  if not exists(select 1 from public.products where id = a and management_search_text like '%panales%' and management_search_text like '%bebe%' and management_search_text like '%0770-%') then raise exception 'Accent-insensitive management search failed'; end if;

  changes := jsonb_build_array(jsonb_build_object('product_id', a, 'cost_price', 11, 'retail_price', 22, 'wholesale_price', null, 'original_cost_price', 10, 'original_retail_price', 20, 'original_wholesale_price', null));
  perform public.update_management_prices(org, changes, 'SQL quick price test');
  if (select retail_price from public.products where id = a) <> 22 or (select current_stock from public.products where id = a) <> 0 then raise exception 'Price editing affected stock or failed'; end if;
  if not exists(select 1 from public.product_price_changes where product_id = a and previous_prices->>'retail' = '20.00' and new_prices->>'retail' = '22.00') then raise exception 'Price history missing'; end if;

  rejected := false;
  begin perform public.update_management_prices(org, changes, 'Stale editor'); exception when sqlstate 'PT409' then rejected := true; end;
  if not rejected then raise exception 'Stale quick price edit was accepted'; end if;
  rejected := false;
  begin
    perform public.update_management_prices(org, jsonb_build_array(
      jsonb_build_object('product_id', a, 'cost_price', 12, 'retail_price', 24, 'wholesale_price', null, 'original_cost_price', 11, 'original_retail_price', 22, 'original_wholesale_price', null),
      jsonb_build_object('product_id', b, 'cost_price', 16, 'retail_price', 32, 'wholesale_price', 27, 'original_cost_price', 1, 'original_retail_price', 30, 'original_wholesale_price', 25)), 'Atomic batch');
  exception when sqlstate 'PT409' then rejected := true; end;
  if not rejected or (select retail_price from public.products where id = a) <> 22 or (select retail_price from public.products where id = b) <> 30 then raise exception 'Conflicting batch was not atomic'; end if;

  perform public.classify_management_products(org, array[a,b], category, brand, true, true);
  if (select count(*) from public.products where id = any(array[a,b]) and category_id = category and brand_id = brand) <> 2 then raise exception 'Batch classification failed'; end if;
  rejected := false;
  begin perform public.classify_management_products(org, array[a,gen_random_uuid()], null, null, true, true); exception when insufficient_privilege then rejected := true; end;
  if not rejected or (select category_id from public.products where id = a) <> category then raise exception 'Classification did not reject an unavailable product atomically'; end if;
  perform public.update_product_details(org, a, jsonb_build_object('inventory_attributes', jsonb_build_object('size','XXG','presentation','30 unidades'), 'retail_price',20,'cost_price',10,'_original_prices',jsonb_build_object('cost',10,'retail',20,'wholesale',null)), 0, 0);
  if (select retail_price from public.products where id = a) <> 22 then raise exception 'An unchanged stale form overwrote a newer price'; end if;
  update public.products set inventory_attributes = '{"family":"Premium","size":"XXG","age":"6-18 meses","capacity":"260 ml","presentation":"30 unidades"}' where id = a;
  rejected := false;
  begin update public.products set inventory_attributes = '{"stock":"99"}' where id = a; exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'Unsupported management attributes accepted'; end if;

  if staff_id is null then raise exception 'Staff test user missing'; end if;
  perform set_config('request.jwt.claim.sub', staff_id::text, true);
  perform public.update_management_prices(org, jsonb_build_array(jsonb_build_object('product_id', b, 'cost_price', 16, 'retail_price', 32, 'wholesale_price', 27, 'original_cost_price',15,'original_retail_price',30,'original_wholesale_price',25)), 'Staff prices');
  update public.products set inventory_attributes = '{"size":"G"}' where id = b;
  rejected := false;
  begin delete from public.product_price_changes where product_id = b; exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Price history is editable'; end if;

  entry_items := jsonb_build_array(jsonb_build_object('product_id',new_id,'quantity',3,'unit_cost',10,'retail_price',20,'wholesale_price',null,
    'original_cost_price',0,'original_retail_price',0,'original_wholesale_price',null,
    'new_product',jsonb_build_object('name','Nuevo clasificado','sku','000-NEW-' || new_id::text,'barcode',null,'unit','unidad','category_id',category,'brand_id',brand)));
  perform public.load_inventory_entry(org, request_id, entry_items, 'New categorized stock');
  perform public.load_inventory_entry(org, request_id, entry_items, 'New categorized stock');
  if not exists(select 1 from public.products where id = new_id and current_stock = 3 and category_id = category and brand_id = brand) then raise exception 'New classified entry or idempotency failed'; end if;
  update public.products set category_id = null where id = new_id;
  perform public.load_inventory_entry(org, request_id, entry_items, 'New categorized stock');
  if (select category_id from public.products where id = new_id) is not null then raise exception 'Entry replay overwrote later classification'; end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  rejected := false;
  begin perform public.update_management_prices(org, changes, null); exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Nonmember updated prices'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if has_function_privilege('anon','public.update_management_prices(uuid,jsonb,text)','execute') or has_function_privilege('anon','public.classify_management_products(uuid,uuid[],uuid,uuid,boolean,boolean)','execute') then raise exception 'Anonymous management access is enabled'; end if;
  if closures_before is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text,'[]')) from public.daily_cash_closures c where organization_id = org)
    or sales_before is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'[]')) from public.sales s where organization_id = org)
    or cash_before is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text,'[]')) from public.cash_movements c where organization_id = org) then raise exception 'A management improvement altered historical financial records'; end if;
end;
$test$;
rollback;
