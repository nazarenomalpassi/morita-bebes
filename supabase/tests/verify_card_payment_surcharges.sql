begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  'd1111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'card-owner@local.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.organizations (id, name, slug, created_by)
values (
  'd1111111-aaaa-4111-8111-111111111111',
  'Card Surcharge Test',
  'card-surcharge-test',
  'd1111111-1111-4111-8111-111111111111'
);

do $$
declare
  org constant uuid := 'd1111111-aaaa-4111-8111-111111111111';
  product_id uuid;
  cash_id uuid;
  transfer_id uuid;
  card_id uuid;
  first_sale_id uuid;
  second_sale_id uuid;
  combined_sale_id uuid;
  receipt jsonb;
begin
  if (select count(*) from public.payment_methods where organization_id = org and is_active) <> 3
    or exists (
      select 1 from public.payment_methods
      where organization_id = org and is_active and code not in ('cash', 'transfer', 'card')
    ) then
    raise exception 'New organizations must expose exactly cash, transfer and card';
  end if;

  select id into cash_id from public.payment_methods where organization_id = org and code = 'cash';
  select id into transfer_id from public.payment_methods where organization_id = org and code = 'transfer';
  select id into card_id from public.payment_methods where organization_id = org and code = 'card';

  update public.payment_methods
  set debit_surcharge_percent = 3.5, credit_surcharge_percent = 13
  where id = card_id;

  insert into public.products (
    organization_id, name, sku, cost_price, retail_price, min_stock, target_stock
  ) values (
    org, 'Producto con tarjeta', 'CARD-001', 50000, 100000, 0, 100
  ) returning id into product_id;

  perform public.adjust_inventory(
    org,
    product_id,
    20,
    'Stock para probar recargos',
    50000,
    'd5555555-5555-4555-8555-555555555555'
  );

  perform public.initialize_cash_tracking(
    org,
    now() - interval '1 minute',
    (
      select jsonb_agg(jsonb_build_object('payment_method_id', id, 'amount', 0) order by sort_order)
      from public.payment_methods
      where organization_id = org and is_active
    )
  );

  first_sale_id := public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', card_id,
      'amount', 100000,
      'card_type', 'credit'
    ))
  );

  if not exists (
    select 1 from public.sales
    where id = first_sale_id and subtotal = 100000 and surcharge = 13000 and total = 113000
  ) then
    raise exception 'Credit surcharge was not added to the sale total';
  end if;
  if not exists (
    select 1 from public.sale_payments
    where sale_id = first_sale_id
      and base_amount = 100000
      and card_type = 'credit'
      and surcharge_percentage = 13
      and surcharge_amount = 13000
      and amount = 113000
  ) then
    raise exception 'Credit payment snapshot is incomplete';
  end if;
  if (
    select current_balance from public.cash_accounts
    where organization_id = org and payment_method_id = transfer_id
  ) <> 100000 then
    raise exception 'Card sale did not credit its base value to transfer';
  end if;
  if (select current_balance from public.cash_accounts where organization_id = org and payment_method_id = card_id) <> 0 then
    raise exception 'Card sale created a third financial balance';
  end if;

  update public.payment_methods set credit_surcharge_percent = 15 where id = card_id;
  if (select surcharge_percentage from public.sale_payments where sale_id = first_sale_id) <> 13 then
    raise exception 'Changing settings modified a historical payment snapshot';
  end if;

  second_sale_id := public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', card_id,
      'amount', 100000,
      'card_type', 'credit'
    ))
  );
  if (select total from public.sales where id = second_sale_id) <> 115000 then
    raise exception 'New credit percentage was not applied to the next sale';
  end if;
  if (
    select current_balance from public.cash_accounts
    where organization_id = org and payment_method_id = transfer_id
  ) <> 200000 then
    raise exception 'Changing the card percentage changed the amount credited to cash';
  end if;

  update public.payment_methods set credit_surcharge_percent = 13 where id = card_id;
  combined_sale_id := public.create_sale_with_payments(
    org,
    jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
    jsonb_build_array(
      jsonb_build_object('payment_method_id', cash_id, 'amount', 40000),
      jsonb_build_object('payment_method_id', card_id, 'amount', 60000, 'card_type', 'credit')
    )
  );
  if (select total from public.sales where id = combined_sale_id) <> 107800
    or (select surcharge from public.sales where id = combined_sale_id) <> 7800
    or (select sum(base_amount) from public.sale_payments where sale_id = combined_sale_id) <> 100000
    or (select sum(amount) from public.sale_payments where sale_id = combined_sale_id) <> 107800 then
    raise exception 'Combined payment did not apply the surcharge only to the card allocation';
  end if;
  if (
    select current_balance from public.cash_accounts
    where organization_id = org and payment_method_id = transfer_id
  ) <> 260000 or (
    select current_balance from public.cash_accounts
    where organization_id = org and payment_method_id = cash_id
  ) <> 40000 then
    raise exception 'Combined payment credited something other than each base allocation';
  end if;

  receipt := public.get_sale_receipt(first_sale_id);
  if (receipt ->> 'surcharge')::numeric <> 13000
    or receipt #>> '{payments,0,method}' <> 'Tarjeta de crédito'
    or (receipt #>> '{payments,0,surcharge_percentage}')::numeric <> 13 then
    raise exception 'Receipt did not preserve the card surcharge snapshot';
  end if;

  begin
    perform public.create_sale_with_payments(
      org,
      jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1)),
      jsonb_build_array(jsonb_build_object('payment_method_id', card_id, 'amount', 100000))
    );
    raise exception 'Card payment without type was accepted';
  exception when invalid_parameter_value then null;
  end;

  perform public.cancel_sale(first_sale_id, 'Prueba de reversión neta');
  if (
    select current_balance from public.cash_accounts
    where organization_id = org and payment_method_id = transfer_id
  ) <> 160000 then
    raise exception 'Card cancellation reversed the Posnet charge instead of the product value';
  end if;
end;
$$;

rollback;
