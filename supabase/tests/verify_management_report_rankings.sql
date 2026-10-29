begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('83111111-1111-4111-8111-111111111111', 'management-reports@local.test', '{}', '{}');
alter table public.organizations disable trigger guard_organization_bootstrap;
insert into public.organizations (id, name, slug, created_by)
values ('83111111-aaaa-4111-8111-111111111111', 'Management Reports', 'management-reports', '83111111-1111-4111-8111-111111111111');
alter table public.organizations enable trigger guard_organization_bootstrap;
set local role authenticated;
set local request.jwt.claims = '{"sub":"83111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  org uuid := '83111111-aaaa-4111-8111-111111111111';
  product uuid;
  best_units uuid;
  cash uuid;
  sale uuid;
  items jsonb := '[]';
  total numeric := 0;
  day date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  analytics jsonb;
begin
  select id into cash from public.payment_methods where organization_id = org and code = 'cash';
  for i in 1..60 loop
    insert into public.products (organization_id, name, sku, cost_price, retail_price)
    values (org, 'Ranking ' || lpad(i::text, 2, '0'), 'RANK-' || i, 1, i * 1000) returning id into product;
    if i = 1 then best_units := product; end if;
    perform public.adjust_inventory(org, product, 100, 'Ranking test fixture');
    items := items || jsonb_build_array(jsonb_build_object('product_id', product, 'quantity', 61 - i));
    total := total + (61 - i) * i * 1000;
  end loop;
  sale := public.create_sale_with_payments(org, items,
    jsonb_build_array(jsonb_build_object('payment_method_id', cash, 'amount', total)));
  analytics := public.get_business_analytics(org, day, day, day - 1, day - 1, date_trunc('month', day)::date);
  if jsonb_array_length(analytics->'topProducts') < 50 then
    raise exception 'Ranking is still limited to fewer than 50 products';
  end if;
  if not exists (select 1 from jsonb_array_elements(analytics->'topProducts') item where (item->>'id')::uuid = best_units and (item->>'units')::numeric = 60) then
    raise exception 'Units leader was lost by selecting only the revenue ranking';
  end if;
  if (analytics#>>'{summary,current,revenue}')::numeric <> total then
    raise exception 'Ranking changed sales summary';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.get_business_analytics(uuid,date,date,date,date,date,uuid,uuid,uuid,boolean,text)'::regprocedure) then
    raise exception 'Ranking function must remain SECURITY INVOKER';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"83222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
begin
  begin
    perform public.get_business_analytics('83111111-aaaa-4111-8111-111111111111', current_date, current_date, current_date-1, current_date-1, date_trunc('month', current_date)::date);
    raise exception 'Outsider was allowed to read financial reports';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
