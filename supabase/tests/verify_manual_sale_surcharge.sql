begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  'e1111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'manual-surcharge-owner@local.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.organizations (id, name, slug, created_by)
values (
  'e1111111-aaaa-4111-8111-111111111111',
  'Manual Surcharge Test',
  'manual-surcharge-test',
  'e1111111-1111-4111-8111-111111111111'
);

do $$
declare
  org constant uuid := 'e1111111-aaaa-4111-8111-111111111111';
  product_id uuid;
  cash_id uuid;
  transfer_id uuid;
  card_id uuid;
  cash_sale_id uuid;
  card_sale_id uuid;
  free_sale_id uuid;
  receipt jsonb;
begin
  select id into cash_id from public.payment_methods where organization_id = org and code = 'cash';
  select id into transfer_id from public.payment_methods where organization_id = org and code = 'transfer';
  select id into card_id from public.payment_methods where organization_id = org and code = 'card';

  update public.payment_methods set credit_surcharge_percent = 10 where id = card_id;

  insert into public.products (
    organization_id, name, sku, cost_price, retail_price, min_stock, target_stock
  ) values (
    org, 'Producto con recargo manual', 'MANUAL-001', 50000, 100000, 0, 100
  ) returning id into product_id;

  perform public.adjust_inventory(org, product_id, 10, 'Stock de prueba', 50000, 'e5555555-5555-4555-8555-555555555555');
  perform public.initialize_cash_tracking(
    org,
    now() - interval '1 minute',
    (
      select jsonb_agg(jsonb_build_object('payment_method_id', id, 'amount', 0) order by sort_order)
      from public.payment_methods
      where organization_id = org and is_active
    )
  );

  cash_sale_id := public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('payment_method_id', cash_id, 'amount', 95000)),
    null, 10, null, null, now(), 5000
  );

  if not exists (
    select 1 from public.sales
    where id = cash_sale_id
      and subtotal = 100000
      and discount = 10000
      and manual_surcharge = 5000
      and surcharge = 0
      and total = 95000
  ) then
    raise exception 'The fixed surcharge was not stored in the sale total';
  end if;
  if (select current_balance from public.cash_accounts where organization_id = org and payment_method_id = cash_id) <> 95000 then
    raise exception 'The fixed surcharge did not enter the cash balance';
  end if;

  receipt := public.get_sale_receipt(cash_sale_id);
  if (receipt ->> 'manual_surcharge')::numeric <> 5000 then
    raise exception 'The receipt did not preserve the fixed surcharge';
  end if;

  card_sale_id := public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', card_id,
      'amount', 5000,
      'card_type', 'credit'
    )),
    null, 100, null, null, now(), 5000
  );

  if not exists (
    select 1 from public.sales
    where id = card_sale_id
      and discount = 100000
      and manual_surcharge = 5000
      and surcharge = 500
      and total = 5500
  ) then
    raise exception 'A fully discounted sale with a fixed surcharge was calculated incorrectly';
  end if;
  if (select current_balance from public.cash_accounts where organization_id = org and payment_method_id = transfer_id) <> 5000 then
    raise exception 'The fixed surcharge was not credited to transfer or the card preview was credited twice';
  end if;

  free_sale_id := public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    '[]'::jsonb,
    null, 100
  );
  if (select total from public.sales where id = free_sale_id) <> 0 then
    raise exception 'A fully discounted sale without surcharge no longer totals zero';
  end if;

  if (select current_stock from public.products where id = product_id) <> 7 then
    raise exception 'Sale stock output was not preserved';
  end if;

  begin
    perform public.create_sale_with_payments(
      org,
      jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
      '[]'::jsonb,
      null, 100, null, null, now(), -1
    );
    raise exception 'A negative fixed surcharge was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

rollback;
