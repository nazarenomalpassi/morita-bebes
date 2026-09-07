create type public.cash_movement_type as enum (
  'initial_balance',
  'sale',
  'sale_reversal',
  'expense',
  'expense_reversal',
  'payroll',
  'transfer',
  'adjustment',
  'other_income',
  'other_expense'
);

create type public.cash_movement_direction as enum ('credit', 'debit');

create table public.cash_tracking_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  tracking_started_at timestamptz not null,
  initialized_at timestamptz not null default now(),
  initialized_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint cash_tracking_start_not_future_check check (tracking_started_at <= initialized_at + interval '1 minute')
);

create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payment_method_id uuid not null,
  current_balance numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_accounts_id_org_unique unique (id, organization_id),
  constraint cash_accounts_payment_method_fk foreign key (payment_method_id, organization_id)
    references public.payment_methods(id, organization_id) on delete restrict,
  constraint cash_accounts_payment_method_key unique (organization_id, payment_method_id)
);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  cash_account_id uuid not null,
  type public.cash_movement_type not null,
  direction public.cash_movement_direction not null,
  amount numeric(14, 2) not null,
  signed_amount numeric(14, 2) generated always as (
    case when direction = 'credit' then amount else -amount end
  ) stored,
  balance_before numeric(14, 2) not null,
  balance_after numeric(14, 2) not null,
  reference_type text,
  reference_id uuid,
  transfer_id uuid,
  reverses_movement_id uuid references public.cash_movements(id) on delete restrict,
  idempotency_key text not null,
  description text not null,
  occurred_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cash_movements_account_fk foreign key (cash_account_id, organization_id)
    references public.cash_accounts(id, organization_id) on delete restrict,
  constraint cash_movements_amount_check check (
    (type = 'initial_balance' and amount >= 0) or amount > 0
  ),
  constraint cash_movements_balance_check check (
    balance_after = balance_before + case when direction = 'credit' then amount else -amount end
  ),
  constraint cash_movements_direction_check check (
    (type in ('initial_balance', 'sale', 'expense_reversal', 'other_income') and direction = 'credit')
    or (type in ('sale_reversal', 'expense', 'payroll', 'other_expense') and direction = 'debit')
    or type in ('transfer', 'adjustment')
  ),
  constraint cash_movements_description_check check (char_length(trim(description)) between 2 and 240),
  constraint cash_movements_idempotency_key unique (organization_id, idempotency_key)
);

create index cash_accounts_org_payment_idx
  on public.cash_accounts (organization_id, payment_method_id);
create index cash_movements_account_occurred_idx
  on public.cash_movements (organization_id, cash_account_id, occurred_at desc, id desc);
create index cash_movements_org_occurred_idx
  on public.cash_movements (organization_id, occurred_at desc, id desc);
create index cash_movements_reference_idx
  on public.cash_movements (organization_id, reference_type, reference_id)
  where reference_id is not null;
create index cash_movements_transfer_idx
  on public.cash_movements (transfer_id)
  where transfer_id is not null;

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null,
  payment_method_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint sale_payments_sale_fk foreign key (sale_id, organization_id)
    references public.sales(id, organization_id) on delete cascade,
  constraint sale_payments_method_fk foreign key (payment_method_id, organization_id)
    references public.payment_methods(id, organization_id) on delete restrict,
  constraint sale_payments_method_key unique (sale_id, payment_method_id)
);

create index sale_payments_org_sale_idx on public.sale_payments (organization_id, sale_id);

-- Existing sales are normalized for receipts and future reversals. This does not
-- create cash movements; tracking starts only through initialize_cash_tracking.
insert into public.sale_payments (organization_id, sale_id, payment_method_id, amount)
select organization_id, id, payment_method_id, total
from public.sales
where payment_method_id is not null and total > 0
on conflict (sale_id, payment_method_id) do nothing;

alter table public.payroll_settlements
  add column payment_method_id uuid;

alter table public.payroll_settlements
  add constraint payroll_settlements_payment_method_fk
  foreign key (payment_method_id, organization_id)
  references public.payment_methods(id, organization_id) on delete restrict;

update public.payroll_settlements as settlement
set payment_method_id = method.id
from public.payment_methods as method
where settlement.organization_id = method.organization_id
  and settlement.payment_method_id is null
  and settlement.payment_method is not null
  and lower(trim(settlement.payment_method)) = lower(trim(method.name));

create or replace function private.cash_date_at_noon(target_date date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (target_date::timestamp + time '12:00') at time zone 'America/Argentina/Buenos_Aires'
$$;

revoke all on function private.cash_date_at_noon(date) from public, anon, authenticated;

create or replace function private.guard_cash_tracking_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and current_setting('morita.cash_settings_write', true) = 'initialize' then
    return new;
  end if;
  raise exception using errcode = '42501', message = 'Cash tracking settings are immutable';
end;
$$;

create trigger cash_tracking_settings_guard_write
before insert or update or delete on public.cash_tracking_settings
for each row execute function private.guard_cash_tracking_settings();

create or replace function private.guard_cash_account_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  operation text := current_setting('morita.cash_account_write', true);
begin
  if tg_op = 'INSERT' and operation = 'sync' then
    new.current_balance := 0;
    return new;
  end if;
  if tg_op = 'UPDATE' and operation = 'append' then
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.payment_method_id is distinct from old.payment_method_id
      or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'Cash account identity is immutable';
    end if;
    return new;
  end if;
  raise exception using errcode = '42501', message = 'Cash accounts are workflow-managed';
end;
$$;

create trigger cash_accounts_guard_write
before insert or update or delete on public.cash_accounts
for each row execute function private.guard_cash_account_write();

create or replace function private.guard_cash_movement_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and current_setting('morita.cash_movement_write', true) = 'append' then
    return new;
  end if;
  raise exception using errcode = '42501', message = 'Cash movements are immutable and must use the ledger workflow';
end;
$$;

create trigger cash_movements_guard_write
before insert or update or delete on public.cash_movements
for each row execute function private.guard_cash_movement_write();

create or replace function private.guard_sale_payment_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and current_setting('morita.sale_payment_write', true) = 'append' then
    if not exists (
      select 1 from public.sales as sale
      where sale.id = new.sale_id
        and sale.organization_id = new.organization_id
        and sale.status in ('draft', 'completed')
    ) then
      raise exception using errcode = '23503', message = 'Sale payment requires a valid sale';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' and session_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  raise exception using errcode = '42501', message = 'Sale payments are immutable';
end;
$$;

create trigger sale_payments_guard_write
before insert or update or delete on public.sale_payments
for each row execute function private.guard_sale_payment_write();

create or replace function private.append_cash_movement(
  p_organization_id uuid,
  p_cash_account_id uuid,
  p_type public.cash_movement_type,
  p_direction public.cash_movement_direction,
  p_amount numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_transfer_id uuid,
  p_reverses_movement_id uuid,
  p_idempotency_key text,
  p_description text,
  p_occurred_at timestamptz,
  p_created_by uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns public.cash_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_balance numeric(14, 2);
  next_balance numeric(14, 2);
  movement public.cash_movements%rowtype;
begin
  if p_amount is null
    or p_amount < 0
    or (p_amount = 0 and p_type <> 'initial_balance')
    or nullif(trim(p_idempotency_key), '') is null
    or nullif(trim(p_description), '') is null
    or p_occurred_at is null then
    raise exception using errcode = '22023', message = 'Invalid cash movement values';
  end if;

  select account.current_balance
  into prior_balance
  from public.cash_accounts as account
  where account.id = p_cash_account_id
    and account.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Cash account was not found';
  end if;

  next_balance := prior_balance + case when p_direction = 'credit' then p_amount else -p_amount end;
  perform set_config('morita.cash_movement_write', 'append', true);

  insert into public.cash_movements (
    organization_id, cash_account_id, type, direction, amount,
    balance_before, balance_after, reference_type, reference_id,
    transfer_id, reverses_movement_id, idempotency_key, description,
    occurred_at, created_by, metadata
  ) values (
    p_organization_id, p_cash_account_id, p_type, p_direction, round(p_amount, 2),
    prior_balance, round(next_balance, 2), nullif(trim(p_reference_type), ''), p_reference_id,
    p_transfer_id, p_reverses_movement_id, trim(p_idempotency_key), trim(p_description),
    p_occurred_at, p_created_by, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into movement;

  if movement.id is null then
    select * into movement
    from public.cash_movements
    where organization_id = p_organization_id
      and idempotency_key = trim(p_idempotency_key);

    if movement.cash_account_id is distinct from p_cash_account_id
      or movement.type is distinct from p_type
      or movement.direction is distinct from p_direction
      or movement.amount is distinct from round(p_amount, 2)
      or movement.reference_id is distinct from p_reference_id then
      raise exception using errcode = '23505', message = 'Cash idempotency key belongs to another movement';
    end if;
    return movement;
  end if;

  perform set_config('morita.cash_account_write', 'append', true);
  update public.cash_accounts
  set current_balance = movement.balance_after,
      updated_at = now()
  where id = p_cash_account_id and organization_id = p_organization_id;

  return movement;
end;
$$;

revoke all on function private.append_cash_movement(
  uuid, uuid, public.cash_movement_type, public.cash_movement_direction,
  numeric, text, uuid, uuid, uuid, text, text, timestamptz, uuid, jsonb
) from public, anon, authenticated;

create or replace function private.require_cash_admin(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not private.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  ) then
    raise exception using errcode = '42501', message = 'Administrator role is required';
  end if;
  return actor_id;
end;
$$;

revoke all on function private.require_cash_admin(uuid) from public, anon, authenticated;

create or replace function private.audit_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  method_name text;
begin
  select method.name into method_name
  from public.cash_accounts as account
  join public.payment_methods as method
    on method.id = account.payment_method_id
   and method.organization_id = account.organization_id
  where account.id = new.cash_account_id;

  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, metadata
  ) values (
    new.organization_id,
    new.created_by,
    'cash_' || new.type::text,
    'cash_movement',
    new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'description', new.description,
      'movement_type', new.type,
      'direction', new.direction,
      'amount', new.amount,
      'cash_account_id', new.cash_account_id,
      'payment_method', method_name,
      'balance_before', new.balance_before,
      'balance_after', new.balance_after,
      'reference_type', new.reference_type,
      'reference_id', new.reference_id,
      'transfer_id', new.transfer_id,
      'occurred_at', new.occurred_at,
      'movement_metadata', new.metadata
    ))
  );
  return new;
end;
$$;

revoke all on function private.audit_cash_movement() from public, anon, authenticated;

create trigger audit_cash_movement
after insert on public.cash_movements
for each row execute function private.audit_cash_movement();

create or replace function private.sync_cash_account_for_payment_method()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and exists (
    select 1 from public.cash_tracking_settings
    where organization_id = new.organization_id
  ) then
    perform set_config('morita.cash_account_write', 'sync', true);
    insert into public.cash_accounts (organization_id, payment_method_id)
    values (new.organization_id, new.id)
    on conflict (organization_id, payment_method_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_cash_account_for_payment_method() from public, anon, authenticated;

create trigger sync_cash_account_for_payment_method
after insert or update of is_active on public.payment_methods
for each row execute function private.sync_cash_account_for_payment_method();

alter table public.cash_tracking_settings enable row level security;
alter table public.cash_accounts enable row level security;
alter table public.cash_movements enable row level security;
alter table public.sale_payments enable row level security;

create policy "administrators read cash tracking settings"
on public.cash_tracking_settings for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "administrators read cash accounts"
on public.cash_accounts for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "administrators read cash movements"
on public.cash_movements for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "authorized members read sale payments"
on public.sale_payments for select to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  or exists (
    select 1 from public.sales as sale
    where sale.id = sale_payments.sale_id
      and sale.organization_id = sale_payments.organization_id
      and sale.created_by = (select auth.uid())
      and private.has_org_role(sale.organization_id, array['staff']::public.app_role[])
  )
);

revoke all on public.cash_tracking_settings, public.cash_accounts, public.cash_movements, public.sale_payments
from anon, authenticated;
grant select on public.cash_tracking_settings, public.cash_accounts, public.cash_movements, public.sale_payments
to authenticated, service_role;
grant all on public.cash_tracking_settings, public.cash_accounts, public.cash_movements, public.sale_payments
to service_role;

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
    select sale.id, sale.occurred_at, sale.created_by, payment.payment_method_id, payment.amount
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
      p_organization_id, target_account_id, 'sale', 'credit', sale_row.amount,
      'sale', sale_row.id, null, null,
      'sale:' || sale_row.id::text || ':' || sale_row.payment_method_id::text,
      'Ingreso por venta', sale_row.occurred_at, coalesce(sale_row.created_by, actor_id), '{}'
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

create or replace function public.transfer_cash(
  p_organization_id uuid,
  p_from_payment_method_id uuid,
  p_to_payment_method_id uuid,
  p_amount numeric,
  p_occurred_at timestamptz,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_cash_admin(p_organization_id);
  source_account_id uuid;
  destination_account_id uuid;
  transfer_value uuid := gen_random_uuid();
  effective_time timestamptz := coalesce(p_occurred_at, now());
begin
  if p_from_payment_method_id is null or p_to_payment_method_id is null
    or p_from_payment_method_id = p_to_payment_method_id
    or p_amount is null or p_amount <= 0 or p_amount > 999999999
    or nullif(trim(p_notes), '') is null then
    raise exception using errcode = '22023', message = 'Valid, different accounts, a positive amount and a reason are required';
  end if;
  if not exists (select 1 from public.cash_tracking_settings where organization_id = p_organization_id) then
    raise exception using errcode = '55000', message = 'Cash tracking is not configured';
  end if;

  select id into source_account_id from public.cash_accounts
  where organization_id = p_organization_id and payment_method_id = p_from_payment_method_id;
  select id into destination_account_id from public.cash_accounts
  where organization_id = p_organization_id and payment_method_id = p_to_payment_method_id;
  if source_account_id is null or destination_account_id is null then
    raise exception using errcode = '23503', message = 'Cash account was not found';
  end if;

  -- Deterministic lock order prevents opposite simultaneous transfers from deadlocking.
  perform 1 from public.cash_accounts
  where id in (source_account_id, destination_account_id)
  order by id for update;

  perform private.append_cash_movement(
    p_organization_id, source_account_id, 'transfer', 'debit', p_amount,
    'cash_transfer', transfer_value, transfer_value, null,
    'transfer:' || transfer_value::text || ':out',
    'Transferencia enviada: ' || trim(p_notes), effective_time, actor_id,
    jsonb_build_object('counterpart_account_id', destination_account_id)
  );
  perform private.append_cash_movement(
    p_organization_id, destination_account_id, 'transfer', 'credit', p_amount,
    'cash_transfer', transfer_value, transfer_value, null,
    'transfer:' || transfer_value::text || ':in',
    'Transferencia recibida: ' || trim(p_notes), effective_time, actor_id,
    jsonb_build_object('counterpart_account_id', source_account_id)
  );
  return transfer_value;
end;
$$;

create or replace function public.record_manual_cash_movement(
  p_organization_id uuid,
  p_payment_method_id uuid,
  p_direction public.cash_movement_direction,
  p_amount numeric,
  p_concept text,
  p_occurred_at timestamptz,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_cash_admin(p_organization_id);
  target_account_id uuid;
  movement_id uuid := gen_random_uuid();
  movement public.cash_movements%rowtype;
begin
  if p_direction is null or p_amount is null or p_amount <= 0 or p_amount > 999999999
    or nullif(trim(p_concept), '') is null or char_length(trim(p_concept)) > 160 then
    raise exception using errcode = '22023', message = 'Direction, positive amount and concept are required';
  end if;
  select id into target_account_id from public.cash_accounts
  where organization_id = p_organization_id and payment_method_id = p_payment_method_id;
  if target_account_id is null then
    raise exception using errcode = '23503', message = 'Cash account was not found';
  end if;
  select * into movement from private.append_cash_movement(
    p_organization_id, target_account_id,
    case when p_direction = 'credit' then 'other_income'::public.cash_movement_type else 'other_expense'::public.cash_movement_type end,
    p_direction, p_amount, 'manual_cash_movement', movement_id, null, null,
    'manual:' || movement_id::text,
    trim(p_concept), coalesce(p_occurred_at, now()), actor_id,
    jsonb_strip_nulls(jsonb_build_object('notes', nullif(trim(p_notes), '')))
  );
  return movement.id;
end;
$$;

create or replace function public.reconcile_cash_account(
  p_organization_id uuid,
  p_payment_method_id uuid,
  p_counted_balance numeric,
  p_reason text,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_cash_admin(p_organization_id);
  target_account public.cash_accounts%rowtype;
  difference numeric(14, 2);
  adjustment_id uuid := gen_random_uuid();
  movement public.cash_movements%rowtype;
begin
  if p_counted_balance is null or p_counted_balance < -999999999 or p_counted_balance > 999999999
    or nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'A valid counted balance and reason are required';
  end if;
  select * into target_account from public.cash_accounts
  where organization_id = p_organization_id and payment_method_id = p_payment_method_id
  for update;
  if target_account.id is null then
    raise exception using errcode = '23503', message = 'Cash account was not found';
  end if;
  difference := round(p_counted_balance - target_account.current_balance, 2);
  if difference = 0 then
    return jsonb_build_object('movement_id', null, 'difference', 0, 'balance', target_account.current_balance);
  end if;
  select * into movement from private.append_cash_movement(
    p_organization_id, target_account.id, 'adjustment',
    case when difference > 0 then 'credit'::public.cash_movement_direction else 'debit'::public.cash_movement_direction end,
    abs(difference), 'cash_reconciliation', adjustment_id, null, null,
    'adjustment:' || adjustment_id::text,
    'Ajuste por control de caja: ' || trim(p_reason), coalesce(p_occurred_at, now()), actor_id,
    jsonb_build_object('counted_balance', round(p_counted_balance, 2), 'system_balance', target_account.current_balance)
  );
  return jsonb_build_object('movement_id', movement.id, 'difference', difference, 'balance', movement.balance_after);
end;
$$;

revoke all on function public.transfer_cash(uuid, uuid, uuid, numeric, timestamptz, text) from public, anon;
revoke all on function public.record_manual_cash_movement(uuid, uuid, public.cash_movement_direction, numeric, text, timestamptz, text) from public, anon;
revoke all on function public.reconcile_cash_account(uuid, uuid, numeric, text, timestamptz) from public, anon;
grant execute on function public.transfer_cash(uuid, uuid, uuid, numeric, timestamptz, text) to authenticated, service_role;
grant execute on function public.record_manual_cash_movement(uuid, uuid, public.cash_movement_direction, numeric, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.reconcile_cash_account(uuid, uuid, numeric, text, timestamptz) to authenticated, service_role;

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
      insert into public.sale_payments (organization_id, sale_id, payment_method_id, amount)
      values (new.organization_id, new.id, new.payment_method_id, new.total)
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
        new.organization_id, target_account_id, 'sale', 'credit', payment.amount,
        'sale', new.id, null, null,
        'sale:' || new.id::text || ':' || payment.payment_method_id::text,
        'Ingreso por venta', new.occurred_at, new.created_by, '{}'
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
        new.organization_id, target_account_id, 'sale_reversal', 'debit', payment.amount,
        'sale', new.id, null, null,
        'sale-reversal:' || new.id::text || ':' || payment.payment_method_id::text,
        'Anulacion de venta', coalesce(new.cancelled_at, now()), new.cancelled_by,
        jsonb_build_object('reason', new.cancellation_reason)
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_sale_cash_movement() from public, anon, authenticated;
create trigger apply_sale_cash_movement
after insert or update of status on public.sales
for each row execute function private.apply_sale_cash_movement();

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
create trigger apply_expense_cash_movement
after insert or update on public.expenses
for each row execute function private.apply_expense_cash_movement();

create or replace function private.apply_payroll_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  target_account_id uuid;
begin
  if old.status <> 'paid' and new.status = 'paid' then
    select tracking_started_at into cutoff from public.cash_tracking_settings
    where organization_id = new.organization_id;
    if cutoff is null or private.cash_date_at_noon(new.paid_at) < cutoff then return new; end if;
    if new.payment_method_id is null then
      raise exception using errcode = '23514', message = 'Payment method is required to pay tracked payroll';
    end if;
    select id into target_account_id from public.cash_accounts
    where organization_id = new.organization_id and payment_method_id = new.payment_method_id;
    if target_account_id is null then
      raise exception using errcode = '23503', message = 'Payroll payment has no cash account';
    end if;
    perform private.append_cash_movement(
      new.organization_id, target_account_id, 'payroll', 'debit', new.gross_salary,
      'payroll_settlement', new.id, null, null, 'payroll:' || new.id::text,
      'Pago de sueldo', private.cash_date_at_noon(new.paid_at), new.paid_by,
      jsonb_build_object('period_month', new.period_month, 'employee_id', new.employee_id)
    );
  end if;
  return new;
end;
$$;

revoke all on function private.apply_payroll_cash_movement() from public, anon, authenticated;
create trigger apply_payroll_cash_movement
after update of status on public.payroll_settlements
for each row execute function private.apply_payroll_cash_movement();

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
  actor_id uuid := private.require_cash_admin(p_organization_id);
  settlement public.payroll_settlements%rowtype;
  method_name text;
begin
  if p_paid_at is null or p_paid_at > (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception using errcode = '22007', message = 'Invalid payment date';
  end if;
  select name into method_name from public.payment_methods
  where id = p_payment_method_id and organization_id = p_organization_id and is_active;
  if method_name is null then
    raise exception using errcode = '23503', message = 'Payment method is missing or inactive';
  end if;
  select * into settlement from public.payroll_settlements
  where id = p_settlement_id and organization_id = p_organization_id for update;
  if settlement.id is null then
    raise exception using errcode = 'P0002', message = 'Payroll settlement not found';
  end if;
  if settlement.status = 'paid' then return settlement.id; end if;

  perform set_config('morita.payroll_action', 'mark_paid', true);
  update public.payroll_settlements
  set status = 'paid', paid_at = p_paid_at, paid_by = actor_id,
      payment_method = method_name, payment_method_id = p_payment_method_id,
      notes = coalesce(nullif(trim(p_notes), ''), notes)
  where id = settlement.id;

  insert into public.payroll_movements (
    organization_id, employee_id, kind, amount, period_month,
    paid_at, notes, created_by, settlement_id
  ) values (
    settlement.organization_id, settlement.employee_id, 'salary', settlement.gross_salary,
    settlement.period_month, p_paid_at, 'Liquidacion mensual automatica', actor_id, settlement.id
  ) on conflict (settlement_id) where settlement_id is not null do nothing;
  return settlement.id;
end;
$$;

create or replace function public.mark_payroll_settlement_paid(
  p_organization_id uuid,
  p_settlement_id uuid,
  p_paid_at date,
  p_payment_method text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  method_id uuid;
begin
  perform private.require_cash_admin(p_organization_id);
  select id into method_id from public.payment_methods
  where organization_id = p_organization_id and is_active
    and lower(trim(name)) = lower(trim(p_payment_method))
  order by sort_order, name limit 1;
  if method_id is null then
    raise exception using errcode = '23503', message = 'Payment method is missing or inactive';
  end if;
  return public.mark_payroll_settlement_paid_v2(
    p_organization_id, p_settlement_id, p_paid_at, method_id, p_notes
  );
end;
$$;

revoke all on function public.mark_payroll_settlement_paid_v2(uuid, uuid, date, uuid, text) from public, anon;
grant execute on function public.mark_payroll_settlement_paid_v2(uuid, uuid, date, uuid, text) to authenticated, service_role;

create or replace function public.create_sale_with_payments(
  p_organization_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid default null,
  p_discount numeric default 0,
  p_notes text default null,
  p_reference text default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  created_sale_id uuid;
  inserted_count integer;
  payment_count integer;
  effective_occurred_at timestamptz;
  sale_total numeric(14, 2);
  single_method_id uuid;
begin
  select member.role into actor_role from public.organization_members as member
  where member.organization_id = p_organization_id and member.user_id = actor_id and member.is_active;
  if actor_id is null or not found then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 250 then
    raise exception using errcode = '22023', message = 'A sale requires between 1 and 250 product lines';
  end if;
  if p_discount is null or p_discount < 0 then
    raise exception using errcode = '22023', message = 'Sale discount must be zero or greater';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, discount numeric)
    where product_id is null or quantity is null or quantity <= 0 or quantity > 100000
      or (discount is not null and discount < 0)
  ) or (select count(*) from jsonb_to_recordset(p_items) as input(product_id uuid)) <>
       (select count(distinct product_id) from jsonb_to_recordset(p_items) as input(product_id uuid)) then
    raise exception using errcode = '22023', message = 'Sale item values are invalid or duplicated';
  end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception using errcode = '22023', message = 'A sale requires a payment allocation';
  end if;
  select count(*), (array_agg(payment_method_id))[1] into payment_count, single_method_id
  from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric);
  if payment_count <> (select count(distinct payment_method_id) from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid))
    or exists (
      select 1 from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric)
      left join public.payment_methods as method on method.id = payment.payment_method_id
        and method.organization_id = p_organization_id and method.is_active
      where method.id is null or payment.amount is null or payment.amount <= 0
    ) then
    raise exception using errcode = '22023', message = 'Payment allocations are invalid or duplicated';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id
      and organization_id = p_organization_id and is_active
  ) then
    raise exception using errcode = '23503', message = 'Customer is missing or inactive';
  end if;

  effective_occurred_at := case when actor_role = 'staff' then now() else coalesce(p_occurred_at, now()) end;
  insert into public.sales (
    organization_id, customer_id, payment_method_id, reference, occurred_at, notes, created_by
  ) values (
    p_organization_id, p_customer_id, case when payment_count = 1 then single_method_id else null end,
    nullif(trim(p_reference), ''), effective_occurred_at, nullif(trim(p_notes), ''), actor_id
  ) returning id into created_sale_id;

  insert into public.sale_items (
    organization_id, sale_id, product_id, quantity, unit_price, unit_cost, discount
  )
  select p_organization_id, created_sale_id, product.id, input.quantity,
    product.retail_price, product.cost_price, coalesce(input.discount, 0)
  from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, discount numeric)
  join public.products as product on product.id = input.product_id
    and product.organization_id = p_organization_id and product.is_active;
  get diagnostics inserted_count = row_count;
  if inserted_count <> jsonb_array_length(p_items) then
    raise exception using errcode = '23503', message = 'One or more sale products are missing or inactive';
  end if;

  select round(sum(item.line_total), 2) - p_discount into sale_total
  from public.sale_items as item
  where item.sale_id = created_sale_id and item.organization_id = p_organization_id;
  if sale_total is null or sale_total < 0 then
    raise exception using errcode = '23514', message = 'Sale discount exceeds its subtotal';
  end if;
  if round((select sum(amount) from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric)), 2)
    is distinct from sale_total then
    raise exception using errcode = '23514', message = 'Payment allocations must equal the exact sale total';
  end if;
  perform set_config('morita.sale_payment_write', 'append', true);
  insert into public.sale_payments (organization_id, sale_id, payment_method_id, amount)
  select p_organization_id, created_sale_id, payment.payment_method_id, round(payment.amount, 2)
  from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric);
  update public.sales set discount = p_discount, status = 'completed' where id = created_sale_id;
  return created_sale_id;
end;
$$;

revoke all on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz) to authenticated, service_role;

create or replace function public.get_cash_dashboard(
  p_organization_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_payment_method_id uuid default null,
  p_type public.cash_movement_type default null,
  p_direction public.cash_movement_direction default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  month_start timestamptz := date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
begin
  perform private.require_cash_admin(p_organization_id);
  select jsonb_build_object(
    'configured', exists(select 1 from public.cash_tracking_settings where organization_id = p_organization_id),
    'tracking_started_at', (select tracking_started_at from public.cash_tracking_settings where organization_id = p_organization_id),
    'total_balance', coalesce((select sum(current_balance) from public.cash_accounts where organization_id = p_organization_id), 0),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', account.id, 'payment_method_id', method.id, 'name', method.name,
        'code', method.code, 'is_active', method.is_active, 'balance', account.current_balance,
        'month_income', coalesce(monthly.income, 0), 'month_expense', coalesce(monthly.expense, 0),
        'movement_count', coalesce(monthly.movement_count, 0), 'updated_at', account.updated_at
      ) order by method.sort_order, method.name)
      from public.cash_accounts as account
      join public.payment_methods as method on method.id = account.payment_method_id
      left join lateral (
        select sum(case when movement.direction = 'credit' then movement.amount else 0 end) as income,
          sum(case when movement.direction = 'debit' then movement.amount else 0 end) as expense,
          count(*) as movement_count
        from public.cash_movements as movement
        where movement.cash_account_id = account.id and movement.occurred_at >= month_start
      ) as monthly on true
      where account.organization_id = p_organization_id
    ), '[]'::jsonb),
    'daily_flow', coalesce((
      select jsonb_agg(jsonb_build_object('date', flow.day, 'income', flow.income, 'expense', flow.expense) order by flow.day)
      from (
        select (movement.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as day,
          sum(case when movement.direction = 'credit' then movement.amount else 0 end) as income,
          sum(case when movement.direction = 'debit' then movement.amount else 0 end) as expense
        from public.cash_movements as movement
        where movement.organization_id = p_organization_id and movement.occurred_at >= now() - interval '14 days'
        group by 1
      ) as flow
    ), '[]'::jsonb),
    'movement_count', (
      select count(*) from public.cash_movements as movement
      join public.cash_accounts as account on account.id = movement.cash_account_id
      where movement.organization_id = p_organization_id
        and (p_date_from is null or movement.occurred_at >= p_date_from)
        and (p_date_to is null or movement.occurred_at < p_date_to)
        and (p_payment_method_id is null or account.payment_method_id = p_payment_method_id)
        and (p_type is null or movement.type = p_type)
        and (p_direction is null or movement.direction = p_direction)
        and (nullif(trim(p_search), '') is null or movement.description ilike '%' || trim(p_search) || '%'
          or coalesce(movement.reference_type, '') ilike '%' || trim(p_search) || '%')
    ),
    'movements', coalesce((
      select jsonb_agg(to_jsonb(entry) order by entry.occurred_at desc, entry.id desc)
      from (
        select movement.id, movement.occurred_at, movement.type, movement.direction,
          movement.amount, movement.signed_amount, movement.balance_before, movement.balance_after,
          movement.description, movement.reference_type, movement.reference_id, movement.transfer_id,
          movement.created_by, method.name as account_name, method.id as payment_method_id,
          coalesce(profile.display_name, profile.email, 'Sistema') as actor_name
        from public.cash_movements as movement
        join public.cash_accounts as account on account.id = movement.cash_account_id
        join public.payment_methods as method on method.id = account.payment_method_id
        left join public.user_profiles as profile on profile.user_id = movement.created_by
        where movement.organization_id = p_organization_id
          and (p_date_from is null or movement.occurred_at >= p_date_from)
          and (p_date_to is null or movement.occurred_at < p_date_to)
          and (p_payment_method_id is null or account.payment_method_id = p_payment_method_id)
          and (p_type is null or movement.type = p_type)
          and (p_direction is null or movement.direction = p_direction)
          and (nullif(trim(p_search), '') is null or movement.description ilike '%' || trim(p_search) || '%'
            or coalesce(movement.reference_type, '') ilike '%' || trim(p_search) || '%')
        order by movement.occurred_at desc, movement.id desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) as entry
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_cash_dashboard(uuid, timestamptz, timestamptz, uuid, public.cash_movement_type, public.cash_movement_direction, text, integer, integer) from public, anon;
grant execute on function public.get_cash_dashboard(uuid, timestamptz, timestamptz, uuid, public.cash_movement_type, public.cash_movement_direction, text, integer, integer) to authenticated, service_role;

comment on table public.cash_movements is 'Immutable internal cash ledger. Balances are reconstructed from signed movements.';
comment on table public.cash_tracking_settings is 'One-time cutoff that prevents preexisting historical operations from changing opening balances.';

create or replace function public.get_sale_receipt(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_sale public.sales%rowtype;
  receipt jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;
  select sale.* into target_sale
  from public.sales as sale
  join public.organization_members as member on member.organization_id = sale.organization_id
    and member.user_id = actor_id and member.is_active
  where sale.id = p_sale_id
    and (member.role in ('owner', 'admin') or (member.role = 'staff' and sale.created_by = actor_id));
  if not found then raise exception using errcode = 'P0002', message = 'Sale receipt was not found'; end if;

  select jsonb_build_object(
    'display_number', coalesce(nullif(trim(target_sale.legacy_sale_number), ''), nullif(trim(target_sale.reference), ''), upper(substr(replace(target_sale.id::text, '-', ''), 1, 8))),
    'source', target_sale.source, 'status', target_sale.status, 'occurred_at', target_sale.occurred_at,
    'original_time_known', target_sale.original_time_known, 'item_detail_status', target_sale.item_detail_status,
    'subtotal', target_sale.subtotal, 'discount', target_sale.discount, 'vat_10_5', target_sale.vat_10_5,
    'vat_21', target_sale.vat_21, 'rounding_adjustment', target_sale.rounding_adjustment, 'total', target_sale.total,
    'customer', case when customer.id is null and nullif(trim(target_sale.legacy_customer_name), '') is null then null else jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(customer.name, nullif(trim(target_sale.legacy_customer_name), '')),
      'phone', coalesce(nullif(trim(customer.whatsapp), ''), nullif(trim(customer.phone), ''))
    )) end,
    'seller_name', coalesce(nullif(trim(profile.display_name), ''), nullif(trim(target_sale.legacy_seller_name), '')),
    'payments', case
      when jsonb_array_length(coalesce(payments.rows, '[]'::jsonb)) > 0 then payments.rows
      when nullif(trim(target_sale.legacy_payment_method), '') is not null then jsonb_build_array(jsonb_build_object('method', target_sale.legacy_payment_method, 'amount', target_sale.total))
      else '[]'::jsonb end,
    'business', jsonb_strip_nulls(jsonb_build_object('name', organization.name, 'address', nullif(trim(settings.address), ''), 'whatsapp', nullif(trim(settings.whatsapp), ''), 'email', nullif(trim(settings.email), ''))),
    'items', coalesce(items.rows, '[]'::jsonb)
  ) into receipt
  from public.organizations as organization
  left join public.customers as customer on customer.id = target_sale.customer_id and customer.organization_id = target_sale.organization_id
  left join public.user_profiles as profile on profile.user_id = target_sale.created_by
  left join public.site_settings as settings on settings.organization_id = target_sale.organization_id
  left join lateral (
    select jsonb_agg(jsonb_build_object('method', method.name, 'amount', payment.amount) order by method.sort_order, method.name) as rows
    from public.sale_payments as payment
    join public.payment_methods as method on method.id = payment.payment_method_id and method.organization_id = payment.organization_id
    where payment.sale_id = target_sale.id and payment.organization_id = target_sale.organization_id
  ) as payments on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('name', item.product_name_snapshot, 'sku', item.product_sku_snapshot, 'quantity', item.quantity, 'unit_price', item.unit_price, 'discount', item.discount, 'line_total', item.line_total) order by item.created_at, item.id) as rows
    from public.sale_items as item where item.sale_id = target_sale.id and item.organization_id = target_sale.organization_id
  ) as items on true
  where organization.id = target_sale.organization_id;
  return receipt;
end;
$$;

comment on function public.get_sale_receipt(uuid) is
  'Returns a customer-safe immutable receipt with exact single or combined historical payment allocations.';

create or replace function public.list_operational_sales(
  p_organization_id uuid,
  p_created_by uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_source text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid, reference text, occurred_at timestamptz, total numeric,
  status public.sale_status, cancellation_reason text, customer_name text,
  payment_method_name text, item_count bigint, created_by uuid,
  actor_name text, actor_email text, source text, legacy_sale_number text,
  legacy_seller_name text, item_detail_status text, matching_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
begin
  select member.role into actor_role from public.organization_members as member
  where member.organization_id = p_organization_id and member.user_id = actor_id and member.is_active;
  if actor_id is null or not found then
    raise exception using errcode = '42501', message = 'Active organization membership is required';
  end if;
  return query
  select sale.id, sale.reference, sale.occurred_at, sale.total, sale.status,
    sale.cancellation_reason, coalesce(customer.name, sale.legacy_customer_name),
    coalesce(payment_summary.names, sale.legacy_payment_method), coalesce(item_summary.count, 0),
    sale.created_by, profile.display_name, profile.email, sale.source,
    sale.legacy_sale_number, sale.legacy_seller_name, sale.item_detail_status, count(*) over ()
  from public.sales as sale
  left join public.customers as customer on customer.id = sale.customer_id and customer.organization_id = sale.organization_id
  left join public.user_profiles as profile on profile.user_id = sale.created_by
  left join lateral (
    select string_agg(method.name, ' + ' order by method.sort_order, method.name) as names
    from public.sale_payments as payment
    join public.payment_methods as method on method.id = payment.payment_method_id and method.organization_id = payment.organization_id
    where payment.sale_id = sale.id and payment.organization_id = sale.organization_id
  ) as payment_summary on true
  left join lateral (
    select count(*) as count from public.sale_items as item
    where item.sale_id = sale.id and item.organization_id = sale.organization_id
  ) as item_summary on true
  where sale.organization_id = p_organization_id
    and (p_from is null or sale.occurred_at >= p_from)
    and (p_to is null or sale.occurred_at < p_to)
    and (p_source is null or sale.source = p_source)
    and (nullif(trim(p_search), '') is null
      or sale.reference ilike '%' || trim(p_search) || '%'
      or sale.legacy_sale_number ilike '%' || trim(p_search) || '%'
      or coalesce(customer.name, sale.legacy_customer_name, '') ilike '%' || trim(p_search) || '%'
      or coalesce(payment_summary.names, sale.legacy_payment_method, '') ilike '%' || trim(p_search) || '%')
    and ((actor_role in ('owner', 'admin') and (p_created_by is null or sale.created_by = p_created_by))
      or (actor_role = 'staff' and sale.created_by = actor_id))
  order by sale.occurred_at desc, sale.id
  limit least(greatest(coalesce(p_limit, 100), 1), 250)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

comment on function public.list_operational_sales(uuid, uuid, timestamptz, timestamptz, text, text, integer, integer) is
  'Lists authorized sales and renders exact combined payment method labels.';
