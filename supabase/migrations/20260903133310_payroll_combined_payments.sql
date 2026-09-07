alter table public.payroll_settlements
  add constraint payroll_settlements_id_organization_key
  unique (id, organization_id);

create table public.payroll_settlement_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  settlement_id uuid not null,
  payment_method_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint payroll_settlement_payments_settlement_fk
    foreign key (settlement_id, organization_id)
    references public.payroll_settlements(id, organization_id) on delete restrict,
  constraint payroll_settlement_payments_method_fk
    foreign key (payment_method_id, organization_id)
    references public.payment_methods(id, organization_id) on delete restrict,
  constraint payroll_settlement_payments_method_key
    unique (settlement_id, payment_method_id)
);

create index payroll_settlement_payments_org_settlement_idx
  on public.payroll_settlement_payments (organization_id, settlement_id);

comment on table public.payroll_settlement_payments is
  'Immutable payment allocation for a paid payroll settlement. Multiple rows represent a combined payment.';

create function private.guard_payroll_settlement_payment_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
    and current_setting('morita.payroll_payment_write', true) = 'append'
  then
    return new;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Payroll settlement payment allocations are immutable';
end;
$$;

revoke all on function private.guard_payroll_settlement_payment_write()
  from public, anon, authenticated;

create trigger payroll_settlement_payments_guard_write
before insert or update or delete on public.payroll_settlement_payments
for each row execute function private.guard_payroll_settlement_payment_write();

alter table public.payroll_settlement_payments enable row level security;

create policy "authorized users read payroll settlement payments"
on public.payroll_settlement_payments for select to authenticated
using (
  private.has_org_role(
    organization_id,
    array['owner', 'admin']::public.app_role[]
  )
  or (
    private.has_org_role(
      organization_id,
      array['staff']::public.app_role[]
    )
    and exists (
      select 1
      from public.payroll_settlements as settlement
      join public.employees as employee
        on employee.id = settlement.employee_id
       and employee.organization_id = settlement.organization_id
      where settlement.id = payroll_settlement_payments.settlement_id
        and settlement.organization_id = payroll_settlement_payments.organization_id
        and employee.user_id = (select auth.uid())
    )
  )
);

grant select on public.payroll_settlement_payments to authenticated;
grant all privileges on public.payroll_settlement_payments to service_role;

create trigger audit_payroll_settlement_payments
after insert or update or delete on public.payroll_settlement_payments
for each row execute function private.audit_row_change();

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
    select tracking_started_at into cutoff
    from public.cash_tracking_settings
    where organization_id = new.organization_id;

    if cutoff is null
      or private.cash_date_at_noon(new.paid_at) < cutoff
    then
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
          raise exception using
            errcode = '23503',
            message = 'Payroll payment has no canonical financial account';
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
            'original_payment_method_id', allocation.payment_method_id,
            'combined_payment', true
          )
        );
      end loop;
    else
      if new.payment_method_id is null then
        raise exception using
          errcode = '23514',
          message = 'Payment method is required to pay tracked payroll';
      end if;

      target_account_id := private.financial_cash_account_id(
        new.organization_id,
        new.payment_method_id
      );

      if target_account_id is null then
        raise exception using
          errcode = '23503',
          message = 'Payroll payment has no canonical financial account';
      end if;

      perform private.append_cash_movement(
        new.organization_id,
        target_account_id,
        'payroll',
        'debit',
        new.gross_salary,
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

create function public.mark_payroll_settlement_paid_with_payments(
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
  payment_count integer;
  distinct_payment_count integer;
  single_method_id uuid;
  single_method_name text;
  payment_total numeric(14, 2);
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

  if not exists (
    select 1
    from public.cash_tracking_settings
    where organization_id = p_organization_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'Cash tracking must be configured before paying payroll';
  end if;

  if jsonb_typeof(p_payments) <> 'array'
    or jsonb_array_length(p_payments) = 0
    or jsonb_array_length(p_payments) > 20
  then
    raise exception using
      errcode = '22023',
      message = 'Payroll payment allocations must be a non-empty array';
  end if;

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
    raise exception using
      errcode = '22023',
      message = 'Payroll payment allocations are invalid or duplicated';
  end if;

  if payment_total is distinct from round(settlement.gross_salary, 2) then
    raise exception using
      errcode = '23514',
      message = 'Payroll payment allocations must equal the exact settlement total';
  end if;

  if payment_count = 1 then
    select name into single_method_name
    from public.payment_methods
    where id = single_method_id
      and organization_id = p_organization_id;
  end if;

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

  perform set_config('morita.payroll_action', 'mark_paid', true);

  update public.payroll_settlements
  set status = 'paid',
      paid_at = p_paid_at,
      paid_by = actor_id,
      payment_method = case
        when payment_count = 1 then single_method_name
        else 'Pago combinado'
      end,
      payment_method_id = case
        when payment_count = 1 then single_method_id
        else null
      end,
      notes = coalesce(nullif(trim(p_notes), ''), notes)
  where id = settlement.id;

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
    settlement.gross_salary,
    settlement.period_month,
    p_paid_at,
    'Liquidacion mensual automatica',
    actor_id,
    settlement.id
  ) on conflict (settlement_id) where settlement_id is not null do nothing;

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
  select gross_salary into settlement_total
  from public.payroll_settlements
  where id = p_settlement_id
    and organization_id = p_organization_id;

  return public.mark_payroll_settlement_paid_with_payments(
    p_organization_id,
    p_settlement_id,
    p_paid_at,
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', p_payment_method_id,
      'amount', settlement_total
    )),
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
