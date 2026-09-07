create function private.guard_monthly_sales_goal_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.goal_month is distinct from old.goal_month
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'Monthly goal identity fields are immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_monthly_sales_goal_identity() from public;

create trigger guard_monthly_sales_goal_identity
before update on public.monthly_sales_goals
for each row execute function private.guard_monthly_sales_goal_identity();
