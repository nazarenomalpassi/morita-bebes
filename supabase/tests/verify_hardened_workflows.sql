begin;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'workflow-owner@local.test',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'authenticated',
    'authenticated',
    'workflow-staff@local.test',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

do $$
declare
  bootstrap_already_used boolean := exists (
    select 1 from private.organization_bootstrap_guard
  );
begin
  if bootstrap_already_used then
    execute 'alter table public.organizations disable trigger guard_organization_bootstrap';
  end if;

  insert into public.organizations (id, name, slug, created_by)
  values (
    '22222222-aaaa-4222-8222-222222222222',
    'Morita Workflow Test',
    'morita-workflow-test',
    '22222222-2222-4222-8222-222222222222'
  );

  if bootstrap_already_used then
    execute 'alter table public.organizations enable trigger guard_organization_bootstrap';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  test_org_id uuid := '22222222-aaaa-4222-8222-222222222222';
  test_category_id uuid;
  test_product_id uuid;
  test_supplier_id uuid;
  test_payment_method_id uuid;
  test_sale_id uuid;
  test_staff_sale_id uuid;
  test_order_id uuid;
  test_order_item_id uuid;
  first_receipt_id constant uuid := '44444444-4444-4444-8444-444444444444';
  second_receipt_id constant uuid := '55555555-5555-4555-8555-555555555555';
  resulting_stock numeric(14, 3);
  resulting_status public.purchase_order_status;
  audit_count integer;
  expense_creator uuid;
  captured_unit_cost numeric(14, 2);
  captured_unit_price numeric(14, 2);
  captured_sale_total numeric(14, 2);
  member_count integer;
  suggested_quantity numeric(14, 3);
  test_import_batch_id uuid;
  resulting_import_status public.import_batch_status;
  resulting_issue_count integer;
begin
  if public.can_bootstrap_organization() then
    raise exception 'Organization bootstrap remained open after first creation';
  end if;

  begin
    insert into public.organizations (name, slug, created_by)
    values (
      'Second Organization',
      'second-organization',
      '22222222-2222-4222-8222-222222222222'
    );
    raise exception 'Second organization bootstrap unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  if public.add_organization_member_by_email(
    test_org_id,
    'WORKFLOW-STAFF@LOCAL.TEST',
    'staff'
  ) <> '33333333-3333-4333-8333-333333333333' then
    raise exception 'Member lookup by normalized email returned the wrong user';
  end if;

  begin
    perform public.update_organization_member(
      test_org_id,
      '22222222-2222-4222-8222-222222222222',
      'admin',
      true
    );
    raise exception 'Last owner downgrade unexpectedly succeeded';
  exception
    when check_violation then null;
  end;

  perform public.update_organization_member(
    test_org_id,
    '33333333-3333-4333-8333-333333333333',
    'admin',
    true
  );
  if not exists (
    select 1
    from public.list_organization_members(test_org_id) as member
    where member.user_id = '33333333-3333-4333-8333-333333333333'
      and member.role = 'admin'
  ) then
    raise exception 'Member role update was not visible in the secure listing';
  end if;
  perform public.update_organization_member(
    test_org_id,
    '33333333-3333-4333-8333-333333333333',
    'staff',
    true
  );

  select count(*) into member_count
  from public.list_organization_members(test_org_id);
  if member_count <> 2 then
    raise exception 'Owner expected two listed members, found %', member_count;
  end if;

  select category.id into test_category_id
  from public.categories as category
  where category.organization_id = test_org_id
    and slug = 'panales';

  select payment_method.id into test_payment_method_id
  from public.payment_methods as payment_method
  where payment_method.organization_id = test_org_id
    and code = 'cash';

  insert into public.products (
    organization_id,
    category_id,
    name,
    sku,
    cost_price,
    retail_price,
    min_stock,
    target_stock
  )
  values (
    test_org_id,
    test_category_id,
    'Producto de flujo',
    'FLOW-001',
    500,
    1000,
    2,
    20
  )
  returning id into test_product_id;

  perform public.adjust_inventory(
    test_org_id,
    test_product_id,
    10,
    'Carga inicial validada',
    500,
    '66666666-6666-4666-8666-666666666666'
  );

  select current_stock into resulting_stock from public.products where id = test_product_id;
  if resulting_stock <> 10 then
    raise exception 'Initial adjustment expected stock 10, found %', resulting_stock;
  end if;

  select target_stock - current_stock
  into suggested_quantity
  from public.products
  where id = test_product_id;
  if suggested_quantity <> 10 then
    raise exception 'Suggested purchase quantity expected 10, found %', suggested_quantity;
  end if;

  begin
    update public.products set current_stock = 999 where id = test_product_id;
    raise exception 'Direct current_stock update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  test_sale_id := public.create_sale(
    test_org_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', test_product_id,
      'quantity', 3,
      'unit_price', 1,
      'discount', 50
    )),
    test_payment_method_id,
    null,
    100,
    'Venta de prueba',
    'FLOW-SALE-001'
  );

  select current_stock into resulting_stock from public.products where id = test_product_id;
  if resulting_stock <> 7 then
    raise exception 'Completed sale expected stock 7, found %', resulting_stock;
  end if;

  select unit_cost, unit_price
  into captured_unit_cost, captured_unit_price
  from public.sale_items
  where sale_items.sale_id = test_sale_id;
  if captured_unit_cost <> 500 then
    raise exception 'Sale item expected captured unit cost 500, found %', captured_unit_cost;
  end if;

  if captured_unit_price <> 1000 then
    raise exception 'Sale item accepted client price instead of catalog price: %', captured_unit_price;
  end if;

  select total into captured_sale_total
  from public.sales
  where id = test_sale_id;
  if captured_sale_total <> 2850 then
    raise exception 'Sale discounts expected final total 2850, found %', captured_sale_total;
  end if;

  perform public.cancel_sale(test_sale_id, 'Anulacion de prueba');
  select current_stock into resulting_stock from public.products where id = test_product_id;
  if resulting_stock <> 10 then
    raise exception 'Cancelled sale expected stock 10, found %', resulting_stock;
  end if;

  insert into public.suppliers (organization_id, business_name)
  values (test_org_id, 'Proveedor de prueba')
  returning id into test_supplier_id;

  test_order_id := public.create_purchase_order(
    test_org_id,
    test_supplier_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', test_product_id,
      'quantity_ordered', 10,
      'unit_cost', 450
    )),
    'FLOW-PO-001',
    current_date,
    current_date + 7,
    'Pedido transaccional de prueba'
  );

  select id into test_order_item_id
  from public.purchase_order_items
  where purchase_order_id = test_order_id
    and product_id = test_product_id;

  if (
    select estimated_total
    from public.purchase_orders
    where id = test_order_id
  ) <> 4500 then
    raise exception 'Purchase order total was not calculated';
  end if;

  update public.purchase_orders set status = 'sent' where id = test_order_id;

  perform public.receive_purchase_order(
    test_order_id,
    jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id', test_order_item_id,
      'quantity', 4,
      'unit_cost', 440
    )),
    'Primera entrega',
    first_receipt_id
  );

  select current_stock into resulting_stock from public.products where id = test_product_id;
  select status into resulting_status from public.purchase_orders where id = test_order_id;
  if resulting_stock <> 14 or resulting_status <> 'partial' then
    raise exception 'Partial receipt expected stock 14/status partial, found %/%', resulting_stock, resulting_status;
  end if;

  perform public.receive_purchase_order(
    test_order_id,
    jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id', test_order_item_id,
      'quantity', 6,
      'unit_cost', 430
    )),
    'Entrega final',
    second_receipt_id
  );

  select current_stock into resulting_stock from public.products where id = test_product_id;
  select status into resulting_status from public.purchase_orders where id = test_order_id;
  if resulting_stock <> 20 or resulting_status <> 'received' then
    raise exception 'Final receipt expected stock 20/status received, found %/%', resulting_stock, resulting_status;
  end if;

  -- Same receipt id and payload is idempotent.
  perform public.receive_purchase_order(
    test_order_id,
    jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id', test_order_item_id,
      'quantity', 6,
      'unit_cost', 430
    )),
    'Entrega final',
    second_receipt_id
  );
  select current_stock into resulting_stock from public.products where id = test_product_id;
  if resulting_stock <> 20 then
    raise exception 'Idempotent receipt changed stock to %', resulting_stock;
  end if;

  begin
    perform public.create_sale(
      test_org_id,
      jsonb_build_array(jsonb_build_object(
        'product_id', test_product_id,
        'quantity', 21,
        'unit_price', 1000
      )),
      test_payment_method_id
    );
    raise exception 'Sale with insufficient stock unexpectedly succeeded';
  exception
    when check_violation then null;
  end;

  begin
    perform public.create_sale(
      test_org_id,
      jsonb_build_array(jsonb_build_object(
        'product_id', test_product_id,
        'quantity', 1,
        'unit_price', 999999,
        'discount', 1001
      )),
      test_payment_method_id
    );
    raise exception 'Line discount above catalog line total unexpectedly succeeded';
  exception
    when check_violation then null;
  end;

  begin
    perform public.create_sale(
      test_org_id,
      jsonb_build_array(jsonb_build_object(
        'product_id', test_product_id,
        'quantity', 1,
        'unit_price', 1,
        'discount', 0
      )),
      test_payment_method_id,
      null,
      1001
    );
    raise exception 'Sale-level discount above subtotal unexpectedly succeeded';
  exception
    when check_violation then null;
  end;

  insert into public.import_batches (
    organization_id,
    filename,
    file_hash,
    total_rows,
    created_by
  )
  values (
    test_org_id,
    'inventario.xlsx',
    repeat('a', 64),
    2,
    '33333333-3333-4333-8333-333333333333'
  )
  returning id into test_import_batch_id;

  insert into public.import_issues (
    batch_id,
    organization_id,
    row_number,
    sku,
    field,
    severity,
    message,
    raw_data
  )
  values (
    test_import_batch_id,
    test_org_id,
    2,
    'FLOW-002',
    'supplier',
    'warning',
    'Proveedor pendiente de completar',
    '{"supplier":null}'::jsonb
  );

  perform public.finalize_import_batch(
    test_import_batch_id,
    1,
    '{"source":"legacy"}'::jsonb,
    false
  );

  select status, issue_count
  into resulting_import_status, resulting_issue_count
  from public.import_batches
  where id = test_import_batch_id;
  if resulting_import_status <> 'completed_with_issues' or resulting_issue_count <> 1 then
    raise exception 'Import batch finalization expected completed_with_issues/1, found %/%',
      resulting_import_status,
      resulting_issue_count;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',
    true
  );

  begin
    insert into public.brands (organization_id, name)
    values (test_org_id, 'Marca no autorizada');
    raise exception 'Staff master-data insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.adjust_inventory(
      test_org_id,
      test_product_id,
      1,
      'Ajuste no autorizado'
    );
    raise exception 'Staff inventory adjustment unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  if exists (
    select 1
    from public.purchase_orders
    where id = test_order_id
  ) then
    raise exception 'Staff unexpectedly read purchase order financial data';
  end if;

  begin
    perform public.create_purchase_order(
      test_org_id,
      test_supplier_id,
      jsonb_build_array(jsonb_build_object(
        'product_id', test_product_id,
        'quantity_ordered', 1,
        'unit_cost', 450
      ))
    );
    raise exception 'Staff purchase order creation unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.receive_purchase_order(
      test_order_id,
      jsonb_build_array(jsonb_build_object(
        'purchase_order_item_id', test_order_item_id,
        'quantity', 1,
        'unit_cost', 430
      ))
    );
    raise exception 'Staff purchase order receipt unexpectedly succeeded';
  exception
    when insufficient_privilege or no_data_found then null;
  end;

  begin
    perform 1 from public.list_organization_members(test_org_id);
    raise exception 'Staff member listing unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  if (
    select count(*)
    from public.import_batches
    where organization_id = test_org_id
  ) <> 0 then
    raise exception 'Staff unexpectedly read import batches';
  end if;

  begin
    insert into public.import_batches (
      organization_id, filename, file_hash, total_rows, created_by
    )
    values (
      test_org_id,
      'staff-import.xlsx',
      repeat('b', 64),
      1,
      '33333333-3333-4333-8333-333333333333'
    );
    raise exception 'Staff import batch creation unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  test_staff_sale_id := public.create_sale(
    test_org_id,
    jsonb_build_array(jsonb_build_object(
      'product_id', test_product_id,
      'quantity', 1,
      'unit_price', 1000
    )),
    test_payment_method_id,
    null,
    0,
    'Venta del empleado',
    'FLOW-SALE-STAFF'
  );

  select current_stock into resulting_stock
  from public.list_operational_products(test_org_id)
  where id = test_product_id;
  if resulting_stock <> 19 then
    raise exception 'Staff sale expected stock 19, found %', resulting_stock;
  end if;

  begin
    perform public.cancel_sale(test_staff_sale_id, 'Intento no autorizado');
    raise exception 'Staff sale cancellation unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  insert into public.expenses (
    organization_id,
    description,
    amount,
    created_by
  )
  values (
    test_org_id,
    'Gasto creado por empleado',
    100,
    '22222222-2222-4222-8222-222222222222'
  )
  returning created_by into expense_creator;

  if expense_creator <> '33333333-3333-4333-8333-333333333333' then
    raise exception 'created_by was not replaced with auth.uid()';
  end if;

  if (
    select count(*)
    from public.audit_logs as audit_log
    where audit_log.organization_id = test_org_id
  ) <> 0 then
    raise exception 'Staff unexpectedly read audit logs';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
    true
  );

  select count(*) into audit_count
  from public.audit_logs
  where audit_logs.organization_id = test_org_id;

  if audit_count < 10 then
    raise exception 'Expected automatic audit rows, found %', audit_count;
  end if;
end;
$$;

rollback;
