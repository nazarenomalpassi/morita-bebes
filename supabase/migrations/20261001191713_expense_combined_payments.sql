alter table public.expenses
  add column payment_allocations jsonb not null default '[]'::jsonb,
  add constraint expenses_payment_allocations_array_check
    check (jsonb_typeof(payment_allocations) = 'array');

comment on column public.expenses.payment_allocations is
  'Payment allocation for one expense. Empty arrays preserve legacy single-method records; the exact sum is validated before writing.';

create function private.guard_expense_payment_allocations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  payment_count integer;
  distinct_count integer;
  payment_total numeric;
  single_method_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.status = 'cancelled' then
      if new.payment_allocations is distinct from old.payment_allocations then
        raise exception using errcode = '42501', message = 'Cancel an expense without changing its original data';
      end if;
      return new;
    end if;
    if (new.payment_allocations, new.amount, new.payment_method_id)
      is not distinct from (old.payment_allocations, old.amount, old.payment_method_id) then
      return new;
    end if;
  end if;

  if jsonb_typeof(new.payment_allocations) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Expense payment allocations must be an array';
  end if;
  if jsonb_array_length(new.payment_allocations) = 0 then return new; end if;
  if jsonb_array_length(new.payment_allocations) > 20 or exists (
    select 1 from jsonb_array_elements(new.payment_allocations) as entry(value)
    where jsonb_typeof(entry.value) is distinct from 'object'
      or jsonb_typeof(entry.value->'amount') is distinct from 'number'
      or jsonb_typeof(entry.value->'payment_method_id') is distinct from 'string'
  ) then
    raise exception using errcode = '22023', message = 'Expense payment allocations are invalid';
  end if;

  select count(*), count(distinct payment.payment_method_id), sum(payment.amount),
    (array_agg(payment.payment_method_id))[1]
  into payment_count, distinct_count, payment_total, single_method_id
  from jsonb_to_recordset(new.payment_allocations)
    as payment(payment_method_id uuid, amount numeric);

  if payment_count <> distinct_count or exists (
    select 1
    from jsonb_to_recordset(new.payment_allocations)
      as payment(payment_method_id uuid, amount numeric)
    left join public.payment_methods as method
      on method.id = payment.payment_method_id
      and method.organization_id = new.organization_id
      and method.is_active
    where method.id is null or payment.amount is null
      or payment.amount <= 0 or payment.amount > 999999999
      or payment.amount <> round(payment.amount, 2)
  ) then
    raise exception using errcode = '22023', message = 'Expense payment allocations are invalid, inactive or duplicated';
  end if;
  if payment_total is distinct from new.amount then
    raise exception using errcode = '23514', message = 'Expense payment allocations must equal the exact expense total';
  end if;
  if new.payment_method_id is distinct from (case when payment_count = 1 then single_method_id else null end) then
    raise exception using errcode = '23514', message = 'Expense payment allocations do not match the primary method';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_expense_payment_allocations() from public, anon, authenticated;
create trigger guard_expense_payment_allocations
before insert or update on public.expenses
for each row execute function private.guard_expense_payment_allocations();

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

  -- Keep correction/refund account locks in a consistent order.
  perform account.id from public.cash_accounts as account
  where account.organization_id = new.organization_id
  order by account.id for update;

  if tg_op = 'UPDATE' then
    cancellation := old.status = 'posted' and new.status = 'cancelled';
    correction := old.status = 'posted' and new.status = 'posted'
      and (old.amount, old.expense_date, old.payment_method_id, old.payment_allocations, old.description)
        is distinct from (new.amount, new.expense_date, new.payment_method_id, new.payment_allocations, new.description);
    if not cancellation and not correction then return new; end if;
    state_key := case when cancellation then 'cancelled' else gen_random_uuid()::text end;
    cash_occurred_at := coalesce(new.cancelled_at, clock_timestamp());

    -- Reverse only cash that was actually posted, including legacy accounts.
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
  elsif new.status <> 'posted' then
    return new;
  end if;

  expense_occurred_at := private.cash_date_at_noon(new.expense_date);
  if expense_occurred_at < cutoff then return new; end if;
  select exists (
    select 1 from public.daily_cash_closures as closure
    where closure.organization_id = new.organization_id and closure.business_date = new.expense_date
  ) into recorded_after_closure;
  cash_occurred_at := case when correction or recorded_after_closure
    then clock_timestamp() else expense_occurred_at end;

  allocations := case when jsonb_array_length(new.payment_allocations) > 0 then new.payment_allocations
    when new.payment_method_id is not null then jsonb_build_array(jsonb_build_object(
      'payment_method_id', new.payment_method_id, 'amount', new.amount))
    else '[]'::jsonb end;
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
        'expense_date', new.expense_date,
        'cash_business_date', private.cash_business_date(cash_occurred_at),
        'recorded_after_closure', recorded_after_closure,
        'original_payment_method_id', allocation.payment_method_id,
        'combined_payment', jsonb_array_length(allocations) > 1,
        'corrected', correction
      )
    );
  end loop;
  return new;
end;
$$;

revoke all on function private.apply_expense_cash_movement() from public, anon, authenticated;
comment on function private.apply_expense_cash_movement() is
  'Atomically posts expense allocations to canonical cash accounts and reverses actual ledger entries on correction or cancellation. Closed snapshots remain immutable.';

notify pgrst, 'reload schema';
