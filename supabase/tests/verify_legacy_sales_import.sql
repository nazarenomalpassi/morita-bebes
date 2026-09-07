begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  '91111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'legacy-owner@local.test',
  '{}'::jsonb,
  '{"display_name":"Dueño Importación"}'::jsonb,
  now(),
  now()
);

insert into public.organizations (id, name, slug, created_by)
values (
  '91111111-aaaa-4111-8111-111111111111',
  'Legacy Sales Test',
  'legacy-sales-test',
  '91111111-1111-4111-8111-111111111111'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.products (
  id, organization_id, name, sku, cost_price, retail_price, min_stock
)
values (
  '93333333-3333-4333-8333-333333333333',
  '91111111-aaaa-4111-8111-111111111111',
  'Producto de control',
  'LEG-CONTROL',
  50,
  100,
  0
);

select public.adjust_inventory(
  '91111111-aaaa-4111-8111-111111111111',
  '93333333-3333-4333-8333-333333333333',
  10,
  'Stock de control previo a importación',
  50,
  '94444444-4444-4444-8444-444444444444'
);

reset role;

create temporary table legacy_import_test_state (
  batch_id uuid,
  stock_before numeric,
  movements_before bigint,
  normal_sale_id uuid
) on commit drop;
grant select, update on legacy_import_test_state to authenticated;

insert into legacy_import_test_state (stock_before, movements_before)
select
  product.current_stock,
  (select count(*) from public.inventory_movements where organization_id = product.organization_id)
from public.products as product
where product.id = '93333333-3333-4333-8333-333333333333';

do $$
declare
  import_result jsonb;
  rerun_result jsonb;
  imported_batch_id uuid;
  baseline_stock numeric;
  baseline_movements bigint;
begin
  import_result := private.import_legacy_sales_batch(
    '91111111-aaaa-4111-8111-111111111111',
    'legacy_pos',
    'Libro ventas test.xlsx',
    repeat('a', 64),
    2,
    jsonb_build_array(
      jsonb_build_object(
        'source_row', 2,
        'legacy_sale_number', '856',
        'occurred_at', '2026-08-05T09:43:47-03:00',
        'document_type', 'REMITO X',
        'point_of_sale', '0',
        'customer_name', 'CONSUMIDOR FINAL',
        'customer_tax_id', '1111111',
        'payment_method', 'CONTADO',
        'subtotal', 100,
        'vat_10_5', 0,
        'vat_21', 21,
        'discount', 0,
        'total', 121,
        'original_time_known', true,
        'raw_data', jsonb_build_object('Numero Interno', '856')
      ),
      jsonb_build_object(
        'source_row', 3,
        'legacy_sale_number', '855',
        'occurred_at', '2026-08-04T19:54:51-03:00',
        'document_type', 'REMITO X',
        'point_of_sale', '0',
        'customer_name', 'CONSUMIDOR FINAL',
        'customer_tax_id', '1111111',
        'payment_method', 'TARJETA DE CREDITO',
        'subtotal', 82.65,
        'vat_10_5', 0,
        'vat_21', 17.36,
        'discount', 0,
        'total', 100,
        'original_time_known', true,
        'raw_data', jsonb_build_object('Numero Interno', '855')
      )
    ),
    jsonb_build_array(
      jsonb_build_object(
        'severity', 'warning',
        'source_row', 2,
        'legacy_sale_number', '856',
        'code', 'missing_item_detail',
        'message', 'Sin detalle de productos',
        'raw_data', '{}'::jsonb
      ),
      jsonb_build_object(
        'severity', 'warning',
        'source_row', 3,
        'legacy_sale_number', '855',
        'code', 'unmapped_payment_method',
        'message', 'Medio preservado sin vínculo',
        'raw_data', '{}'::jsonb
      )
    ),
    true
  );

  imported_batch_id := (import_result ->> 'batch_id')::uuid;
  update legacy_import_test_state set batch_id = imported_batch_id;
  select stock_before, movements_before
  into baseline_stock, baseline_movements
  from legacy_import_test_state;

  if (import_result ->> 'inserted_this_call')::integer <> 2 then
    raise exception 'Legacy importer did not insert the expected sales';
  end if;

  if (select current_stock from public.products where id = '93333333-3333-4333-8333-333333333333') <> baseline_stock then
    raise exception 'Legacy import changed current stock';
  end if;

  if (select count(*) from public.inventory_movements where organization_id = '91111111-aaaa-4111-8111-111111111111') <> baseline_movements then
    raise exception 'Legacy import created inventory movements';
  end if;

  if (select count(*) from public.sales where import_batch_id = imported_batch_id) <> 2 then
    raise exception 'Legacy import batch does not contain two sales';
  end if;

  if (select sum(total) from public.sales where import_batch_id = imported_batch_id) <> 221 then
    raise exception 'Historical totals were not preserved';
  end if;

  if not exists (
    select 1
    from public.sales
    where import_batch_id = imported_batch_id
      and legacy_sale_number = '855'
      and payment_method_id is null
      and legacy_payment_method = 'TARJETA DE CREDITO'
      and rounding_adjustment = -0.01
      and created_by is null
      and item_detail_status = 'missing_from_source'
  ) then
    raise exception 'Unmapped historical values or rounding were not preserved';
  end if;

  rerun_result := private.import_legacy_sales_batch(
    '91111111-aaaa-4111-8111-111111111111',
    'legacy_pos',
    'Libro ventas test.xlsx',
    repeat('a', 64),
    2,
    jsonb_build_array(
      jsonb_build_object('source_row', 2, 'legacy_sale_number', '856', 'occurred_at', '2026-08-05T09:43:47-03:00', 'subtotal', 100, 'vat_10_5', 0, 'vat_21', 21, 'discount', 0, 'total', 121),
      jsonb_build_object('source_row', 3, 'legacy_sale_number', '855', 'occurred_at', '2026-08-04T19:54:51-03:00', 'subtotal', 82.65, 'vat_10_5', 0, 'vat_21', 17.36, 'discount', 0, 'total', 100)
    ),
    '[]'::jsonb,
    true
  );

  if (rerun_result ->> 'inserted_this_call')::integer <> 0
    or (rerun_result ->> 'duplicates_this_call')::integer <> 2 then
    raise exception 'Legacy importer is not idempotent';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  cash_id uuid;
  sale_id uuid;
  stock_before numeric;
begin
  select id into cash_id
  from public.payment_methods
  where organization_id = '91111111-aaaa-4111-8111-111111111111'
    and code = 'cash';
  select current_stock into stock_before
  from public.products
  where id = '93333333-3333-4333-8333-333333333333';

  sale_id := public.create_sale(
    '91111111-aaaa-4111-8111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id', '93333333-3333-4333-8333-333333333333', 'quantity', 2)),
    cash_id
  );
  update legacy_import_test_state set normal_sale_id = sale_id;

  if (select current_stock from public.products where id = '93333333-3333-4333-8333-333333333333') <> stock_before - 2 then
    raise exception 'Normal sales stopped decrementing stock';
  end if;

  if (select count(*) from public.list_operational_sales(
    '91111111-aaaa-4111-8111-111111111111', null, null, null,
    'legacy_import', '856', 100, 0
  )) <> 1 then
    raise exception 'Imported sale is not visible through operational history filters';
  end if;
end;
$$;

reset role;

do $$
declare
  target_batch uuid;
  stock_before_rollback numeric;
  result jsonb;
begin
  select batch_id into target_batch from legacy_import_test_state;
  select current_stock into stock_before_rollback
  from public.products
  where id = '93333333-3333-4333-8333-333333333333';

  result := private.rollback_legacy_sale_import(target_batch);
  if (result ->> 'removed_sales')::integer <> 2 then
    raise exception 'Rollback did not remove the imported sales';
  end if;
  if exists (select 1 from public.sales where import_batch_id = target_batch) then
    raise exception 'Rollback left imported sales behind';
  end if;
  if (select current_stock from public.products where id = '93333333-3333-4333-8333-333333333333') <> stock_before_rollback then
    raise exception 'Rollback changed current stock';
  end if;
end;
$$;

rollback;
