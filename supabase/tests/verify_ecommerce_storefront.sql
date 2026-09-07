begin;

do $$
declare
  organization_id uuid;
  retail_id constant uuid := '10000000-0000-4000-8000-000000000001';
  wholesale_id constant uuid := '10000000-0000-4000-8000-000000000002';
  admin_id constant uuid := '10000000-0000-4000-8000-000000000003';
  registration_id constant uuid := '10000000-0000-4000-8000-000000000004';
begin
  select id into organization_id from public.organizations where slug = 'morita-bebes';
  if organization_id is null then raise exception 'Morita organization missing'; end if;

  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
  values
    (retail_id, 'ecommerce-retail-test@example.invalid', '{}'::jsonb, '{}'::jsonb, false, false),
    (wholesale_id, 'ecommerce-wholesale-test@example.invalid', '{}'::jsonb, '{}'::jsonb, false, false),
    (admin_id, 'ecommerce-admin-test@example.invalid', '{}'::jsonb, '{}'::jsonb, false, false),
    (
      registration_id,
      'ecommerce-registration-test@example.invalid',
      '{}'::jsonb,
      '{"store_registration":true,"organization_slug":"morita-bebes","first_name":"Registro","last_name":"Mayorista","phone":"351333333","locality":"Río Tercero","province":"Córdoba","customer_type":"wholesale","business_name":"Comercio prueba"}'::jsonb,
      false,
      false
    );

  insert into public.organization_members (organization_id, user_id, role)
  values (organization_id, admin_id, 'admin');

  insert into public.store_customer_profiles (
    user_id, organization_id, email, first_name, last_name, phone, locality, province,
    customer_type, wholesale_status
  ) values
    (retail_id, organization_id, 'ecommerce-retail-test@example.invalid', 'Cliente', 'Minorista', '351111111', 'Río Tercero', 'Córdoba', 'retail', 'not_requested'),
    (wholesale_id, organization_id, 'ecommerce-wholesale-test@example.invalid', 'Cliente', 'Mayorista', '351222222', 'Río Tercero', 'Córdoba', 'wholesale', 'approved');

  if not exists (
    select 1 from public.store_customer_profiles
    where user_id = registration_id
      and customer_type = 'wholesale'
      and wholesale_status = 'pending'
      and business_name = 'Comercio prueba'
  ) then
    raise exception 'Store registration trigger did not create the pending wholesale profile';
  end if;

  insert into public.products (
    id, organization_id, name, sku, cost_price, retail_price, wholesale_price,
    wholesale_min_quantity, current_stock, min_stock, unit, is_active, is_published
  ) values (
    '20000000-0000-4000-8000-000000000001', organization_id, 'Producto prueba ecommerce',
    'ECOMMERCE-TEST-SKU', 10000, 20000, 500000, 1, 10, 0, 'unidad', true, true
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

do $$
declare
  visible_price numeric;
  created jsonb;
  retried jsonb;
  direct_product_rows integer;
  snapshot_stock numeric;
begin
  select count(*) into direct_product_rows from public.products
  where id = '20000000-0000-4000-8000-000000000001';
  if direct_product_rows <> 0 then raise exception 'Retail customer bypassed the safe catalog RPC'; end if;
  select display_price into visible_price
  from public.list_store_products('morita-bebes', null, null, null, 'all', 'featured', null, 60, 0)
  where id = '20000000-0000-4000-8000-000000000001';
  if visible_price <> 20000 then raise exception 'Retail price isolation failed: %', visible_price; end if;

  select current_stock into snapshot_stock
  from public.get_store_cart_snapshot(
    'morita-bebes',
    array['20000000-0000-4000-8000-000000000001'::uuid]
  )
  where id = '20000000-0000-4000-8000-000000000001';
  if snapshot_stock <> 10 then raise exception 'Cart snapshot stock failed: %', snapshot_stock; end if;

  created := public.create_web_order_idempotent(
    'morita-bebes',
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'Automated ecommerce test'
  );
  retried := public.create_web_order_idempotent(
    'morita-bebes',
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    '30000000-0000-4000-8000-000000000001',
    'Automated ecommerce test'
  );
  if (created ->> 'total')::numeric <> 20000 then raise exception 'Retail order total failed'; end if;
  if created ->> 'id' <> retried ->> 'id' then raise exception 'Order idempotency failed'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

do $$
declare
  visible_price numeric;
  created jsonb;
begin
  select display_price into visible_price
  from public.list_store_products('morita-bebes', null, null, null, 'all', 'featured', null, 60, 0)
  where id = '20000000-0000-4000-8000-000000000001';
  if visible_price <> 500000 then raise exception 'Wholesale price access failed: %', visible_price; end if;
  created := public.create_web_order_idempotent(
    'morita-bebes',
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    '30000000-0000-4000-8000-000000000002',
    null
  );
  if (created ->> 'total')::numeric <> 500000 then raise exception 'Wholesale order total failed'; end if;
end;
$$;

reset role;
update public.products
set retail_price = 25000
where id = '20000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

do $$
declare
  target_order uuid;
  wholesale_order uuid;
  cash_method_id uuid;
  card_method_id uuid;
  created_sale_id uuid;
  retried_sale_id uuid;
  card_sale_id uuid;
  product_stock numeric;
  cash_total numeric;
  captured_price numeric;
  expected_card_surcharge numeric;
begin
  select id into target_order from public.web_orders
  where customer_user_id = '10000000-0000-4000-8000-000000000001';
  select id into cash_method_id from public.payment_methods
  where code = 'cash' and is_active
    and organization_id = (select organization_id from public.web_orders where id = target_order);
  select id, round(500000 * debit_surcharge_percent / 100, 2)
  into card_method_id, expected_card_surcharge
  from public.payment_methods
  where code = 'card' and is_active
    and organization_id = (select organization_id from public.web_orders where id = target_order);

  select current_stock into product_stock from public.products where id = '20000000-0000-4000-8000-000000000001';
  if product_stock <> 10 then raise exception 'Creating a web order changed stock before confirmation: %', product_stock; end if;

  created_sale_id := (public.confirm_web_order_sale(target_order, cash_method_id, null) ->> 'sale_id')::uuid;
  retried_sale_id := (public.confirm_web_order_sale(target_order, cash_method_id, null) ->> 'sale_id')::uuid;
  if created_sale_id is distinct from retried_sale_id then raise exception 'Web order confirmation is not idempotent'; end if;

  select current_stock into product_stock from public.products where id = '20000000-0000-4000-8000-000000000001';
  if product_stock <> 9 then raise exception 'Confirmed sale did not deduct stock exactly once: %', product_stock; end if;
  select unit_price into captured_price from public.sale_items where sale_id = created_sale_id;
  if captured_price <> 20000 then raise exception 'Sale did not preserve the web order price snapshot: %', captured_price; end if;
  if (select sale_id from public.web_orders where id = target_order) is distinct from created_sale_id then
    raise exception 'Web order was not linked to its internal sale';
  end if;
  if (select total from public.sales where id = created_sale_id) <> 20000 then raise exception 'Internal sale total differs from the order'; end if;
  select coalesce(sum(signed_amount), 0) into cash_total from public.cash_movements
  where reference_type = 'sale' and reference_id = created_sale_id;
  if cash_total <> 20000 then raise exception 'Confirmed web order did not enter cash exactly once: %', cash_total; end if;

  perform public.transition_web_order(target_order, 'cancelled');
  select current_stock into product_stock from public.products where id = '20000000-0000-4000-8000-000000000001';
  if product_stock <> 10 then raise exception 'Cancellation did not restore stock: %', product_stock; end if;
  if (select status from public.sales where id = created_sale_id) <> 'cancelled' then raise exception 'Linked sale was not cancelled'; end if;
  select coalesce(sum(signed_amount), 0) into cash_total from public.cash_movements
  where reference_type = 'sale' and reference_id = created_sale_id;
  if cash_total <> 0 then raise exception 'Cancellation did not reverse the cash movement: %', cash_total; end if;

  select id into wholesale_order from public.web_orders
  where customer_user_id = '10000000-0000-4000-8000-000000000002';
  card_sale_id := (public.confirm_web_order_sale(wholesale_order, card_method_id, 'debit') ->> 'sale_id')::uuid;
  if (select payment_card_type from public.web_orders where id = wholesale_order) <> 'debit' then
    raise exception 'Card subtype was not stored on the web order';
  end if;
  if (select payment_surcharge_amount from public.web_orders where id = wholesale_order) <> expected_card_surcharge then
    raise exception 'Card surcharge snapshot is incorrect';
  end if;
  if (select total from public.sales where id = card_sale_id) <> 500000 + expected_card_surcharge then
    raise exception 'Card sale total did not include the configured posnet surcharge';
  end if;
  select coalesce(sum(signed_amount), 0) into cash_total from public.cash_movements
  where reference_type = 'sale' and reference_id = card_sale_id;
  if cash_total <> 500000 then raise exception 'Card payment did not enter the transfer account by its base amount: %', cash_total; end if;
  perform public.transition_web_order(wholesale_order, 'cancelled');
  if (select current_stock from public.products where id = '20000000-0000-4000-8000-000000000001') <> 10 then
    raise exception 'Card order cancellation did not restore stock';
  end if;
end;
$$;

reset role;

do $$
begin
  if (select count(*) from public.web_orders where notes = 'Automated ecommerce test') <> 1 then
    raise exception 'Expected one persisted retail order inside the test transaction';
  end if;
end;
$$;

rollback;
