create or replace function private.apply_expense_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  target_account_id uuid;
  state_key text := 'initial';
  expense_occurred_at timestamptz;
  cash_occurred_at timestamptz;
  recorded_after_closure boolean := false;
  correction boolean := false;
  cancellation boolean := false;
  allocation record;
  outstanding record;
  allocations jsonb;
begin
  select tracking_started_at into cutoff from public.cash_tracking_settings
  where organization_id = new.organization_id;
  if cutoff is null then return new; end if;
  perform account.id from public.cash_accounts as account
  where account.organization_id = new.organization_id order by account.id for update;

  if tg_op = 'UPDATE' then
    cancellation := old.status = 'posted' and new.status = 'cancelled';
    correction := old.status = 'posted' and new.status = 'posted'
      and (old.amount, old.expense_date, old.payment_method_id, old.payment_allocations, old.description)
        is distinct from (new.amount, new.expense_date, new.payment_method_id, new.payment_allocations, new.description);
    if not cancellation and not correction then return new; end if;
    state_key := case when cancellation then 'cancelled' else gen_random_uuid()::text end;
    cash_occurred_at := coalesce(new.cancelled_at, clock_timestamp());
    for outstanding in
      select movement.cash_account_id,
        sum(case when movement.direction = 'debit' then movement.amount else -movement.amount end) as amount
      from public.cash_movements as movement
      where movement.organization_id = old.organization_id
        and movement.reference_type = 'expense' and movement.reference_id = old.id
      group by movement.cash_account_id
      having sum(case when movement.direction = 'debit' then movement.amount else -movement.amount end) > 0
      order by movement.cash_account_id
    loop
      perform private.append_cash_movement(
        old.organization_id, outstanding.cash_account_id, 'expense_reversal', 'credit', outstanding.amount,
        'expense', old.id, null, null,
        'expense-reversal:' || old.id::text || ':' || outstanding.cash_account_id::text || ':' || state_key,
        case when cancellation then 'Anulacion de gasto: ' else 'Correccion de gasto: ' end || old.description,
        cash_occurred_at, coalesce(new.cancelled_by, (select auth.uid())),
        jsonb_build_object('reason', new.cancellation_reason, 'corrected', correction)
      );
    end loop;
    if cancellation then return new; end if;
  elsif new.status <> 'posted' then return new;
  end if;

  expense_occurred_at := private.cash_date_at_noon(new.expense_date);
  -- Expenses have a date, not a time. Include the whole initial calendar day,
  -- even when tracking was initialized later than the synthetic noon timestamp.
  if new.expense_date < (cutoff at time zone 'America/Argentina/Cordoba')::date then return new; end if;
  select exists (
    select 1 from public.daily_cash_closures as closure
    where closure.organization_id = new.organization_id and closure.business_date = new.expense_date
  ) into recorded_after_closure;
  cash_occurred_at := case when correction or recorded_after_closure
    then clock_timestamp() else greatest(expense_occurred_at, cutoff) end;

  allocations := case when jsonb_array_length(new.payment_allocations) > 0 then new.payment_allocations
    when new.payment_method_id is not null then jsonb_build_array(jsonb_build_object(
      'payment_method_id', new.payment_method_id, 'amount', new.amount)) else '[]'::jsonb end;
  if jsonb_array_length(allocations) = 0 then
    raise exception using errcode = '23514', message = 'Payment method is required for tracked expenses';
  end if;
  for allocation in
    select payment.payment_method_id, payment.amount,
      private.financial_cash_account_id(new.organization_id, payment.payment_method_id) as account_id
    from jsonb_to_recordset(allocations) as payment(payment_method_id uuid, amount numeric)
    order by account_id, payment.payment_method_id
  loop
    target_account_id := allocation.account_id;
    if target_account_id is null then
      raise exception using errcode = '23503', message = 'Expense payment allocations have no financial account';
    end if;
    perform private.append_cash_movement(
      new.organization_id, target_account_id, 'expense', 'debit', allocation.amount,
      'expense', new.id, null, null,
      'expense:' || new.id::text || ':' || state_key || ':' || allocation.payment_method_id::text,
      new.description, cash_occurred_at, coalesce((select auth.uid()), new.created_by),
      jsonb_build_object(
        'expense_date', new.expense_date, 'cash_business_date', private.cash_business_date(cash_occurred_at),
        'recorded_after_closure', recorded_after_closure, 'original_payment_method_id', allocation.payment_method_id,
        'combined_payment', jsonb_array_length(allocations) > 1, 'corrected', correction
      )
    );
  end loop;
  return new;
end;
$$;
revoke all on function private.apply_expense_cash_movement() from public, anon, authenticated;

create or replace function private.apply_personnel_advance_cash_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid;
  original public.cash_movements%rowtype;
  cutoff timestamptz;
begin
  if tg_op = 'INSERT' and new.kind = 'advance'
    and new.payment_method_id is not null and new.expense_id is null then
    select tracking_started_at into cutoff from public.cash_tracking_settings
    where organization_id = new.organization_id;
    if cutoff is null or new.paid_at < (cutoff at time zone 'America/Argentina/Cordoba')::date then
      raise exception using errcode = '55000', message = 'Cash tracking is required for salary advances';
    end if;
    account_id := private.financial_cash_account_id(new.organization_id, new.payment_method_id);
    if account_id is null then
      raise exception using errcode = '23503', message = 'Payment method has no cash account';
    end if;
    perform private.append_cash_movement(
      new.organization_id, account_id, 'payroll', 'debit', new.amount,
      'payroll_advance', new.id, null, null, 'payroll-advance:' || new.id::text,
      'Adelanto de sueldo', greatest(private.cash_date_at_noon(new.paid_at), cutoff), new.created_by,
      jsonb_build_object('employee_id', new.employee_id, 'period_month', new.period_month, 'concept', 'advance')
    );
  elsif tg_op = 'UPDATE' and old.voided_at is null and new.voided_at is not null
    and old.kind = 'advance' and old.payment_method_id is not null then
    select * into original from public.cash_movements
    where organization_id = old.organization_id and reference_type = 'payroll_advance'
      and reference_id = old.id and type = 'payroll' and direction = 'debit'
    order by created_at limit 1;
    if original.id is null then
      raise exception using errcode = 'P0002', message = 'Original advance cash movement was not found';
    end if;
    perform private.append_cash_movement(
      old.organization_id, original.cash_account_id, 'adjustment', 'credit', old.amount,
      'payroll_advance', old.id, null, original.id, 'payroll-advance-void:' || old.id::text,
      'Anulacion de adelanto', new.voided_at, new.voided_by,
      jsonb_build_object('employee_id', old.employee_id, 'period_month', old.period_month,
        'concept', 'advance_void', 'reason', new.void_reason)
    );
  end if;
  return new;
end;
$$;
revoke all on function private.apply_personnel_advance_cash_movement() from public, anon, authenticated;

create or replace function private.apply_payroll_cash_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cutoff timestamptz;
  allocation record;
  target_account_id uuid;
  has_allocations boolean;
  cash_occurred_at timestamptz;
begin
  if old.status <> 'paid' and new.status = 'paid' then
    if new.net_salary = 0 then return new; end if;
    select tracking_started_at into cutoff from public.cash_tracking_settings
    where organization_id = new.organization_id;
    if cutoff is null or new.paid_at < (cutoff at time zone 'America/Argentina/Cordoba')::date then
      return new;
    end if;
    cash_occurred_at := greatest(private.cash_date_at_noon(new.paid_at), cutoff);
    select exists (select 1 from public.payroll_settlement_payments
      where settlement_id = new.id and organization_id = new.organization_id) into has_allocations;
    if has_allocations then
      for allocation in
        select payment.payment_method_id, payment.amount, method.name
        from public.payroll_settlement_payments as payment
        join public.payment_methods as method on method.id = payment.payment_method_id
          and method.organization_id = payment.organization_id
        where payment.settlement_id = new.id and payment.organization_id = new.organization_id
        order by method.sort_order, method.name, payment.id
      loop
        target_account_id := private.financial_cash_account_id(new.organization_id, allocation.payment_method_id);
        if target_account_id is null then
          raise exception using errcode = '23503', message = 'Payroll payment has no canonical financial account';
        end if;
        perform private.append_cash_movement(
          new.organization_id, target_account_id, 'payroll', 'debit', allocation.amount,
          'payroll_settlement', new.id, null, null,
          'payroll:' || new.id::text || ':' || allocation.payment_method_id::text,
          'Pago de sueldo - ' || allocation.name, cash_occurred_at, new.paid_by,
          jsonb_build_object('period_month', new.period_month, 'employee_id', new.employee_id,
            'gross_salary', new.gross_salary, 'advance_amount', new.advance_amount, 'net_salary', new.net_salary,
            'original_payment_method_id', allocation.payment_method_id, 'combined_payment', true)
        );
      end loop;
    else
      if new.payment_method_id is null then
        raise exception using errcode = '23514', message = 'Payment method is required to pay tracked payroll';
      end if;
      target_account_id := private.financial_cash_account_id(new.organization_id, new.payment_method_id);
      if target_account_id is null then
        raise exception using errcode = '23503', message = 'Payroll payment has no canonical financial account';
      end if;
      perform private.append_cash_movement(
        new.organization_id, target_account_id, 'payroll', 'debit', new.net_salary,
        'payroll_settlement', new.id, null, null, 'payroll:' || new.id::text,
        'Pago de sueldo', cash_occurred_at, new.paid_by,
        jsonb_build_object('period_month', new.period_month, 'employee_id', new.employee_id,
          'gross_salary', new.gross_salary, 'advance_amount', new.advance_amount, 'net_salary', new.net_salary,
          'original_payment_method_id', new.payment_method_id, 'combined_payment', false)
      );
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.apply_payroll_cash_movement() from public, anon, authenticated;
