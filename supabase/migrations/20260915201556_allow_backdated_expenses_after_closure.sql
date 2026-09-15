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
  expense_occurred_at timestamptz;
  cash_occurred_at timestamptz;
  recorded_after_closure boolean := false;
begin
  select tracking_started_at into cutoff from public.cash_tracking_settings
  where organization_id = new.organization_id;
  if cutoff is null then return new; end if;

  if tg_op = 'INSERT' and new.status = 'posted' then
    expense_occurred_at := private.cash_date_at_noon(new.expense_date);
    if expense_occurred_at < cutoff then return new; end if;
    if new.payment_method_id is null then
      raise exception using errcode = '23514', message = 'Payment method is required for tracked expenses';
    end if;

    select exists (
      select 1
      from public.daily_cash_closures as closure
      where closure.organization_id = new.organization_id
        and closure.business_date = new.expense_date
    ) into recorded_after_closure;

    cash_occurred_at := case
      when recorded_after_closure then clock_timestamp()
      else expense_occurred_at
    end;

    select id into target_account_id from public.cash_accounts
    where organization_id = new.organization_id and payment_method_id = new.payment_method_id;
    perform private.append_cash_movement(
      new.organization_id, target_account_id, 'expense', 'debit', new.amount,
      'expense', new.id, null, null, 'expense:' || new.id::text || ':initial',
      new.description, cash_occurred_at, new.created_by,
      jsonb_build_object(
        'expense_date', new.expense_date,
        'cash_business_date', private.cash_business_date(cash_occurred_at),
        'recorded_after_closure', recorded_after_closure
      )
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

comment on function private.apply_expense_cash_movement() is
  'Posts backdated expenses dated on an immutable closed day against the current open cash day while preserving the expense date and closure snapshot.';
