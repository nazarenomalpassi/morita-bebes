alter table public.expense_categories
  add column is_payroll_advance boolean not null default false;

update public.expense_categories
set is_payroll_advance = true
where lower(trim(name)) in ('sueldo', 'sueldos');

alter table public.expenses
  add column payroll_employee_id uuid,
  add column payroll_period_month date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and conname = 'expenses_id_org_unique'
  ) then
    alter table public.expenses
      add constraint expenses_id_org_unique unique (id, organization_id);
  end if;
end;
$$;

alter table public.expenses
  add constraint expenses_payroll_employee_fk
    foreign key (payroll_employee_id, organization_id)
    references public.employees(id, organization_id) on delete restrict,
  add constraint expenses_payroll_fields_check check (
    (payroll_employee_id is null and payroll_period_month is null)
    or
    (
      payroll_employee_id is not null
      and payroll_period_month is not null
      and payroll_period_month = date_trunc('month', payroll_period_month)::date
    )
  );

create index expenses_org_payroll_period_idx
  on public.expenses (organization_id, payroll_period_month, payroll_employee_id)
  where payroll_employee_id is not null;

alter table public.payroll_movements
  add column expense_id uuid;

alter table public.payroll_movements
  add constraint payroll_movements_expense_fk
    foreign key (expense_id, organization_id)
    references public.expenses(id, organization_id) on delete restrict;

create unique index payroll_movements_expense_key
  on public.payroll_movements (expense_id)
  where expense_id is not null;

alter table public.payroll_settlements
  add column bonus_amount numeric(14, 2) not null default 0 check (bonus_amount >= 0),
  add column advance_amount numeric(14, 2) not null default 0 check (advance_amount >= 0),
  add column deduction_amount numeric(14, 2) not null default 0 check (deduction_amount >= 0),
  add column net_salary numeric(14, 2) not null default 0 check (net_salary >= 0);

update public.payroll_settlements
set net_salary = gross_salary;

alter table public.payroll_settlements
  add constraint payroll_settlements_net_total_check check (
    net_salary = gross_salary + bonus_amount - advance_amount - deduction_amount
  );

create table public.payroll_settlement_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  settlement_id uuid not null,
  source_movement_id uuid,
  kind public.payroll_movement_kind not null check (kind <> 'salary'),
  amount numeric(14, 2) not null check (amount > 0),
  occurred_on date not null,
  description text not null check (char_length(trim(description)) between 2 and 500),
  source_type text not null default 'manual' check (source_type in ('manual', 'expense')),
  created_at timestamptz not null default now(),
  constraint payroll_settlement_adjustments_settlement_fk
    foreign key (settlement_id, organization_id)
    references public.payroll_settlements(id, organization_id) on delete restrict,
  constraint payroll_settlement_adjustments_source_fk
    foreign key (source_movement_id)
    references public.payroll_movements(id) on delete set null
);

create unique index payroll_settlement_adjustments_source_key
  on public.payroll_settlement_adjustments (settlement_id, source_movement_id)
  where source_movement_id is not null;

create index payroll_settlement_adjustments_lookup_idx
  on public.payroll_settlement_adjustments (organization_id, settlement_id, occurred_on);

alter table public.payroll_settlement_adjustments enable row level security;

create policy "authorized users read payroll settlement adjustments"
on public.payroll_settlement_adjustments for select to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (
    private.has_org_role(organization_id, array['staff']::public.app_role[])
    and exists (
      select 1
      from public.payroll_settlements as settlement
      join public.employees as employee
        on employee.id = settlement.employee_id
       and employee.organization_id = settlement.organization_id
      where settlement.id = payroll_settlement_adjustments.settlement_id
        and settlement.organization_id = payroll_settlement_adjustments.organization_id
        and employee.user_id = (select auth.uid())
    )
  )
);

create policy "owners and admins insert payroll settlement adjustments"
on public.payroll_settlement_adjustments for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

grant select, insert on public.payroll_settlement_adjustments to authenticated;
grant all privileges on public.payroll_settlement_adjustments to service_role;

create or replace function private.guard_payroll_settlement_adjustment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and current_setting('morita.payroll_action', true) = 'settle' then
    return new;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Payroll settlement adjustment snapshots are immutable';
end;
$$;

revoke all on function private.guard_payroll_settlement_adjustment()
  from public, anon, authenticated;

create trigger payroll_settlement_adjustments_guard_write
before insert or update or delete on public.payroll_settlement_adjustments
for each row execute function private.guard_payroll_settlement_adjustment();

create trigger audit_payroll_settlement_adjustments
after insert or update or delete on public.payroll_settlement_adjustments
for each row execute function private.audit_row_change();

drop policy if exists "owners and admins manage payroll" on public.payroll_movements;

create policy "authorized users read payroll movements"
on public.payroll_movements for select to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or (
    private.has_org_role(organization_id, array['staff']::public.app_role[])
    and exists (
      select 1
      from public.employees as employee
      where employee.id = payroll_movements.employee_id
        and employee.organization_id = payroll_movements.organization_id
        and employee.user_id = (select auth.uid())
    )
  )
);

create policy "owners and admins insert payroll movements"
on public.payroll_movements for insert to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins update payroll movements"
on public.payroll_movements for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "owners and admins delete payroll movements"
on public.payroll_movements for delete to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create or replace function private.guard_settlement_payroll_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.settlement_id is not null then
    raise exception using
      errcode = '42501',
      message = 'Payroll movements created from settlements are immutable';
  end if;

  if old.expense_id is not null
    and current_setting('morita.payroll_expense_sync', true) <> 'sync'
  then
    raise exception using
      errcode = '42501',
      message = 'Payroll advances created from expenses are managed from Expenses';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.guard_settlement_payroll_movement()
  from public, anon, authenticated;

create or replace function private.guard_expense_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  category_is_payroll boolean := false;
begin
  if actor_id is not null then
    select member.role
    into actor_role
    from public.organization_members as member
    where member.organization_id = coalesce(new.organization_id, old.organization_id)
      and member.user_id = actor_id
      and member.is_active;

    if not found then
      raise exception using errcode = '42501', message = 'Active organization membership is required';
    end if;
  elsif current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  select category.is_payroll_advance
  into category_is_payroll
  from public.expense_categories as category
  where category.id = new.category_id
    and category.organization_id = new.organization_id;

  category_is_payroll := coalesce(category_is_payroll, false);

  if category_is_payroll then
    if actor_id is not null and actor_role not in ('owner', 'admin') then
      raise exception using errcode = '42501', message = 'Only administrators can register salary advances';
    end if;
    if new.payroll_employee_id is null or new.payroll_period_month is null then
      raise exception using errcode = '23514', message = 'Salary expenses require an employee and payroll period';
    end if;
  elsif new.payroll_employee_id is not null or new.payroll_period_month is not null then
    raise exception using errcode = '23514', message = 'Payroll assignment is only valid for salary expenses';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(actor_id, new.created_by);
    new.status := 'posted';
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
    if actor_role = 'staff' then
      new.expense_date := current_date;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'Expense identity and creation fields are immutable';
  end if;

  if old.status = 'cancelled' then
    raise exception using errcode = '42501', message = 'Cancelled expenses are immutable';
  end if;

  if actor_id is not null and actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'Only administrators can modify expenses';
  end if;

  if old.payroll_employee_id is not null
    and exists (
      select 1
      from public.payroll_settlements as settlement
      where settlement.organization_id = old.organization_id
        and settlement.employee_id = old.payroll_employee_id
        and settlement.period_month = old.payroll_period_month
    )
    and (
      new.status is distinct from old.status
      or new.amount is distinct from old.amount
      or new.expense_date is distinct from old.expense_date
      or new.category_id is distinct from old.category_id
      or new.payroll_employee_id is distinct from old.payroll_employee_id
      or new.payroll_period_month is distinct from old.payroll_period_month
    )
  then
    raise exception using
      errcode = '42501',
      message = 'A salary advance cannot be changed after its payroll period was settled';
  end if;

  if new.status = old.status then
    if new.cancelled_at is distinct from old.cancelled_at
      or new.cancelled_by is distinct from old.cancelled_by
      or new.cancellation_reason is distinct from old.cancellation_reason then
      raise exception using errcode = '42501', message = 'Expense cancellation fields are workflow-managed';
    end if;
    return new;
  end if;

  if old.status = 'posted' and new.status = 'cancelled' then
    if new.description is distinct from old.description
      or new.amount is distinct from old.amount
      or new.expense_date is distinct from old.expense_date
      or new.category_id is distinct from old.category_id
      or new.payment_method_id is distinct from old.payment_method_id
      or new.receipt_path is distinct from old.receipt_path
      or new.notes is distinct from old.notes
      or new.payroll_employee_id is distinct from old.payroll_employee_id
      or new.payroll_period_month is distinct from old.payroll_period_month then
      raise exception using errcode = '42501', message = 'Cancel an expense without changing its original data';
    end if;
    if new.cancellation_reason is null or char_length(trim(new.cancellation_reason)) < 3 then
      raise exception using errcode = '23514', message = 'A cancellation reason is required';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := actor_id;
    new.cancellation_reason := trim(new.cancellation_reason);
    return new;
  end if;

  raise exception using errcode = '23514', message = 'Invalid expense status transition';
end;
$$;

revoke all on function private.guard_expense_write()
  from public, anon, authenticated;

create or replace function private.sync_expense_payroll_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_is_payroll boolean := false;
begin
  perform set_config('morita.payroll_expense_sync', 'sync', true);

  if tg_op = 'UPDATE' then
    delete from public.payroll_movements
    where expense_id = old.id;
  end if;

  select category.is_payroll_advance
  into category_is_payroll
  from public.expense_categories as category
  where category.id = new.category_id
    and category.organization_id = new.organization_id;

  if new.status = 'posted' and coalesce(category_is_payroll, false) then
    insert into public.payroll_movements (
      organization_id,
      employee_id,
      kind,
      amount,
      period_month,
      paid_at,
      notes,
      created_by,
      expense_id
    ) values (
      new.organization_id,
      new.payroll_employee_id,
      'advance',
      new.amount,
      new.payroll_period_month,
      null,
      'Adelanto registrado desde Gastos: ' || new.description,
      new.created_by,
      new.id
    )
    on conflict (expense_id) where expense_id is not null do update
    set employee_id = excluded.employee_id,
        amount = excluded.amount,
        period_month = excluded.period_month,
        notes = excluded.notes;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_expense_payroll_advance()
  from public, anon, authenticated;

create trigger sync_expense_payroll_advance
after insert or update of status, category_id, amount, expense_date,
  description, payroll_employee_id, payroll_period_month
on public.expenses
for each row execute function private.sync_expense_payroll_advance();

create or replace function private.guard_payroll_settlement_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  payroll_action text := current_setting('morita.payroll_action', true);
begin
  if tg_op = 'INSERT' then
    if payroll_action <> 'settle' then
      raise exception using errcode = '42501', message = 'Payroll settlements must be created through the settlement workflow';
    end if;
    return new;
  end if;

  if payroll_action <> 'mark_paid' then
    raise exception using errcode = '42501', message = 'Payroll settlements can only be updated through the payment workflow';
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
     or old.bonus_amount is distinct from new.bonus_amount
     or old.advance_amount is distinct from new.advance_amount
     or old.deduction_amount is distinct from new.deduction_amount
     or old.net_salary is distinct from new.net_salary
     or old.sales_count is distinct from new.sales_count
     or old.settled_at is distinct from new.settled_at
     or old.settled_by is distinct from new.settled_by then
    raise exception using errcode = '42501', message = 'Historical payroll amounts are immutable';
  end if;

  if old.status = 'paid' then
    raise exception using errcode = '42501', message = 'A paid payroll settlement is immutable';
  end if;

  if new.status <> 'paid' then
    raise exception using errcode = '23514', message = 'Invalid payroll settlement status transition';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_payroll_settlement_write()
  from public, anon, authenticated;

create or replace function public.settle_employee_payroll(
  p_organization_id uuid,
  p_employee_id uuid,
  p_period_month date,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  compensation public.employee_compensations%rowtype;
  totals record;
  target_settlement_id uuid;
  commission_value numeric(14, 2);
  gross_value numeric(14, 2);
  bonus_value numeric(14, 2) := 0;
  advance_value numeric(14, 2) := 0;
  deduction_value numeric(14, 2) := 0;
  net_value numeric(14, 2);
begin
  if actor_id is null or not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Administrator role is required';
  end if;
  if p_period_month <> date_trunc('month', p_period_month)::date then
    raise exception using errcode = '22007', message = 'Payroll period must be the first day of a month';
  end if;
  if p_period_month >= date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception using errcode = '22023', message = 'The payroll period must be closed before settlement';
  end if;

  select candidate.* into compensation
  from public.employee_compensations as candidate
  where candidate.organization_id = p_organization_id
    and candidate.employee_id = p_employee_id
    and candidate.is_active
    and candidate.effective_from < p_period_month + interval '1 month'
    and (candidate.effective_to is null or candidate.effective_to >= p_period_month)
  order by candidate.effective_from desc
  limit 1;

  if compensation.id is null then
    raise exception using errcode = 'P0002', message = 'No compensation is configured for this period';
  end if;

  select * into totals
  from private.get_monthly_store_sales(p_organization_id, p_period_month);

  commission_value := round(totals.gross_sales * compensation.commission_percentage / 100, 2);
  gross_value := round(compensation.base_salary + commission_value, 2);

  select
    coalesce(sum(movement.amount) filter (where movement.kind = 'bonus'), 0),
    coalesce(sum(movement.amount) filter (where movement.kind = 'advance'), 0),
    coalesce(sum(movement.amount) filter (where movement.kind = 'deduction'), 0)
  into bonus_value, advance_value, deduction_value
  from public.payroll_movements as movement
  where movement.organization_id = p_organization_id
    and movement.employee_id = p_employee_id
    and movement.period_month = p_period_month
    and movement.kind in ('advance', 'bonus', 'deduction');

  net_value := round(gross_value + bonus_value - advance_value - deduction_value, 2);

  if net_value < 0 then
    raise exception using
      errcode = '23514',
      message = 'Payroll advances and deductions exceed the salary total for this period';
  end if;

  perform set_config('morita.payroll_action', 'settle', true);

  insert into public.payroll_settlements (
    organization_id,
    employee_id,
    compensation_id,
    period_month,
    base_salary,
    commission_percentage,
    commission_type,
    commission_base,
    commission_amount,
    gross_salary,
    bonus_amount,
    advance_amount,
    deduction_amount,
    net_salary,
    sales_count,
    status,
    settled_at,
    settled_by,
    notes
  ) values (
    p_organization_id,
    p_employee_id,
    compensation.id,
    p_period_month,
    compensation.base_salary,
    compensation.commission_percentage,
    compensation.commission_type,
    round(totals.gross_sales, 2),
    commission_value,
    gross_value,
    bonus_value,
    advance_value,
    deduction_value,
    net_value,
    totals.sale_count::integer,
    'settled',
    now(),
    actor_id,
    nullif(trim(p_notes), '')
  )
  returning id into target_settlement_id;

  insert into public.payroll_settlement_adjustments (
    organization_id,
    settlement_id,
    source_movement_id,
    kind,
    amount,
    occurred_on,
    description,
    source_type
  )
  select
    movement.organization_id,
    target_settlement_id,
    movement.id,
    movement.kind,
    movement.amount,
    coalesce(expense.expense_date, movement.paid_at, movement.period_month),
    coalesce(expense.description, movement.notes, 'Ajuste salarial'),
    case when movement.expense_id is null then 'manual' else 'expense' end
  from public.payroll_movements as movement
  left join public.expenses as expense
    on expense.id = movement.expense_id
   and expense.organization_id = movement.organization_id
  where movement.organization_id = p_organization_id
    and movement.employee_id = p_employee_id
    and movement.period_month = p_period_month
    and movement.kind in ('advance', 'bonus', 'deduction');

  return target_settlement_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Payroll for this employee and period is already settled';
end;
$$;

revoke all on function public.settle_employee_payroll(uuid, uuid, date, text)
  from public, anon;
grant execute on function public.settle_employee_payroll(uuid, uuid, date, text)
  to authenticated, service_role;

create or replace function private.apply_payroll_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  allocation record;
  target_account_id uuid;
begin
  if old.status <> 'paid' and new.status = 'paid' then
    if new.net_salary = 0 then
      return new;
    end if;

    select tracking_started_at into cutoff
    from public.cash_tracking_settings
    where organization_id = new.organization_id;

    if cutoff is null or private.cash_date_at_noon(new.paid_at) < cutoff then
      return new;
    end if;

    if exists (
      select 1
      from public.payroll_settlement_payments
      where settlement_id = new.id
        and organization_id = new.organization_id
    ) then
      for allocation in
        select payment.payment_method_id, payment.amount, method.name
        from public.payroll_settlement_payments as payment
        join public.payment_methods as method
          on method.id = payment.payment_method_id
         and method.organization_id = payment.organization_id
        where payment.settlement_id = new.id
          and payment.organization_id = new.organization_id
        order by method.sort_order, method.name, payment.id
      loop
        target_account_id := private.financial_cash_account_id(
          new.organization_id,
          allocation.payment_method_id
        );

        if target_account_id is null then
          raise exception using errcode = '23503', message = 'Payroll payment has no canonical financial account';
        end if;

        perform private.append_cash_movement(
          new.organization_id,
          target_account_id,
          'payroll',
          'debit',
          allocation.amount,
          'payroll_settlement',
          new.id,
          null,
          null,
          'payroll:' || new.id::text || ':' || allocation.payment_method_id::text,
          'Pago de sueldo - ' || allocation.name,
          private.cash_date_at_noon(new.paid_at),
          new.paid_by,
          jsonb_build_object(
            'period_month', new.period_month,
            'employee_id', new.employee_id,
            'gross_salary', new.gross_salary,
            'advance_amount', new.advance_amount,
            'net_salary', new.net_salary,
            'original_payment_method_id', allocation.payment_method_id,
            'combined_payment', true
          )
        );
      end loop;
    else
      if new.payment_method_id is null then
        raise exception using errcode = '23514', message = 'Payment method is required to pay tracked payroll';
      end if;

      target_account_id := private.financial_cash_account_id(
        new.organization_id,
        new.payment_method_id
      );

      if target_account_id is null then
        raise exception using errcode = '23503', message = 'Payroll payment has no canonical financial account';
      end if;

      perform private.append_cash_movement(
        new.organization_id,
        target_account_id,
        'payroll',
        'debit',
        new.net_salary,
        'payroll_settlement',
        new.id,
        null,
        null,
        'payroll:' || new.id::text,
        'Pago de sueldo',
        private.cash_date_at_noon(new.paid_at),
        new.paid_by,
        jsonb_build_object(
          'period_month', new.period_month,
          'employee_id', new.employee_id,
          'gross_salary', new.gross_salary,
          'advance_amount', new.advance_amount,
          'net_salary', new.net_salary,
          'original_payment_method_id', new.payment_method_id,
          'combined_payment', false
        )
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_payroll_cash_movement()
  from public, anon, authenticated;

create or replace function public.mark_payroll_settlement_paid_with_payments(
  p_organization_id uuid,
  p_settlement_id uuid,
  p_paid_at date,
  p_payments jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_cash_admin(p_organization_id);
  settlement public.payroll_settlements%rowtype;
  payment_count integer := 0;
  distinct_payment_count integer := 0;
  single_method_id uuid;
  single_method_name text;
  payment_total numeric(14, 2) := 0;
begin
  if p_paid_at is null
    or p_paid_at > (now() at time zone 'America/Argentina/Buenos_Aires')::date
  then
    raise exception using errcode = '22007', message = 'Invalid payment date';
  end if;

  select * into settlement
  from public.payroll_settlements
  where id = p_settlement_id
    and organization_id = p_organization_id
  for update;

  if settlement.id is null then
    raise exception using errcode = 'P0002', message = 'Payroll settlement not found';
  end if;

  if settlement.status = 'paid' then
    return settlement.id;
  end if;

  if settlement.net_salary > 0 and not exists (
    select 1
    from public.cash_tracking_settings
    where organization_id = p_organization_id
  ) then
    raise exception using errcode = '55000', message = 'Cash tracking must be configured before paying payroll';
  end if;

  if jsonb_typeof(p_payments) <> 'array'
    or jsonb_array_length(p_payments) > 20
    or (settlement.net_salary > 0 and jsonb_array_length(p_payments) = 0)
    or (settlement.net_salary = 0 and jsonb_array_length(p_payments) <> 0)
  then
    raise exception using errcode = '22023', message = 'Payroll payment allocations are invalid';
  end if;

  if jsonb_array_length(p_payments) > 0 then
    select
      count(*),
      count(distinct payment.payment_method_id),
      round(sum(payment.amount), 2),
      (array_agg(payment.payment_method_id))[1]
    into payment_count, distinct_payment_count, payment_total, single_method_id
    from jsonb_to_recordset(p_payments)
      as payment(payment_method_id uuid, amount numeric);

    if payment_count <> jsonb_array_length(p_payments)
      or payment_count <> distinct_payment_count
      or exists (
        select 1
        from jsonb_to_recordset(p_payments)
          as payment(payment_method_id uuid, amount numeric)
        left join public.payment_methods as method
          on method.id = payment.payment_method_id
         and method.organization_id = p_organization_id
         and method.is_active
        where method.id is null
          or payment.amount is null
          or payment.amount <= 0
          or payment.amount > 999999999
      )
    then
      raise exception using errcode = '22023', message = 'Payroll payment allocations are invalid or duplicated';
    end if;
  end if;

  if payment_total is distinct from round(settlement.net_salary, 2) then
    raise exception using errcode = '23514', message = 'Payroll payment allocations must equal the exact net salary';
  end if;

  if payment_count = 1 then
    select name into single_method_name
    from public.payment_methods
    where id = single_method_id
      and organization_id = p_organization_id;
  end if;

  if payment_count > 0 then
    perform set_config('morita.payroll_payment_write', 'append', true);

    insert into public.payroll_settlement_payments (
      organization_id,
      settlement_id,
      payment_method_id,
      amount,
      created_by
    )
    select
      p_organization_id,
      settlement.id,
      payment.payment_method_id,
      round(payment.amount, 2),
      actor_id
    from jsonb_to_recordset(p_payments)
      as payment(payment_method_id uuid, amount numeric);
  end if;

  perform set_config('morita.payroll_action', 'mark_paid', true);

  update public.payroll_settlements
  set status = 'paid',
      paid_at = p_paid_at,
      paid_by = actor_id,
      payment_method = case
        when payment_count = 0 then 'Sin saldo pendiente'
        when payment_count = 1 then single_method_name
        else 'Pago combinado'
      end,
      payment_method_id = case
        when payment_count = 1 then single_method_id
        else null
      end,
      notes = coalesce(nullif(trim(p_notes), ''), notes)
  where id = settlement.id;

  if settlement.net_salary > 0 then
    insert into public.payroll_movements (
      organization_id,
      employee_id,
      kind,
      amount,
      period_month,
      paid_at,
      notes,
      created_by,
      settlement_id
    ) values (
      settlement.organization_id,
      settlement.employee_id,
      'salary',
      settlement.net_salary,
      settlement.period_month,
      p_paid_at,
      'Liquidacion mensual neta',
      actor_id,
      settlement.id
    ) on conflict (settlement_id) where settlement_id is not null do nothing;
  end if;

  return settlement.id;
end;
$$;

revoke all on function public.mark_payroll_settlement_paid_with_payments(
  uuid, uuid, date, jsonb, text
) from public, anon;
grant execute on function public.mark_payroll_settlement_paid_with_payments(
  uuid, uuid, date, jsonb, text
) to authenticated, service_role;

create or replace function public.mark_payroll_settlement_paid_v2(
  p_organization_id uuid,
  p_settlement_id uuid,
  p_paid_at date,
  p_payment_method_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  settlement_total numeric(14, 2);
begin
  select net_salary into settlement_total
  from public.payroll_settlements
  where id = p_settlement_id
    and organization_id = p_organization_id;

  return public.mark_payroll_settlement_paid_with_payments(
    p_organization_id,
    p_settlement_id,
    p_paid_at,
    case
      when settlement_total = 0 then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'payment_method_id', p_payment_method_id,
        'amount', settlement_total
      ))
    end,
    p_notes
  );
end;
$$;

revoke all on function public.mark_payroll_settlement_paid_v2(
  uuid, uuid, date, uuid, text
) from public, anon;
grant execute on function public.mark_payroll_settlement_paid_v2(
  uuid, uuid, date, uuid, text
) to authenticated, service_role;

create or replace function public.mark_payroll_settlement_paid(
  p_organization_id uuid,
  p_settlement_id uuid,
  p_paid_at date,
  p_payment_method text,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_method_id uuid;
  settlement_total numeric(14, 2);
begin
  select settlement.net_salary into settlement_total
  from public.payroll_settlements as settlement
  where settlement.id = p_settlement_id
    and settlement.organization_id = p_organization_id;

  if settlement_total > 0 then
    select method.id into target_method_id
    from public.payment_methods as method
    where method.organization_id = p_organization_id
      and method.is_active
      and lower(trim(method.name)) = lower(trim(p_payment_method))
    order by method.sort_order, method.id
    limit 1;

    if target_method_id is null then
      raise exception using errcode = 'P0002', message = 'Payment method not found';
    end if;
  end if;

  return public.mark_payroll_settlement_paid_with_payments(
    p_organization_id,
    p_settlement_id,
    p_paid_at,
    case
      when settlement_total = 0 then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'payment_method_id', target_method_id,
        'amount', settlement_total
      ))
    end,
    p_notes
  );
end;
$$;

revoke all on function public.mark_payroll_settlement_paid(
  uuid, uuid, date, text, text
) from public, anon;
grant execute on function public.mark_payroll_settlement_paid(
  uuid, uuid, date, text, text
) to authenticated, service_role;
