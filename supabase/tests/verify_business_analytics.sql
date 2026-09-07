begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'analytics-owner@local.test', '{}'::jsonb, '{"display_name":"Dueña Analítica"}'::jsonb, now(), now()),
  ('a2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'analytics-staff@local.test', '{}'::jsonb, '{"display_name":"Empleado Analítica"}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, created_by)
values ('a1111111-aaaa-4111-8111-111111111111', 'Analytics Test', 'analytics-test', 'a1111111-1111-4111-8111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';

select public.add_organization_member_by_email(
  'a1111111-aaaa-4111-8111-111111111111',
  'analytics-staff@local.test',
  'staff'
);

insert into public.products (id, organization_id, category_id, name, sku, cost_price, retail_price, min_stock, target_stock)
select
  'a4444444-4444-4444-8444-444444444444',
  'a1111111-aaaa-4111-8111-111111111111',
  category.id,
  'Pañal de prueba',
  'ANA-001',
  50,
  100,
  2,
  8
from public.categories as category
where category.organization_id = 'a1111111-aaaa-4111-8111-111111111111'
  and category.slug = 'panales';

select public.adjust_inventory(
  'a1111111-aaaa-4111-8111-111111111111',
  'a4444444-4444-4444-8444-444444444444',
  10,
  'Stock analítico inicial',
  50,
  'a5555555-5555-4555-8555-555555555555'
);

select public.create_sale(
  'a1111111-aaaa-4111-8111-111111111111',
  jsonb_build_array(jsonb_build_object('product_id', 'a4444444-4444-4444-8444-444444444444', 'quantity', 2)),
  (select id from public.payment_methods where organization_id = 'a1111111-aaaa-4111-8111-111111111111' and code = 'cash'),
  null,
  10,
  'Venta para conciliación',
  null,
  '2026-08-05T10:30:00-03:00'
);

insert into public.expenses (organization_id, category_id, description, amount, expense_date, created_by)
select
  'a1111111-aaaa-4111-8111-111111111111',
  category.id,
  'Internet',
  40,
  '2026-08-05',
  'a1111111-1111-4111-8111-111111111111'
from public.expense_categories as category
where category.organization_id = 'a1111111-aaaa-4111-8111-111111111111'
  and lower(category.name) = 'servicios';

insert into public.employees (id, organization_id, first_name, last_name, base_salary)
values ('a7777777-7777-4777-8777-777777777777', 'a1111111-aaaa-4111-8111-111111111111', 'Ana', 'Prueba', 0);

insert into public.payroll_movements (organization_id, employee_id, kind, amount, period_month, paid_at, created_by)
values ('a1111111-aaaa-4111-8111-111111111111', 'a7777777-7777-4777-8777-777777777777', 'bonus', 20, '2026-08-01', '2026-08-05', 'a1111111-1111-4111-8111-111111111111');

insert into public.monthly_sales_goals (organization_id, goal_month, sales_target, created_by)
values ('a1111111-aaaa-4111-8111-111111111111', '2026-08-01', 1000, 'a1111111-1111-4111-8111-111111111111');

do $$
declare
  report jsonb;
begin
  report := public.get_business_analytics(
    'a1111111-aaaa-4111-8111-111111111111',
    '2026-08-01', '2026-08-10',
    '2026-07-01', '2026-07-10',
    '2026-08-01'
  );

  if (report #>> '{summary,current,revenue}')::numeric <> 190 then raise exception 'Revenue does not reconcile'; end if;
  if (report #>> '{summary,current,saleCount}')::integer <> 1 then raise exception 'Sale count does not reconcile'; end if;
  if (report #>> '{summary,current,unitsSold}')::numeric <> 2 then raise exception 'Units do not reconcile'; end if;
  if (report #>> '{summary,current,knownCogs}')::numeric <> 100 then raise exception 'Historical COGS does not reconcile'; end if;
  if (report #>> '{summary,current,grossProfitKnown}')::numeric <> 90 then raise exception 'Gross profit does not reconcile'; end if;
  if (report #>> '{summary,current,operatingExpenses}')::numeric <> 60 then raise exception 'Expenses do not reconcile'; end if;
  if (report #>> '{summary,current,estimatedResult}')::numeric <> 30 then raise exception 'Estimated result does not reconcile'; end if;
  if jsonb_array_length(report -> 'topProducts') <> 1 then raise exception 'Product ranking is missing'; end if;
  if jsonb_array_length(report -> 'categories') <> 1 then raise exception 'Category ranking is missing'; end if;
  if jsonb_array_length(report -> 'payments') <> 1 then raise exception 'Payment breakdown is missing'; end if;
  if jsonb_array_length(report -> 'employees') <> 1 then raise exception 'Employee breakdown is missing'; end if;
  if (report #>> '{inventory,stockUnits}')::numeric <> 8 then raise exception 'Current stock summary is inconsistent'; end if;
  if (report #>> '{goal,target}')::numeric <> 1000 then raise exception 'Monthly goal is missing'; end if;
  if (report #>> '{goal,progressPct}')::numeric <> 19 then raise exception 'Monthly goal progress is wrong'; end if;

  begin
    update public.monthly_sales_goals
    set created_by = 'a2222222-2222-4222-8222-222222222222'
    where organization_id = 'a1111111-aaaa-4111-8111-111111111111' and goal_month = '2026-08-01';
    raise exception 'Monthly goal creator was rewritten';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    perform public.get_business_analytics(
      'a1111111-aaaa-4111-8111-111111111111',
      '2026-08-01', '2026-08-10',
      '2026-07-01', '2026-07-10',
      '2026-08-01'
    );
    raise exception 'Staff accessed financial analytics';
  exception when insufficient_privilege then null;
  end;

  if (select count(*) from public.monthly_sales_goals where organization_id = 'a1111111-aaaa-4111-8111-111111111111') <> 0 then
    raise exception 'Staff read monthly sales goals';
  end if;
end;
$$;

rollback;

select 'business analytics verification passed' as result;
