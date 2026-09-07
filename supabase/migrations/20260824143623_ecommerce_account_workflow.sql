create or replace function private.guard_store_customer_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_wholesale_request boolean :=
    old.customer_type = 'retail'
    and old.wholesale_status in ('not_requested', 'rejected')
    and new.customer_type = 'wholesale'
    and new.wholesale_status = 'pending'
    and new.wholesale_review_notes is null
    and new.reviewed_by is null
    and new.reviewed_at is null;
begin
  if (select auth.uid()) = old.user_id
    and not private.has_org_role(old.organization_id, array['owner', 'admin']::public.app_role[])
    and not is_wholesale_request
    and (
      new.organization_id is distinct from old.organization_id
      or new.email is distinct from old.email
      or new.customer_type is distinct from old.customer_type
      or new.wholesale_status is distinct from old.wholesale_status
      or new.wholesale_review_notes is distinct from old.wholesale_review_notes
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
    ) then
    raise exception using errcode = '42501', message = 'Commercial account status is managed by Morita Bebés';
  end if;
  return new;
end;
$$;

create function public.request_wholesale_account()
returns public.wholesale_account_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  result_status public.wholesale_account_status;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  update public.store_customer_profiles
  set customer_type = 'wholesale',
      wholesale_status = 'pending',
      wholesale_review_notes = null,
      reviewed_by = null,
      reviewed_at = null
  where user_id = actor_id
    and wholesale_status in ('not_requested', 'rejected')
  returning wholesale_status into result_status;

  if result_status is null then
    select wholesale_status into result_status
    from public.store_customer_profiles
    where user_id = actor_id;
  end if;
  if result_status is null then
    raise exception using errcode = 'P0002', message = 'Store customer profile not found';
  end if;
  return result_status;
end;
$$;

revoke all on function public.request_wholesale_account() from public, anon;
grant execute on function public.request_wholesale_account() to authenticated, service_role;

comment on function public.request_wholesale_account() is
  'Allows a customer to request wholesale review without granting approval privileges.';
