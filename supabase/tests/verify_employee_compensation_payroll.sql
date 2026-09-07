begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('b1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'payroll-owner@local.test', '{}'::jsonb, '{"display_name":"Admin Sueldos"}'::jsonb, now(), now()),
  ('b2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'payroll-staff@local.test', '{}'::jsonb, '{"display_name":"Empleado Sueldos"}'::jsonb, now(), now()),
  ('b3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'payroll-other@local.test', '{}'::jsonb, '{"display_name":"Otro Empleado"}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, created_by)
values ('b1111111-aaaa-4111-8111-111111111111', 'Payroll Test', 'payroll-test', 'b1111111-1111-4111-8111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';

select public.add_organization_member_by_email(
  'b1111111-aaaa-4111-8111-111111111111',
  'payroll-staff@local.test',
  'staff'
);
select public.add_organization_member_by_email(
  'b1111111-aaaa-4111-8111-111111111111',
  'payroll-other@local.test',
  'staff'
);

insert into public.employees (
  id, organization_id, user_id, first_name, last_name, email, base_salary
)
values
  ('b4444444-4444-4444-8444-444444444444', 'b1111111-aaaa-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'Ana', 'Comisión', 'payroll-staff@local.test', 700000),
  ('b5555555-5555-4555-8555-555555555555', 'b1111111-aaaa-4111-8111-111111111111', 'b3333333-3333-4333-8333-333333333333', 'Beto', 'Sin Ventas', 'payroll-other@local.test', 700000);

select public.set_employee_compensation(
  'b1111111-aaaa-4111-8111-111111111111',
  'b4444444-4444-4444-8444-444444444444',
  700000,
  1,
  '2026-01-01',
  'Condición inicial'
);
select public.set_employee_compensation(
  'b1111111-aaaa-4111-8111-111111111111',
  'b5555555-5555-4555-8555-555555555555',
  700000,
  1,
  '2026-01-01',
  'Condición inicial'
);

set local request.jwt.claims = '{}';
reset role;

insert into public.sales (
  id, organization_id, status, occurred_at, subtotal, discount, total, created_by
)
values
  ('b6111111-1111-4111-8111-111111111111', 'b1111111-aaaa-4111-8111-111111111111', 'completed', '2026-01-10T12:00:00-03:00', 100000, 0, 100000, 'b1111111-1111-4111-8111-111111111111'),
  ('b6222222-2222-4222-8222-222222222222', 'b1111111-aaaa-4111-8111-111111111111', 'completed', '2026-02-10T12:00:00-03:00', 10000000, 0, 10000000, 'b1111111-1111-4111-8111-111111111111'),
  ('b6333333-3333-4333-8333-333333333333', 'b1111111-aaaa-4111-8111-111111111111', 'completed', '2026-03-10T12:00:00-03:00', 25450300, 0, 25450300, 'b1111111-1111-4111-8111-111111111111'),
  ('b6444444-4444-4444-8444-444444444444', 'b1111111-aaaa-4111-8111-111111111111', 'completed', '2026-04-10T12:00:00-03:00', 100000, 0, 100000, 'b1111111-1111-4111-8111-111111111111'),
  ('b6555555-5555-4555-8555-555555555555', 'b1111111-aaaa-4111-8111-111111111111', 'completed', '2026-04-11T12:00:00-03:00', 1000000, 0, 1000000, 'b1111111-1111-4111-8111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  report jsonb;
  employee_data jsonb;
  created_settlement_id uuid;
begin
  report := public.get_payroll_dashboard(
    'b1111111-aaaa-4111-8111-111111111111', '2026-01-01', 'b4444444-4444-4444-8444-444444444444'
  );
  employee_data := report #> '{employees,0}';
  if (employee_data ->> 'grossSales')::numeric <> 100000 then raise exception 'Case 2 gross sales are wrong'; end if;
  if (employee_data ->> 'commissionAmount')::numeric <> 1000 then raise exception 'Case 2 commission is wrong'; end if;
  if (employee_data ->> 'estimatedSalary')::numeric <> 701000 then raise exception 'Case 2 salary is wrong'; end if;

  report := public.get_payroll_dashboard(
    'b1111111-aaaa-4111-8111-111111111111', '2026-02-01', 'b4444444-4444-4444-8444-444444444444'
  );
  employee_data := report #> '{employees,0}';
  if (employee_data ->> 'commissionAmount')::numeric <> 100000 then raise exception 'Case 3 commission is wrong'; end if;
  if (employee_data ->> 'estimatedSalary')::numeric <> 800000 then raise exception 'Case 3 salary is wrong'; end if;

  report := public.get_payroll_dashboard(
    'b1111111-aaaa-4111-8111-111111111111', '2026-03-01', 'b4444444-4444-4444-8444-444444444444'
  );
  employee_data := report #> '{employees,0}';
  if (employee_data ->> 'commissionAmount')::numeric <> 254503 then raise exception 'Case 4 commission is wrong'; end if;
  if (employee_data ->> 'estimatedSalary')::numeric <> 954503 then raise exception 'Case 4 salary is wrong'; end if;

  report := public.get_payroll_dashboard(
    'b1111111-aaaa-4111-8111-111111111111', '2026-05-01', 'b5555555-5555-4555-8555-555555555555'
  );
  employee_data := report #> '{employees,0}';
  if (employee_data ->> 'grossSales')::numeric <> 0 then raise exception 'Case 1 gross sales are wrong'; end if;
  if (employee_data ->> 'commissionAmount')::numeric <> 0 then raise exception 'Case 1 commission is wrong'; end if;
  if (employee_data ->> 'estimatedSalary')::numeric <> 700000 then raise exception 'Case 1 salary is wrong'; end if;

  report := public.get_payroll_dashboard(
    'b1111111-aaaa-4111-8111-111111111111', '2026-04-01', 'b4444444-4444-4444-8444-444444444444'
  );
  if (report #>> '{employees,0,grossSales}')::numeric <> 1100000 then raise exception 'Pre-cancellation gross sales are wrong'; end if;

  perform public.cancel_sale('b6555555-5555-4555-8555-555555555555', 'Venta anulada para prueba salarial');
  report := public.get_payroll_dashboard(
    'b1111111-aaaa-4111-8111-111111111111', '2026-04-01', 'b4444444-4444-4444-8444-444444444444'
  );
  if (report #>> '{employees,0,grossSales}')::numeric <> 100000 then raise exception 'Cancelled sale remained in commission base'; end if;

  created_settlement_id := public.settle_employee_payroll(
    'b1111111-aaaa-4111-8111-111111111111',
    'b4444444-4444-4444-8444-444444444444',
    '2026-02-01',
    'Liquidación de prueba'
  );

  perform public.set_employee_compensation(
    'b1111111-aaaa-4111-8111-111111111111',
    'b4444444-4444-4444-8444-444444444444',
    800000,
    1,
    '2026-03-01',
    'Cambio posterior a la liquidación'
  );

  if not exists (
    select 1 from public.payroll_settlements
    where id = created_settlement_id
      and base_salary = 700000
      and commission_base = 10000000
      and commission_amount = 100000
      and gross_salary = 800000
  ) then
    raise exception 'Historical settlement changed after compensation update';
  end if;

  begin
    perform public.settle_employee_payroll(
      'b1111111-aaaa-4111-8111-111111111111',
      'b4444444-4444-4444-8444-444444444444',
      '2026-02-01',
      null
    );
    raise exception 'Duplicate settlement was accepted';
  exception when unique_violation then null;
  end;

  perform public.mark_payroll_settlement_paid(
    'b1111111-aaaa-4111-8111-111111111111',
    created_settlement_id,
    '2026-03-05',
    'Transferencia',
    'Pago de prueba'
  );

  if not exists (
    select 1 from public.payroll_movements
    where settlement_id = created_settlement_id and kind = 'salary' and amount = 800000
  ) then
    raise exception 'Paid settlement did not create its payroll movement';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare
  report jsonb;
begin
  report := public.get_payroll_dashboard(
    'b1111111-aaaa-4111-8111-111111111111', '2026-02-01', null
  );
  if jsonb_array_length(report -> 'employees') <> 1 then raise exception 'Employee read another salary profile'; end if;
  if report #>> '{employees,0,id}' <> 'b4444444-4444-4444-8444-444444444444' then raise exception 'Employee dashboard returned the wrong profile'; end if;
  if (select count(*) from public.payroll_settlements) <> 1 then raise exception 'Employee cannot read own settlement'; end if;

  begin
    perform public.get_payroll_dashboard(
      'b1111111-aaaa-4111-8111-111111111111',
      '2026-02-01',
      'b5555555-5555-4555-8555-555555555555'
    );
    raise exception 'Employee read another employee by changing the id';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.set_employee_compensation(
      'b1111111-aaaa-4111-8111-111111111111',
      'b4444444-4444-4444-8444-444444444444',
      1,
      99,
      '2026-06-01',
      'Manipulación'
    );
    raise exception 'Employee modified compensation';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.employee_compensations
    set base_salary = 1
    where employee_id = 'b4444444-4444-4444-8444-444444444444';
    if found then raise exception 'Employee updated compensation directly'; end if;
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"b3333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.payroll_settlements) <> 0 then
    raise exception 'A different employee read payroll settlements';
  end if;
end;
$$;

rollback;
