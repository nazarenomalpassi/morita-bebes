begin;

do $$
declare
  table_count integer;
  rls_count integer;
begin
  select count(*), count(*) filter (where c.relrowsecurity)
  into table_count, rls_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r';

  if table_count <> 35 then
    raise exception 'Expected 35 public tables, found %', table_count;
  end if;

  if rls_count <> table_count then
    raise exception 'RLS is not enabled on every public table';
  end if;
end;
$$;

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '11111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'schema-test@local.test',
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
    '11111111-aaaa-4111-8111-111111111111',
    'Morita Bebes Schema Test',
    'morita-bebes-schema-test',
    '11111111-1111-4111-8111-111111111111'
  );

  if bootstrap_already_used then
    execute 'alter table public.organizations enable trigger guard_organization_bootstrap';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  test_organization_id uuid := '11111111-aaaa-4111-8111-111111111111';
  test_category_id uuid;
  test_product_id uuid;
  resulting_stock numeric(14, 3);
  owner_role public.app_role;
begin
  select role
  into owner_role
  from public.organization_members
  where organization_id = test_organization_id
    and user_id = '11111111-1111-4111-8111-111111111111';

  if owner_role <> 'owner' then
    raise exception 'Organization creator was not assigned owner role';
  end if;

  select id
  into test_category_id
  from public.categories
  where organization_id = test_organization_id
    and slug = 'panales';

  if test_category_id is null then
    raise exception 'Default categories were not created';
  end if;

  if (
    select count(*)
    from public.payment_methods
    where organization_id = test_organization_id
      and is_active
      and code in ('cash', 'transfer', 'card')
  ) <> 3 then
    raise exception 'Default payment methods were not created';
  end if;

  insert into public.products (
    organization_id,
    category_id,
    name,
    sku,
    retail_price,
    min_stock
  )
  values (
    test_organization_id,
    test_category_id,
    'Pañales de prueba',
    'TEST-001',
    10000,
    2
  )
  returning id into test_product_id;

  insert into public.inventory_movements (
    organization_id,
    product_id,
    kind,
    quantity_delta,
    created_by
  )
  values (
    test_organization_id,
    test_product_id,
    'initial',
    10,
    '11111111-1111-4111-8111-111111111111'
  );

  select current_stock
  into resulting_stock
  from public.products
  where id = test_product_id;

  if resulting_stock <> 10 then
    raise exception 'Inventory trigger expected stock 10, found %', resulting_stock;
  end if;

  if not private.is_org_member(test_organization_id) then
    raise exception 'Owner membership is not recognized by RLS helper';
  end if;
end;
$$;

rollback;
