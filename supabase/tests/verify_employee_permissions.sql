begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('81111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'security-owner@local.test', '{}'::jsonb, '{"display_name":"Admin Seguridad"}'::jsonb, now(), now()),
  ('82222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'security-staff@local.test', '{}'::jsonb, '{"display_name":"Empleado Seguridad"}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, created_by)
values ('81111111-aaaa-4111-8111-111111111111', 'Security Test', 'security-test', '81111111-1111-4111-8111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}';

select public.add_organization_member_by_email(
  '81111111-aaaa-4111-8111-111111111111',
  'security-staff@local.test',
  'staff'
);

insert into public.products (id, organization_id, name, sku, cost_price, retail_price, min_stock)
values ('83333333-3333-4333-8333-333333333333', '81111111-aaaa-4111-8111-111111111111', 'Producto protegido', 'SEC-001', 400, 1000, 1);

select public.adjust_inventory(
  '81111111-aaaa-4111-8111-111111111111',
  '83333333-3333-4333-8333-333333333333',
  5,
  'Stock inicial de prueba',
  400,
  '84444444-4444-4444-8444-444444444444'
);

insert into public.expenses (id, organization_id, description, amount, expense_date, created_by)
values (
  '85555555-5555-4555-8555-555555555555',
  '81111111-aaaa-4111-8111-111111111111',
  'Gasto del dueño visible para el equipo',
  500,
  current_date,
  '81111111-1111-4111-8111-111111111111'
);

create temporary table security_state (
  payment_method_id uuid,
  sale_id uuid,
  expense_id uuid
) on commit drop;

insert into security_state (payment_method_id)
select id from public.payment_methods
where organization_id = '81111111-aaaa-4111-8111-111111111111' and code = 'cash';
grant select, update on security_state to authenticated;

set local request.jwt.claims = '{"sub":"82222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  target_payment_method uuid;
  created_sale uuid;
  created_expense uuid;
  captured_total numeric;
  captured_stock numeric;
  captured_date timestamptz;
  captured_creator uuid;
  expense_day date;
  created_order uuid;
begin
  select payment_method_id into target_payment_method from security_state;

  if (select count(*) from public.products where organization_id = '81111111-aaaa-4111-8111-111111111111') <> 1 then
    raise exception 'Staff could not read the catalog required for product maintenance';
  end if;

  if (select count(*) from public.list_operational_products('81111111-aaaa-4111-8111-111111111111')) <> 1 then
    raise exception 'Staff could not read the safe operational catalog';
  end if;

  update public.products set retail_price = 1200
  where id = '83333333-3333-4333-8333-333333333333';
  if not found then raise exception 'Staff could not update a product'; end if;

  begin
    update public.products set current_stock = 50
    where id = '83333333-3333-4333-8333-333333333333';
    raise exception 'Staff bypassed the inventory movement workflow';
  exception when insufficient_privilege then null;
  end;

  insert into public.categories (id, organization_id, name, slug)
  values ('86666666-6666-4666-8666-666666666666', '81111111-aaaa-4111-8111-111111111111', 'Categoría operativa', 'categoria-operativa');

  insert into public.brands (id, organization_id, name)
  values ('87777777-7777-4777-8777-777777777777', '81111111-aaaa-4111-8111-111111111111', 'Marca operativa');

  insert into public.suppliers (id, organization_id, business_name)
  values ('88888888-8888-4888-8888-888888888888', '81111111-aaaa-4111-8111-111111111111', 'Proveedor operativo');

  insert into public.products (
    id, organization_id, name, sku, category_id, brand_id,
    default_supplier_id, cost_price, retail_price, min_stock
  )
  values (
    '89999999-9999-4999-8999-999999999999',
    '81111111-aaaa-4111-8111-111111111111',
    'Producto cargado por empleado',
    'SEC-STAFF-001',
    '86666666-6666-4666-8666-666666666666',
    '87777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',
    300,
    800,
    1
  );

  perform public.adjust_inventory(
    '81111111-aaaa-4111-8111-111111111111',
    '83333333-3333-4333-8333-333333333333',
    2,
    'Ajuste operativo documentado',
    400,
    '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if (select current_stock from public.products where id = '83333333-3333-4333-8333-333333333333') <> 7 then
    raise exception 'Staff inventory adjustment did not update stock';
  end if;

  created_order := public.create_purchase_order(
    '81111111-aaaa-4111-8111-111111111111',
    '88888888-8888-4888-8888-888888888888',
    jsonb_build_array(jsonb_build_object(
      'product_id', '83333333-3333-4333-8333-333333333333',
      'quantity_ordered', 2,
      'unit_cost', 450
    )),
    'ORDEN-STAFF'
  );

  begin
    update public.purchase_orders set status = 'cancelled' where id = created_order;
    raise exception 'Staff cancelled a purchase order';
  exception when insufficient_privilege or check_violation then null;
  end;

  update public.purchase_orders set status = 'sent' where id = created_order;
  perform public.receive_purchase_order(
    created_order,
    (
      select jsonb_build_array(jsonb_build_object(
        'purchase_order_item_id', item.id,
        'quantity', 1,
        'unit_cost', 450
      ))
      from public.purchase_order_items as item
      where item.purchase_order_id = created_order
    ),
    'Recepción operativa',
    '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );

  if (select current_stock from public.products where id = '83333333-3333-4333-8333-333333333333') <> 8 then
    raise exception 'Staff purchase receipt did not update stock';
  end if;

  delete from public.products where id = '89999999-9999-4999-8999-999999999999';
  if found then raise exception 'Staff deleted a product'; end if;
  delete from public.suppliers where id = '88888888-8888-4888-8888-888888888888';
  if found then raise exception 'Staff deleted a supplier'; end if;
  delete from public.categories where id = '86666666-6666-4666-8666-666666666666';
  if found then raise exception 'Staff deleted a category'; end if;

  begin
    insert into public.sales (organization_id, payment_method_id, occurred_at, created_by)
    values ('81111111-aaaa-4111-8111-111111111111', target_payment_method, '2020-01-01', '81111111-1111-4111-8111-111111111111');
    raise exception 'Staff bypassed the sale RPC';
  exception when insufficient_privilege then null;
  end;

  created_sale := public.create_sale_with_payments(
    '81111111-aaaa-4111-8111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id', '83333333-3333-4333-8333-333333333333', 'quantity', 2, 'unit_price', 1)),
    jsonb_build_array(jsonb_build_object('payment_method_id', target_payment_method, 'amount', 2400)),
    null,
    0,
    'Venta segura',
    null,
    '2020-01-01'
  );
  update security_state set sale_id = created_sale;

  select total, occurred_at, created_by into captured_total, captured_date, captured_creator
  from public.sales where id = created_sale;
  if captured_total <> 2400 then raise exception 'Sale did not use the updated historical product price'; end if;
  if captured_date < now() - interval '1 minute' then raise exception 'Staff backdated a sale'; end if;
  if captured_creator <> '82222222-2222-4222-8222-222222222222' then raise exception 'Staff spoofed sale created_by'; end if;

  if (select count(*) from public.sale_items where sale_id = created_sale) <> 0 then
    raise exception 'Staff read captured sale costs';
  end if;

  select current_stock into captured_stock
  from public.list_operational_products('81111111-aaaa-4111-8111-111111111111')
  where id = '83333333-3333-4333-8333-333333333333';
  if captured_stock <> 6 then raise exception 'Secure sale did not decrement stock'; end if;

  begin
    perform public.create_sale_with_payments(
      '81111111-aaaa-4111-8111-111111111111',
      jsonb_build_array(jsonb_build_object('product_id', '83333333-3333-4333-8333-333333333333', 'quantity', 7)),
      jsonb_build_array(jsonb_build_object('payment_method_id', target_payment_method, 'amount', 8400))
    );
    raise exception 'Overselling unexpectedly succeeded';
  exception when check_violation then null;
  end;

  perform public.cancel_sale(created_sale, 'Correccion operativa de la venta');
  if not exists (
    select 1 from public.sales
    where id = created_sale
      and status = 'cancelled'
      and cancelled_by = '82222222-2222-4222-8222-222222222222'
  ) then raise exception 'Staff could not cancel their own sale with audit data'; end if;

  insert into public.expenses (organization_id, description, amount, expense_date, created_by)
  values ('81111111-aaaa-4111-8111-111111111111', 'Gasto empleado', 250, '2020-01-01', '81111111-1111-4111-8111-111111111111')
  returning id, expense_date, created_by into created_expense, expense_day, captured_creator;
  update security_state set expense_id = created_expense;
  if expense_day <> current_date then raise exception 'Staff backdated an expense'; end if;
  if captured_creator <> '82222222-2222-4222-8222-222222222222' then raise exception 'Staff spoofed expense created_by'; end if;

  if (select count(*) from public.expenses where organization_id = '81111111-aaaa-4111-8111-111111111111') <> 2 then
    raise exception 'Staff could not read organization expenses';
  end if;

  update public.expenses set amount = 1 where id = created_expense;
  if found then raise exception 'Staff modified a posted expense'; end if;

  begin
    delete from public.expenses where id = created_expense;
    raise exception 'Staff deleted an expense';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.organization_members set role = 'owner'
    where organization_id = '81111111-aaaa-4111-8111-111111111111'
      and user_id = '82222222-2222-4222-8222-222222222222';
    raise exception 'Staff changed its own role';
  exception when insufficient_privilege then null;
  end;

  if (select count(*) from public.audit_logs) <> 0 then
    raise exception 'Staff read audit history';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  target_expense uuid;
  target_staff uuid := '82222222-2222-4222-8222-222222222222';
begin
  select expense_id into target_expense from security_state;
  perform public.cancel_expense(target_expense, 'Correccion administrativa');
  if not exists (select 1 from public.expenses where id = target_expense and status = 'cancelled' and cancelled_by = '81111111-1111-4111-8111-111111111111') then
    raise exception 'Administrative expense cancellation was not traceable';
  end if;

  perform public.update_organization_member('81111111-aaaa-4111-8111-111111111111', target_staff, 'staff', false);
end;
$$;

set local request.jwt.claims = '{"sub":"82222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    perform 1 from public.list_operational_products('81111111-aaaa-4111-8111-111111111111');
    raise exception 'Inactive staff retained operational access';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
