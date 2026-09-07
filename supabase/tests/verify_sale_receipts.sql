begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'receipt-owner@local.test', '{}'::jsonb, '{"display_name":"Dueña Moritas"}'::jsonb, now(), now()),
  ('a2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'receipt-staff@local.test', '{}'::jsonb, '{"display_name":"Vendedora Moritas"}'::jsonb, now(), now()),
  ('a3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'receipt-other@local.test', '{}'::jsonb, '{"display_name":"Otra Vendedora"}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, created_by)
values ('a1111111-aaaa-4111-8111-111111111111', 'Moritas Bebés', 'moritas-receipts-test', 'a1111111-1111-4111-8111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';

select public.add_organization_member_by_email('a1111111-aaaa-4111-8111-111111111111', 'receipt-staff@local.test', 'staff');
select public.add_organization_member_by_email('a1111111-aaaa-4111-8111-111111111111', 'receipt-other@local.test', 'staff');

insert into public.products (id, organization_id, name, sku, cost_price, retail_price, min_stock)
values ('a4444444-4444-4444-8444-444444444444', 'a1111111-aaaa-4111-8111-111111111111', 'Pampers Premium Care XXG', 'PAMP-XXG', 10000, 18500, 1);

select public.adjust_inventory(
  'a1111111-aaaa-4111-8111-111111111111',
  'a4444444-4444-4444-8444-444444444444',
  20,
  'Stock para prueba de comprobantes',
  10000,
  'a5555555-5555-4555-8555-555555555555'
);

create temporary table receipt_test_state (sale_id uuid) on commit drop;
grant select, update on receipt_test_state to authenticated;
insert into receipt_test_state default values;

set local request.jwt.claims = '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  cash_id uuid;
  created_sale uuid;
  receipt jsonb;
begin
  select id into cash_id
  from public.payment_methods
  where organization_id = 'a1111111-aaaa-4111-8111-111111111111'
    and code = 'cash';

  created_sale := public.create_sale(
    'a1111111-aaaa-4111-8111-111111111111',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'a4444444-4444-4444-8444-444444444444',
      'quantity', 10
    )),
    cash_id,
    null,
    10000
  );
  update receipt_test_state set sale_id = created_sale;

  receipt := public.get_sale_receipt(created_sale);
  if receipt ->> 'display_number' is null then raise exception 'Receipt has no visible sale number'; end if;
  if receipt #>> '{items,0,name}' <> 'Pampers Premium Care XXG' then raise exception 'Receipt did not capture the product name'; end if;
  if (receipt #>> '{items,0,quantity}')::numeric <> 10 then raise exception 'Receipt quantity differs from the sale'; end if;
  if (receipt #>> '{items,0,unit_price}')::numeric <> 18500 then raise exception 'Receipt price differs from the historical sale price'; end if;
  if (receipt #>> '{items,0,line_total}')::numeric <> 185000 then raise exception 'Receipt line total differs from the sale'; end if;
  if (receipt ->> 'discount')::numeric <> 10000 or (receipt ->> 'total')::numeric <> 175000 then
    raise exception 'Receipt totals differ from the sale';
  end if;
  if receipt #> '{items,0,unit_cost}' is not null then raise exception 'Receipt leaked product cost'; end if;
  if receipt ? 'sale_id' then raise exception 'Receipt leaked the internal sale id'; end if;
end;
$$;

set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';

update public.products
set name = 'Pampers Premium Care XXG - nombre nuevo',
    sku = 'PAMP-XXG-NUEVO',
    retail_price = 22000
where id = 'a4444444-4444-4444-8444-444444444444';

do $$
declare
  receipt jsonb;
begin
  receipt := public.get_sale_receipt((select sale_id from receipt_test_state));
  if receipt #>> '{items,0,name}' <> 'Pampers Premium Care XXG' then raise exception 'Catalog rename changed the historical receipt'; end if;
  if receipt #>> '{items,0,sku}' <> 'PAMP-XXG' then raise exception 'Catalog SKU change changed the historical receipt'; end if;
  if (receipt #>> '{items,0,unit_price}')::numeric <> 18500 then raise exception 'Catalog price change changed the historical receipt'; end if;
end;
$$;

set local request.jwt.claims = '{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
begin
  begin
    perform public.get_sale_receipt((select sale_id from receipt_test_state));
    raise exception 'A different staff member read another seller receipt';
  exception when no_data_found then null;
  end;
end;
$$;

rollback;
