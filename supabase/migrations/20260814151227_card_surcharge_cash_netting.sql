create or replace function public.initialize_cash_tracking(
  p_organization_id uuid,
  p_tracking_started_at timestamptz,
  p_balances jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_cash_admin(p_organization_id);
  expected_count integer;
  supplied_count integer;
  entry record;
  target_account_id uuid;
  sale_row record;
  expense_row record;
  payroll_row record;
begin
  if p_tracking_started_at is null or p_tracking_started_at > now() + interval '1 minute' then
    raise exception using errcode = '22007', message = 'Invalid cash tracking start date';
  end if;
  if jsonb_typeof(p_balances) <> 'array' then
    raise exception using errcode = '22023', message = 'Initial balances must be an array';
  end if;
  if exists (select 1 from public.cash_tracking_settings where organization_id = p_organization_id) then
    raise exception using errcode = '23505', message = 'Cash tracking is already configured';
  end if;

  select count(*) into expected_count
  from public.payment_methods
  where organization_id = p_organization_id and is_active;

  select count(*), count(distinct payment_method_id)
  into supplied_count, expected_count
  from jsonb_to_recordset(p_balances) as balance(payment_method_id uuid, amount numeric)
  where amount is not null and amount >= 0;

  if supplied_count <> expected_count or supplied_count <> (
    select count(*) from public.payment_methods
    where organization_id = p_organization_id and is_active
  ) or exists (
    select 1
    from jsonb_to_recordset(p_balances) as balance(payment_method_id uuid, amount numeric)
    left join public.payment_methods as method
      on method.id = balance.payment_method_id
     and method.organization_id = p_organization_id
     and method.is_active
    where method.id is null or balance.amount is null or balance.amount < 0
  ) then
    raise exception using errcode = '22023', message = 'Provide one valid balance for every active payment method';
  end if;

  if exists (
    select 1 from public.sales as sale
    where sale.organization_id = p_organization_id
      and sale.status = 'completed'
      and sale.occurred_at >= p_tracking_started_at
      and not exists (select 1 from public.sale_payments as payment where payment.sale_id = sale.id)
  ) then
    raise exception using errcode = '23514', message = 'A sale after the cutoff has no payment allocation';
  end if;
  if exists (
    select 1 from public.expenses
    where organization_id = p_organization_id and status = 'posted'
      and private.cash_date_at_noon(expense_date) >= p_tracking_started_at
      and payment_method_id is null
  ) then
    raise exception using errcode = '23514', message = 'An expense after the cutoff has no payment method';
  end if;
  if exists (
    select 1 from public.payroll_settlements
    where organization_id = p_organization_id and status = 'paid'
      and private.cash_date_at_noon(paid_at) >= p_tracking_started_at
      and payment_method_id is null
  ) then
    raise exception using errcode = '23514', message = 'A paid payroll after the cutoff has no payment method';
  end if;

  perform set_config('morita.cash_settings_write', 'initialize', true);
  insert into public.cash_tracking_settings (
    organization_id, tracking_started_at, initialized_by
  ) values (p_organization_id, p_tracking_started_at, actor_id);

  for entry in
    select method.id as payment_method_id, balance.amount
    from jsonb_to_recordset(p_balances) as balance(payment_method_id uuid, amount numeric)
    join public.payment_methods as method
      on method.id = balance.payment_method_id
     and method.organization_id = p_organization_id
     and method.is_active
    order by method.sort_order, method.name
  loop
    perform set_config('morita.cash_account_write', 'sync', true);
    insert into public.cash_accounts (organization_id, payment_method_id)
    values (p_organization_id, entry.payment_method_id)
    returning id into target_account_id;

    perform private.append_cash_movement(
      p_organization_id, target_account_id, 'initial_balance', 'credit', entry.amount,
      'cash_tracking_settings', p_organization_id, null, null,
      'initial:' || entry.payment_method_id::text,
      'Saldo inicial al comenzar el seguimiento de caja',
      p_tracking_started_at, actor_id,
      jsonb_build_object('cutoff', p_tracking_started_at)
    );
  end loop;

  for sale_row in
    select
      sale.id,
      sale.occurred_at,
      sale.created_by,
      payment.payment_method_id,
      payment.base_amount,
      payment.amount as charged_amount,
      payment.card_type,
      payment.surcharge_percentage,
      payment.surcharge_amount
    from public.sales as sale
    join public.sale_payments as payment on payment.sale_id = sale.id
    where sale.organization_id = p_organization_id
      and sale.status = 'completed'
      and sale.occurred_at >= p_tracking_started_at
    order by sale.occurred_at, sale.id
  loop
    select id into target_account_id from public.cash_accounts
    where organization_id = p_organization_id and payment_method_id = sale_row.payment_method_id;
    perform private.append_cash_movement(
      p_organization_id, target_account_id, 'sale', 'credit', sale_row.base_amount,
      'sale', sale_row.id, null, null,
      'sale:' || sale_row.id::text || ':' || sale_row.payment_method_id::text,
      'Ingreso por venta', sale_row.occurred_at, coalesce(sale_row.created_by, actor_id),
      jsonb_strip_nulls(jsonb_build_object(
        'charged_amount', sale_row.charged_amount,
        'card_type', sale_row.card_type,
        'surcharge_percentage', sale_row.surcharge_percentage,
        'surcharge_amount', sale_row.surcharge_amount
      ))
    );
  end loop;

  for expense_row in
    select id, description, amount, expense_date, payment_method_id, created_by
    from public.expenses
    where organization_id = p_organization_id and status = 'posted'
      and private.cash_date_at_noon(expense_date) >= p_tracking_started_at
    order by expense_date, id
  loop
    select id into target_account_id from public.cash_accounts
    where organization_id = p_organization_id and payment_method_id = expense_row.payment_method_id;
    perform private.append_cash_movement(
      p_organization_id, target_account_id, 'expense', 'debit', expense_row.amount,
      'expense', expense_row.id, null, null,
      'expense:' || expense_row.id::text || ':initial',
      expense_row.description, private.cash_date_at_noon(expense_row.expense_date),
      coalesce(expense_row.created_by, actor_id), '{}'
    );
  end loop;

  for payroll_row in
    select id, gross_salary, paid_at, payment_method_id, paid_by
    from public.payroll_settlements
    where organization_id = p_organization_id and status = 'paid'
      and private.cash_date_at_noon(paid_at) >= p_tracking_started_at
    order by paid_at, id
  loop
    select id into target_account_id from public.cash_accounts
    where organization_id = p_organization_id and payment_method_id = payroll_row.payment_method_id;
    perform private.append_cash_movement(
      p_organization_id, target_account_id, 'payroll', 'debit', payroll_row.gross_salary,
      'payroll_settlement', payroll_row.id, null, null,
      'payroll:' || payroll_row.id::text,
      'Pago de sueldo', private.cash_date_at_noon(payroll_row.paid_at),
      coalesce(payroll_row.paid_by, actor_id), '{}'
    );
  end loop;

  return jsonb_build_object(
    'tracking_started_at', p_tracking_started_at,
    'account_count', supplied_count,
    'total_balance', (select coalesce(sum(current_balance), 0) from public.cash_accounts where organization_id = p_organization_id)
  );
end;
$$;

revoke all on function public.initialize_cash_tracking(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.initialize_cash_tracking(uuid, timestamptz, jsonb) to authenticated, service_role;

create or replace function private.apply_sale_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  payment record;
  target_account_id uuid;
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if not exists (select 1 from public.sale_payments where sale_id = new.id) and new.payment_method_id is not null then
      perform set_config('morita.sale_payment_write', 'append', true);
      insert into public.sale_payments (
        organization_id, sale_id, payment_method_id, amount, base_amount
      )
      values (new.organization_id, new.id, new.payment_method_id, new.total, new.total)
      on conflict (sale_id, payment_method_id) do nothing;
    end if;

    select tracking_started_at into cutoff from public.cash_tracking_settings
    where organization_id = new.organization_id;
    if cutoff is null or new.occurred_at < cutoff then return new; end if;

    for payment in select * from public.sale_payments where sale_id = new.id loop
      select id into target_account_id from public.cash_accounts
      where organization_id = new.organization_id and payment_method_id = payment.payment_method_id;
      if target_account_id is null then
        raise exception using errcode = '23503', message = 'Sale payment has no cash account';
      end if;
      perform private.append_cash_movement(
        new.organization_id, target_account_id, 'sale', 'credit', payment.base_amount,
        'sale', new.id, null, null,
        'sale:' || new.id::text || ':' || payment.payment_method_id::text,
        'Ingreso por venta', new.occurred_at, new.created_by,
        jsonb_strip_nulls(jsonb_build_object(
          'charged_amount', payment.amount,
          'card_type', payment.card_type,
          'surcharge_percentage', payment.surcharge_percentage,
          'surcharge_amount', payment.surcharge_amount
        ))
      );
    end loop;
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status = 'cancelled' then
    select tracking_started_at into cutoff from public.cash_tracking_settings
    where organization_id = new.organization_id;
    if cutoff is null or coalesce(new.cancelled_at, now()) < cutoff then return new; end if;
    for payment in select * from public.sale_payments where sale_id = new.id loop
      select id into target_account_id from public.cash_accounts
      where organization_id = new.organization_id and payment_method_id = payment.payment_method_id;
      perform private.append_cash_movement(
        new.organization_id, target_account_id, 'sale_reversal', 'debit', payment.base_amount,
        'sale', new.id, null, null,
        'sale-reversal:' || new.id::text || ':' || payment.payment_method_id::text,
        'Anulacion de venta', coalesce(new.cancelled_at, now()), new.cancelled_by,
        jsonb_build_object(
          'reason', new.cancellation_reason,
          'charged_amount', payment.amount,
          'surcharge_amount', payment.surcharge_amount
        )
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_sale_cash_movement() from public, anon, authenticated;

-- Correct any completed card sales recorded between the first card deployment
-- and this clarification without rewriting the immutable ledger.
do $$
declare
  retained record;
begin
  for retained in
    select distinct
      sale.organization_id,
      sale.id as sale_id,
      sale.created_by,
      account.id as cash_account_id,
      payment.payment_method_id,
      payment.base_amount,
      payment.amount as charged_amount,
      payment.card_type,
      payment.surcharge_percentage,
      payment.surcharge_amount
    from public.sales as sale
    join public.sale_payments as payment
      on payment.sale_id = sale.id
     and payment.organization_id = sale.organization_id
    join public.cash_accounts as account
      on account.organization_id = payment.organization_id
     and account.payment_method_id = payment.payment_method_id
    join public.cash_movements as movement
      on movement.organization_id = sale.organization_id
     and movement.cash_account_id = account.id
     and movement.reference_type = 'sale'
     and movement.reference_id = sale.id
     and movement.type = 'sale'
     and movement.direction = 'credit'
    where sale.status = 'completed'
      and payment.card_type is not null
      and payment.surcharge_amount > 0
  loop
    perform private.append_cash_movement(
      retained.organization_id,
      retained.cash_account_id,
      'adjustment',
      'debit',
      retained.surcharge_amount,
      'sale_card_retention',
      retained.sale_id,
      null,
      null,
      'sale-card-retention:' || retained.sale_id::text || ':' || retained.payment_method_id::text,
      'Recargo de tarjeta no acreditado',
      now(),
      retained.created_by,
      jsonb_build_object(
        'base_amount', retained.base_amount,
        'charged_amount', retained.charged_amount,
        'card_type', retained.card_type,
        'surcharge_percentage', retained.surcharge_percentage,
        'surcharge_amount', retained.surcharge_amount
      )
    );
  end loop;
end;
$$;

comment on function private.apply_sale_cash_movement() is
  'Credits and reverses only the base payment allocation. Card surcharges remain a customer charge preview and never increase available cash.';
