create or replace function private.guard_cash_method_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active and exists (
    select 1 from public.cash_accounts as account
    where account.organization_id = old.organization_id
      and account.payment_method_id = old.id
      and account.current_balance <> 0
  ) then
    raise exception using errcode = '23514', message = 'Transfer or reconcile the remaining cash balance before deactivating this payment method';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_cash_method_deactivation() from public, anon, authenticated;

create trigger guard_cash_method_deactivation
before update of is_active on public.payment_methods
for each row execute function private.guard_cash_method_deactivation();

create or replace function private.apply_expense_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  target_account_id uuid;
  state_key text;
begin
  select tracking_started_at into cutoff from public.cash_tracking_settings
  where organization_id = new.organization_id;
  if cutoff is null then return new; end if;

  if tg_op = 'INSERT' and new.status = 'posted' then
    if private.cash_date_at_noon(new.expense_date) < cutoff then return new; end if;
    if new.payment_method_id is null then
      raise exception using errcode = '23514', message = 'Payment method is required for tracked expenses';
    end if;
    select id into target_account_id from public.cash_accounts
    where organization_id = new.organization_id and payment_method_id = new.payment_method_id;
    perform private.append_cash_movement(
      new.organization_id, target_account_id, 'expense', 'debit', new.amount,
      'expense', new.id, null, null, 'expense:' || new.id::text || ':initial',
      new.description, private.cash_date_at_noon(new.expense_date), new.created_by, '{}'
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'posted' and new.status = 'cancelled' then
    if coalesce(new.cancelled_at, now()) < cutoff or old.payment_method_id is null then return new; end if;
    select id into target_account_id from public.cash_accounts
    where organization_id = old.organization_id and payment_method_id = old.payment_method_id;
    perform private.append_cash_movement(
      old.organization_id, target_account_id, 'expense_reversal', 'credit', old.amount,
      'expense', old.id, null, null, 'expense-reversal:' || old.id::text,
      'Anulacion de gasto: ' || old.description, coalesce(new.cancelled_at, now()), new.cancelled_by,
      jsonb_build_object('reason', new.cancellation_reason)
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'posted' and new.status = 'posted'
    and (old.amount, old.expense_date, old.payment_method_id, old.description)
      is distinct from (new.amount, new.expense_date, new.payment_method_id, new.description) then
    state_key := md5(concat_ws('|', new.amount, new.expense_date, new.payment_method_id, new.description, clock_timestamp(), txid_current()));
    if private.cash_date_at_noon(old.expense_date) >= cutoff and old.payment_method_id is not null then
      select id into target_account_id from public.cash_accounts
      where organization_id = old.organization_id and payment_method_id = old.payment_method_id;
      perform private.append_cash_movement(
        old.organization_id, target_account_id, 'expense_reversal', 'credit', old.amount,
        'expense', old.id, null, null, 'expense-correction-out:' || old.id::text || ':' || state_key,
        'Correccion de gasto: ' || old.description, now(), (select auth.uid()), '{}'
      );
    end if;
    if private.cash_date_at_noon(new.expense_date) >= cutoff then
      if new.payment_method_id is null then
        raise exception using errcode = '23514', message = 'Payment method is required for tracked expenses';
      end if;
      select id into target_account_id from public.cash_accounts
      where organization_id = new.organization_id and payment_method_id = new.payment_method_id;
      perform private.append_cash_movement(
        new.organization_id, target_account_id, 'expense', 'debit', new.amount,
        'expense', new.id, null, null, 'expense-correction-in:' || new.id::text || ':' || state_key,
        new.description, now(), (select auth.uid()), jsonb_build_object('corrected', true)
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_expense_cash_movement() from public, anon, authenticated;

comment on function private.guard_cash_method_deactivation() is
  'Prevents hidden availability by requiring a zero balance before a tracked payment method is deactivated.';
