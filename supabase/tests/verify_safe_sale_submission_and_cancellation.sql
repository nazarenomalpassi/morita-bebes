begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f6111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'safe-sale-owner@local.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('f6222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'safe-sale-staff@local.test', '{}'::jsonb, '{}'::jsonb, now(), now());

create temporary table safe_sale_context (organization_id uuid primary key);
insert into safe_sale_context select id from public.organizations order by created_at limit 1;
grant select on safe_sale_context to authenticated;

insert into public.organization_members (organization_id, user_id, role)
select organization_id, 'f6111111-1111-4111-8111-111111111111'::uuid, 'owner'::public.app_role from safe_sale_context
union all
select organization_id, 'f6222222-2222-4222-8222-222222222222'::uuid, 'staff'::public.app_role from safe_sale_context;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f6111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  org uuid := (select organization_id from safe_sale_context);
  product_id uuid;
  cash_id uuid;
  first_sale_id uuid;
  repeated_sale_id uuid;
begin
  select id into cash_id from public.payment_methods where organization_id = org and code = 'cash';
  insert into public.products (organization_id, name, sku, cost_price, retail_price, min_stock, target_stock)
  values (org, 'Producto prueba venta segura', 'SAFE-TEST-20260826', 5000, 10000, 0, 20)
  returning id into product_id;
  perform public.adjust_inventory(org, product_id, 20, 'Stock transaccional de prueba', 5000, 'f6333333-3333-4333-8333-333333333333');

  first_sale_id := public.create_idempotent_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 2)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', 20000)),
    'f6444444-4444-4444-8444-444444444444'
  );
  repeated_sale_id := public.create_idempotent_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 2)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', 20000)),
    'f6444444-4444-4444-8444-444444444444'
  );

  if first_sale_id <> repeated_sale_id then raise exception 'Idempotent retry returned another sale'; end if;
  if (select count(*) from public.sales where organization_id = org and created_by = 'f6111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'Idempotent retry duplicated the sale row';
  end if;
  if (select current_stock from public.products where id = product_id) <> 18 then raise exception 'Idempotent retry duplicated stock output'; end if;
  if (select coalesce(sum(signed_amount), 0) from public.cash_movements where reference_type = 'sale' and reference_id = first_sale_id) <> 20000 then
    raise exception 'Idempotent retry duplicated or lost the cash movement';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"f6222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  org uuid := (select organization_id from safe_sale_context);
  product_id uuid;
  cash_id uuid;
  staff_sale_id uuid;
  stock_before numeric;
begin
  select id, current_stock into product_id, stock_before from public.products where organization_id = org and sku = 'SAFE-TEST-20260826';
  select id into cash_id from public.payment_methods where organization_id = org and code = 'cash';

  staff_sale_id := public.create_idempotent_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', 10000)),
    'f6555555-5555-4555-8555-555555555555'
  );
  perform public.cancel_sale(staff_sale_id, 'Venta confirmada accidentalmente');

  if not exists (
    select 1 from public.sales
    where id = staff_sale_id and status = 'cancelled'
      and cancelled_by = 'f6222222-2222-4222-8222-222222222222'
      and cancellation_reason = 'Venta confirmada accidentalmente'
  ) then raise exception 'Staff cancellation audit fields are incomplete'; end if;
  if (select current_stock from public.list_operational_products(org) where id = product_id) <> stock_before then
    raise exception 'Staff cancellation did not restore the stock';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"f6111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  org uuid := (select organization_id from safe_sale_context);
  product_id uuid;
  card_id uuid;
  card_sale_id uuid;
  stock_before numeric;
  movement_count integer;
begin
  select id, current_stock into product_id, stock_before from public.products where organization_id = org and sku = 'SAFE-TEST-20260826';
  select id into card_id from public.payment_methods where organization_id = org and code = 'card';

  card_sale_id := public.create_idempotent_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('payment_method_id', card_id, 'amount', 10000, 'card_type', 'debit')),
    'f6666666-6666-4666-8666-666666666666'
  );
  if (select coalesce(sum(signed_amount), 0) from public.cash_movements where reference_type = 'sale' and reference_id = card_sale_id) <> 10000 then
    raise exception 'Debit sale did not enter one financial account exactly once';
  end if;

  perform public.cancel_sale(card_sale_id, 'Medio de pago incorrecto');
  if (select current_stock from public.products where id = product_id) <> stock_before then raise exception 'Cancellation did not restore stock'; end if;
  if (select coalesce(sum(signed_amount), 0) from public.cash_movements where reference_type = 'sale' and reference_id = card_sale_id) <> 0 then
    raise exception 'Debit cancellation did not reverse the transfer financial account';
  end if;

  select count(*) into movement_count from public.cash_movements where reference_type = 'sale' and reference_id = card_sale_id;
  begin
    perform public.cancel_sale(card_sale_id, 'Segundo intento');
    raise exception 'Double cancellation unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
  if (select count(*) from public.cash_movements where reference_type = 'sale' and reference_id = card_sale_id) <> movement_count then
    raise exception 'Double cancellation duplicated a financial movement';
  end if;

  if (public.get_sale_receipt(card_sale_id) ->> 'status') <> 'cancelled'
    or nullif(public.get_sale_receipt(card_sale_id) ->> 'cancelled_by_name', '') is null
    or (public.get_sale_receipt(card_sale_id) ->> 'cancellation_reason') <> 'Medio de pago incorrecto' then
    raise exception 'Cancelled receipt is missing its audit context';
  end if;
end;
$$;

rollback;
