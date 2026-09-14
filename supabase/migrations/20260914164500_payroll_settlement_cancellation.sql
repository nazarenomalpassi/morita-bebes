-- A correction keeps the original settlement and its payment allocations.
-- Only one non-void settlement may exist for an employee and month.
alter table public.payroll_settlements
  add column voided_at timestamptz,
  add column voided_by uuid references auth.users(id) on delete restrict,
  add column void_reason text,
  add constraint payroll_settlements_void_complete_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null
      and char_length(trim(void_reason)) between 3 and 500)
  );

alter table public.payroll_settlements drop constraint payroll_settlements_period_key;
create unique index payroll_settlements_active_period_key
  on public.payroll_settlements (employee_id, period_month)
  where voided_at is null;

create or replace function private.guard_payroll_settlement_write()
returns trigger language plpgsql set search_path = '' as $$
declare payroll_action text := current_setting('morita.payroll_action', true);
begin
  if tg_op = 'INSERT' then
    if payroll_action <> 'settle' then
      raise exception using errcode = '42501',
        message = 'Payroll settlements must be created through the settlement workflow';
    end if;
    return new;
  end if;

  if payroll_action = 'void_settlement'
    and old.status = 'paid'
    and old.voided_at is null
    and new.voided_at is not null
    and new.voided_by = (select auth.uid())
    and (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason' - 'updated_at')
      = (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason' - 'updated_at')
  then return new; end if;

  if payroll_action <> 'mark_paid' then
    raise exception using errcode = '42501',
      message = 'Payroll settlements can only be updated through Personal workflows';
  end if;
  if old.voided_at is not null or old.status = 'paid' then
    raise exception using errcode = '42501',
      message = 'A paid or void payroll settlement is immutable';
  end if;
  if old.organization_id is distinct from new.organization_id
    or old.employee_id is distinct from new.employee_id
    or old.compensation_id is distinct from new.compensation_id
    or old.period_month is distinct from new.period_month
    or old.base_salary is distinct from new.base_salary
    or old.commission_percentage is distinct from new.commission_percentage
    or old.commission_type is distinct from new.commission_type
    or old.commission_base is distinct from new.commission_base
    or old.commission_amount is distinct from new.commission_amount
    or old.gross_salary is distinct from new.gross_salary
    or old.sales_count is distinct from new.sales_count
    or old.settled_at is distinct from new.settled_at
    or old.settled_by is distinct from new.settled_by
    or old.voided_at is distinct from new.voided_at
  then
    raise exception using errcode = '42501',
      message = 'Historical payroll amounts are immutable';
  end if;
  if new.status <> 'paid' then
    raise exception using errcode = '23514',
      message = 'Invalid payroll settlement status transition';
  end if;
  return new;
end;
$$;

create or replace function public.void_payroll_settlement(
  p_organization_id uuid, p_settlement_id uuid, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := private.require_cash_admin(p_organization_id);
  target public.payroll_settlements%rowtype;
  cash_entry public.cash_movements%rowtype;
  latest_closure date;
  local_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'A cancellation reason is required';
  end if;
  select * into target from public.payroll_settlements
  where id = p_settlement_id and organization_id = p_organization_id for update;
  if target.id is null then
    raise exception using errcode = 'P0002', message = 'Payroll settlement not found';
  end if;
  if target.voided_at is not null then return target.id; end if;
  if target.status <> 'paid' then
    raise exception using errcode = '23514',
      message = 'Only a paid settlement can be cancelled';
  end if;
  select max(business_date) into latest_closure from public.daily_cash_closures
  where organization_id = p_organization_id;
  if latest_closure is not null and local_today <= latest_closure then
    raise exception using errcode = '22007',
      message = 'The current cash day is already closed';
  end if;
  perform set_config('morita.payroll_action', 'void_settlement', true);
  update public.payroll_settlements
  set voided_at = now(), voided_by = actor_id, void_reason = trim(p_reason)
  where id = target.id;

  for cash_entry in
    select * from public.cash_movements
    where organization_id = p_organization_id
      and reference_type = 'payroll_settlement'
      and reference_id = target.id
      and type = 'payroll' and direction = 'debit'
    order by created_at, id
  loop
    perform private.append_cash_movement(
      p_organization_id, cash_entry.cash_account_id, 'adjustment', 'credit',
      cash_entry.amount, 'payroll_settlement', target.id, null, cash_entry.id,
      'payroll-settlement-void:' || cash_entry.id::text,
      'Anulacion de liquidacion de sueldo', now(), actor_id,
      jsonb_build_object('employee_id', target.employee_id,
        'period_month', target.period_month, 'reason', trim(p_reason))
    );
  end loop;
  return target.id;
end;
$$;

revoke all on function public.void_payroll_settlement(uuid, uuid, text)
  from public, anon;
grant execute on function public.void_payroll_settlement(uuid, uuid, text)
  to authenticated, service_role;

do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.get_payroll_dashboard(uuid,date,uuid)'::regprocedure);
  if position('and settlement.period_month = p_period_month' in definition) = 0 then
    raise exception 'Payroll dashboard structure changed; review required';
  end if;
  execute replace(definition,
    'and settlement.period_month = p_period_month',
    'and settlement.period_month = p_period_month and settlement.voided_at is null');

  definition := pg_get_functiondef('public.register_payroll_advance(uuid,uuid,date,numeric,date,uuid,text)'::regprocedure);
  if position('and period_month = p_period_month) then' in definition) = 0 then
    raise exception 'Advance registration structure changed; review required';
  end if;
  execute replace(definition,
    'and period_month = p_period_month) then',
    'and period_month = p_period_month and voided_at is null) then');

  definition := pg_get_functiondef('public.void_payroll_advance(uuid,uuid,text)'::regprocedure);
  if position('and period_month = target.period_month) then' in definition) = 0 then
    raise exception 'Advance cancellation structure changed; review required';
  end if;
  execute replace(definition,
    'and period_month = target.period_month) then',
    'and period_month = target.period_month and voided_at is null) then');

  definition := pg_get_functiondef('public.mark_payroll_settlement_paid_with_payments(uuid,uuid,date,jsonb,text)'::regprocedure);
  if position('if settlement.status = ''paid'' then' in definition) = 0 then
    raise exception 'Payroll payment structure changed; review required';
  end if;
  execute replace(definition,
    'if settlement.status = ''paid'' then',
    'if settlement.voided_at is not null then raise exception using errcode = ''23514'', message = ''Cancelled payroll cannot be paid''; end if; if settlement.status = ''paid'' then');

  definition := pg_get_functiondef(
    'public.get_business_analytics(uuid,date,date,date,date,date,uuid,uuid,uuid,boolean,text)'::regprocedure);
  if position('    select expense.expense_date, expense.amount' in definition) = 0 then
    raise exception 'Business analytics structure changed; review required';
  end if;
  execute replace(definition,
    '    select expense.expense_date, expense.amount',
    '    select (settlement.voided_at at time zone ''America/Argentina/Buenos_Aires'')::date, -settlement.net_salary from public.payroll_settlements settlement where settlement.voided_at is not null and settlement.status = ''paid'' and settlement.organization_id = p_organization_id union all select expense.expense_date, expense.amount');
end;
$migration$;
