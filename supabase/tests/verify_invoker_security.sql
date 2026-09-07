begin;

do $$
begin
  if exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'can_bootstrap_organization',
        'finalize_import_batch'
      )
      and procedure.prosecdef
  ) then
    raise exception 'A public authenticated workflow is still SECURITY DEFINER';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.user_profiles'::regclass
  ) then
    raise exception 'RLS is not enabled on user_profiles';
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
values
  (
    '71111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'OWNER.ONE@LOCAL.TEST',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '72222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'STAFF.ONE@LOCAL.TEST',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '73333333-3333-4333-8333-333333333333',
    'authenticated',
    'authenticated',
    'ADMIN.ONE@LOCAL.TEST',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '74444444-4444-4444-8444-444444444444',
    'authenticated',
    'authenticated',
    'OWNER.TWO@LOCAL.TEST',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

do $$
begin
  if (
    select count(*)
    from public.user_profiles
    where email in (
      'owner.one@local.test',
      'staff.one@local.test',
      'admin.one@local.test',
      'owner.two@local.test'
    )
  ) <> 4 then
    raise exception 'Auth user trigger did not create normalized profiles';
  end if;
end;
$$;

update auth.users
set email = 'OWNER.ONE+UPDATED@LOCAL.TEST',
    updated_at = now()
where id = '71111111-1111-4111-8111-111111111111';

do $$
begin
  if not exists (
    select 1
    from public.user_profiles
    where user_id = '71111111-1111-4111-8111-111111111111'
      and email = 'owner.one+updated@local.test'
  ) then
    raise exception 'Auth email update was not synchronized to user_profiles';
  end if;
end;
$$;

create temporary table test_bootstrap_state (
  expected boolean not null
) on commit drop;

insert into test_bootstrap_state (expected)
select not exists (
  select 1 from private.organization_bootstrap_guard
);

grant select on test_bootstrap_state to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  expected_bootstrap boolean;
begin
  select expected into expected_bootstrap from test_bootstrap_state;
  if public.can_bootstrap_organization() is distinct from expected_bootstrap then
    raise exception 'Bootstrap RPC did not reflect singleton state';
  end if;
end;
$$;

reset role;
set local request.jwt.claims = '{}';

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
    '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Organization One',
    'organization-one',
    '71111111-1111-4111-8111-111111111111'
  );

  if bootstrap_already_used then
    execute 'alter table public.organizations enable trigger guard_organization_bootstrap';
  end if;
end;
$$;

-- A second organization exists only inside this rolled-back test so cross-org
-- authorization can be exercised despite production's singleton bootstrap.
alter table public.organizations disable trigger guard_organization_bootstrap;
insert into public.organizations (id, name, slug, created_by)
values (
  '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Organization Two',
  'organization-two',
  '74444444-4444-4444-8444-444444444444'
);
alter table public.organizations enable trigger guard_organization_bootstrap;

insert into public.import_batches (
  id,
  organization_id,
  filename,
  file_hash,
  total_rows,
  created_by
)
values (
  '75555555-5555-4555-8555-555555555555',
  '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'organization-two.xlsx',
  repeat('c', 64),
  2,
  '74444444-4444-4444-8444-444444444444'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  listed_count integer;
begin
  if public.can_bootstrap_organization() then
    raise exception 'Bootstrap remained available after organization creation';
  end if;

  if public.add_organization_member_by_email(
    '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'STAFF.ONE@LOCAL.TEST',
    'staff'
  ) <> '72222222-2222-4222-8222-222222222222' then
    raise exception 'Owner could not add staff through normalized profile email';
  end if;

  if public.add_organization_member_by_email(
    '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'ADMIN.ONE@LOCAL.TEST',
    'admin'
  ) <> '73333333-3333-4333-8333-333333333333' then
    raise exception 'Owner could not add administrator through profile email';
  end if;

  select count(*)
  into listed_count
  from public.list_organization_members(
    '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );

  if listed_count <> 3 then
    raise exception 'Owner expected three organization members, found %', listed_count;
  end if;

  if (
    select count(*)
    from public.user_profiles
    where user_id in (
      '71111111-1111-4111-8111-111111111111',
      '72222222-2222-4222-8222-222222222222',
      '73333333-3333-4333-8333-333333333333',
      '74444444-4444-4444-8444-444444444444'
    )
  ) <> 3 then
    raise exception 'Owner should only resolve profiles from the same organization';
  end if;

  begin
    perform public.add_organization_member_by_email(
      '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'staff.one@local.test',
      'staff'
    );
    raise exception 'Cross-organization member add unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.update_organization_member(
      '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '74444444-4444-4444-8444-444444444444',
      'staff',
      true
    );
    raise exception 'Cross-organization member update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1
    from public.list_organization_members(
      '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    );
    raise exception 'Cross-organization member listing unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.finalize_import_batch(
      '75555555-5555-4555-8555-555555555555',
      2,
      '{}'::jsonb,
      false
    );
    raise exception 'Cross-organization import finalization unexpectedly succeeded';
  exception
    when no_data_found then null;
  end;
end;
$$;

set local request.jwt.claims =
  '{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.user_profiles) <> 1 then
    raise exception 'Staff should only read their own profile';
  end if;

  if not exists (
    select 1
    from public.user_profiles
    where user_id = '72222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'Staff self profile is not visible';
  end if;

  if public.can_bootstrap_organization() then
    raise exception 'Unprivileged staff should not see bootstrap after initialization';
  end if;

  begin
    perform public.add_organization_member_by_email(
      '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'owner.two@local.test',
      'staff'
    );
    raise exception 'Staff member add unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1
    from public.list_organization_members(
      '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
    raise exception 'Staff member listing unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claims =
  '{"sub":"73333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
begin
  if (
    select count(*)
    from public.user_profiles
    where user_id in (
      '71111111-1111-4111-8111-111111111111',
      '72222222-2222-4222-8222-222222222222',
      '73333333-3333-4333-8333-333333333333',
      '74444444-4444-4444-8444-444444444444'
    )
  ) <> 3 then
    raise exception 'Administrator should only read co-organization profiles';
  end if;

  if (
    select count(*)
    from public.list_organization_members(
      '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )
  ) <> 3 then
    raise exception 'Administrator could not list organization members';
  end if;

  begin
    perform 1
    from public.list_organization_members(
      '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    );
    raise exception 'Administrator crossed organization boundary';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

set local request.jwt.claims =
  '{"sub":"74444444-4444-4444-8444-444444444444","role":"authenticated"}';

do $$
declare
  final_status public.import_batch_status;
begin
  perform public.finalize_import_batch(
    '75555555-5555-4555-8555-555555555555',
    2,
    '{"verified":true}'::jsonb,
    false
  );

  select status
  into final_status
  from public.import_batches
  where id = '75555555-5555-4555-8555-555555555555';

  if final_status <> 'completed' then
    raise exception 'Owner two import finalization failed with status %', final_status;
  end if;

  begin
    update public.import_batches
    set summary = '{"second_update":true}'::jsonb,
        status = 'completed'
    where id = '75555555-5555-4555-8555-555555555555';
    raise exception 'Finalized import batch unexpectedly allowed another update';
  exception
    when check_violation then null;
  end;
end;
$$;

rollback;
