alter table public.payment_methods
  add column debit_surcharge_percent numeric(5, 2) not null default 0,
  add column credit_surcharge_percent numeric(5, 2) not null default 0,
  add constraint payment_methods_debit_surcharge_range_check
    check (debit_surcharge_percent between 0 and 100),
  add constraint payment_methods_credit_surcharge_range_check
    check (credit_surcharge_percent between 0 and 100),
  add constraint payment_methods_card_surcharges_check
    check (
      code = 'card'
      or (debit_surcharge_percent = 0 and credit_surcharge_percent = 0)
    );

alter table public.sales
  drop constraint sales_total_matches_components_check,
  add column surcharge numeric(14, 2) not null default 0
    check (surcharge >= 0),
  add constraint sales_total_matches_components_check check (
    total = subtotal + vat_10_5 + vat_21 + rounding_adjustment + surcharge - discount
  );

alter table public.sale_payments
  add column base_amount numeric(14, 2),
  add column card_type text,
  add column surcharge_percentage numeric(5, 2) not null default 0,
  add column surcharge_amount numeric(14, 2) not null default 0;

drop trigger sale_payments_guard_write on public.sale_payments;

update public.sale_payments
set base_amount = amount;

alter table public.sale_payments
  alter column base_amount set not null,
  add constraint sale_payments_base_amount_positive_check check (base_amount > 0),
  add constraint sale_payments_card_type_check check (card_type is null or card_type in ('debit', 'credit')),
  add constraint sale_payments_surcharge_percentage_range_check check (surcharge_percentage between 0 and 100),
  add constraint sale_payments_surcharge_amount_check check (surcharge_amount >= 0),
  add constraint sale_payments_amount_components_check check (
    amount = base_amount + surcharge_amount
  ),
  add constraint sale_payments_surcharge_calculation_check check (
    surcharge_amount = round(base_amount * surcharge_percentage / 100, 2)
  ),
  add constraint sale_payments_card_snapshot_check check (
    (card_type is null and surcharge_percentage = 0 and surcharge_amount = 0)
    or card_type is not null
  );

-- Keep legacy methods for historical foreign keys and ledger balances, but remove
-- them from new operations once their tracked balance is zero.
update public.payment_methods as method
set is_active = false
where method.code not in ('cash', 'transfer', 'card')
  and not exists (
    select 1
    from public.cash_accounts as account
    where account.organization_id = method.organization_id
      and account.payment_method_id = method.id
      and account.current_balance <> 0
  );

update public.payment_methods
set name = case code
    when 'cash' then 'Efectivo'
    when 'transfer' then 'Transferencia'
    else name
  end,
  is_active = true,
  sort_order = case code when 'cash' then 10 when 'transfer' then 20 else sort_order end
where code in ('cash', 'transfer');

insert into public.payment_methods (organization_id, name, code, sort_order, is_active)
select organization.id, 'Tarjeta', 'card', 30, true
from public.organizations as organization
where not exists (
  select 1
  from public.payment_methods as method
  where method.organization_id = organization.id and method.code = 'card'
);

update public.payment_methods
set name = 'Tarjeta', is_active = true, sort_order = 30
where code = 'card';

create or replace function private.add_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner');

  insert into public.site_settings (organization_id)
  values (new.id);

  insert into public.categories (organization_id, name, slug, sort_order)
  values
    (new.id, 'Pañales', 'panales', 10),
    (new.id, 'Mamaderas', 'mamaderas', 20),
    (new.id, 'Chupetes', 'chupetes', 30),
    (new.id, 'Higiene', 'higiene', 40),
    (new.id, 'Alimentación', 'alimentacion', 50),
    (new.id, 'Juguetes', 'juguetes', 60),
    (new.id, 'Accesorios', 'accesorios', 70),
    (new.id, 'Ropa para bebé', 'ropa-para-bebe', 80),
    (new.id, 'Cuidado personal', 'cuidado-personal', 90),
    (new.id, 'Otros', 'otros', 100);

  insert into public.payment_methods (organization_id, name, code, sort_order)
  values
    (new.id, 'Efectivo', 'cash', 10),
    (new.id, 'Transferencia', 'transfer', 20),
    (new.id, 'Tarjeta', 'card', 30);

  insert into public.expense_categories (organization_id, name)
  values
    (new.id, 'Mercadería'),
    (new.id, 'Servicios'),
    (new.id, 'Sueldos'),
    (new.id, 'Impuestos'),
    (new.id, 'Otros');

  return new;
end;
$$;

create or replace function private.guard_sale_payment_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  method_code text;
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

    select method.code into method_code
    from public.payment_methods as method
    where method.id = new.payment_method_id
      and method.organization_id = new.organization_id;

    if method_code is null then
      raise exception using errcode = '23503', message = 'Sale payment requires a valid payment method';
    end if;
    if method_code = 'card' and new.card_type is null then
      raise exception using errcode = '23514', message = 'Card payments require debit or credit';
    end if;
    if method_code <> 'card' and (
      new.card_type is not null
      or new.surcharge_percentage <> 0
      or new.surcharge_amount <> 0
    ) then
      raise exception using errcode = '23514', message = 'Only card payments can include a surcharge';
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

create or replace function private.guard_sale_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  calculated_subtotal numeric(14, 2);
  calculated_surcharge numeric(14, 2);
  item_count integer;
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by
    or new.source is distinct from old.source
    or new.import_batch_id is distinct from old.import_batch_id
    or new.legacy_source_key is distinct from old.legacy_source_key
    or new.legacy_sale_number is distinct from old.legacy_sale_number
    or new.legacy_source_row is distinct from old.legacy_source_row
    or new.legacy_document_type is distinct from old.legacy_document_type
    or new.legacy_point_of_sale is distinct from old.legacy_point_of_sale
    or new.legacy_document_number is distinct from old.legacy_document_number
    or new.legacy_payment_method is distinct from old.legacy_payment_method
    or new.legacy_customer_name is distinct from old.legacy_customer_name
    or new.legacy_customer_tax_id is distinct from old.legacy_customer_tax_id
    or new.legacy_seller_name is distinct from old.legacy_seller_name
    or new.legacy_status is distinct from old.legacy_status
    or new.original_time_known is distinct from old.original_time_known
    or new.item_detail_status is distinct from old.item_detail_status
    or new.vat_10_5 is distinct from old.vat_10_5
    or new.vat_21 is distinct from old.vat_21
    or new.rounding_adjustment is distinct from old.rounding_adjustment
    or new.legacy_payload is distinct from old.legacy_payload then
    raise exception using errcode = '42501', message = 'Sale identity and historical fields are immutable';
  end if;

  if actor_id is not null and not private.is_org_member(old.organization_id) then
    raise exception using errcode = '42501', message = 'Organization membership is required';
  end if;

  if new.status = old.status then
    if old.status <> 'draft' then
      raise exception using errcode = '42501', message = 'Completed and cancelled sales are immutable';
    end if;

    if new.subtotal is distinct from old.subtotal
      or new.discount is distinct from old.discount
      or new.surcharge is distinct from old.surcharge
      or new.total is distinct from old.total
      or new.cancelled_at is distinct from old.cancelled_at
      or new.cancelled_by is distinct from old.cancelled_by
      or new.cancellation_reason is distinct from old.cancellation_reason then
      raise exception using errcode = '42501', message = 'Sale totals and cancellation fields are workflow-managed';
    end if;

    return new;
  end if;

  if old.status = 'draft' and new.status = 'completed' then
    if actor_id is not null
      and actor_id <> old.created_by
      and not private.has_org_role(
        old.organization_id,
        array['owner', 'admin']::public.app_role[]
      ) then
      raise exception using errcode = '42501', message = 'Only the sale creator or an administrator can complete it';
    end if;

    select count(*), round(coalesce(sum(line_total), 0), 2)
    into item_count, calculated_subtotal
    from public.sale_items
    where sale_id = old.id
      and organization_id = old.organization_id;

    if item_count = 0 then
      raise exception using errcode = '23514', message = 'A sale requires at least one item';
    end if;

    if new.discount < 0 or new.discount > calculated_subtotal then
      raise exception using errcode = '23514', message = 'Sale discount exceeds its subtotal';
    end if;

    select round(coalesce(sum(payment.surcharge_amount), 0), 2)
    into calculated_surcharge
    from public.sale_payments as payment
    where payment.sale_id = old.id
      and payment.organization_id = old.organization_id;

    new.subtotal := calculated_subtotal;
    new.vat_10_5 := 0;
    new.vat_21 := 0;
    new.rounding_adjustment := 0;
    new.surcharge := calculated_surcharge;
    new.total := calculated_subtotal + calculated_surcharge - new.discount;
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
    return new;
  end if;

  if old.status = 'completed' and new.status = 'cancelled' then
    if actor_id is not null and not private.has_org_role(
      old.organization_id,
      array['owner', 'admin']::public.app_role[]
    ) then
      raise exception using errcode = '42501', message = 'Only owners and administrators can cancel sales';
    end if;

    if new.cancellation_reason is null
      or char_length(trim(new.cancellation_reason)) < 3 then
      raise exception using errcode = '23514', message = 'A cancellation reason is required';
    end if;

    new.cancelled_at := now();
    new.cancelled_by := coalesce(actor_id, new.cancelled_by);
    new.subtotal := old.subtotal;
    new.discount := old.discount;
    new.surcharge := old.surcharge;
    new.total := old.total;
    return new;
  end if;

  raise exception using
    errcode = '23514',
    message = format('Invalid sale status transition: %s to %s', old.status, new.status);
end;
$$;

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
        new.organization_id, target_account_id, 'sale', 'credit', payment.amount,
        'sale', new.id, null, null,
        'sale:' || new.id::text || ':' || payment.payment_method_id::text,
        'Ingreso por venta', new.occurred_at, new.created_by,
        jsonb_strip_nulls(jsonb_build_object(
          'base_amount', payment.base_amount,
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
  base_sale_total numeric(14, 2);
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
  from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text);

  if payment_count <> (
      select count(distinct payment_method_id)
      from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid)
    ) or exists (
      select 1
      from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text)
      left join public.payment_methods as method on method.id = payment.payment_method_id
        and method.organization_id = p_organization_id
        and method.is_active
        and method.code in ('cash', 'transfer', 'card')
      where method.id is null
        or payment.amount is null
        or payment.amount <= 0
        or payment.amount > 999999999
        or (method.code = 'card' and coalesce(payment.card_type, '') not in ('debit', 'credit'))
        or (method.code <> 'card' and payment.card_type is not null)
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

  select round(sum(item.line_total), 2) - p_discount into base_sale_total
  from public.sale_items as item
  where item.sale_id = created_sale_id and item.organization_id = p_organization_id;
  if base_sale_total is null or base_sale_total < 0 then
    raise exception using errcode = '23514', message = 'Sale discount exceeds its subtotal';
  end if;
  if round((
      select sum(amount)
      from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text)
    ), 2) is distinct from base_sale_total then
    raise exception using errcode = '23514', message = 'Payment allocations must equal the exact sale base total';
  end if;

  perform set_config('morita.sale_payment_write', 'append', true);
  insert into public.sale_payments (
    organization_id,
    sale_id,
    payment_method_id,
    amount,
    base_amount,
    card_type,
    surcharge_percentage,
    surcharge_amount
  )
  select
    p_organization_id,
    created_sale_id,
    payment.payment_method_id,
    round(payment.amount, 2) + calculated.surcharge_amount,
    round(payment.amount, 2),
    case when method.code = 'card' then payment.card_type else null end,
    calculated.surcharge_percentage,
    calculated.surcharge_amount
  from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text)
  join public.payment_methods as method on method.id = payment.payment_method_id
    and method.organization_id = p_organization_id
  cross join lateral (
    select
      case
        when method.code = 'card' and payment.card_type = 'debit' then method.debit_surcharge_percent
        when method.code = 'card' and payment.card_type = 'credit' then method.credit_surcharge_percent
        else 0::numeric
      end as surcharge_percentage
  ) as percentage
  cross join lateral (
    select
      percentage.surcharge_percentage,
      round(round(payment.amount, 2) * percentage.surcharge_percentage / 100, 2) as surcharge_amount
  ) as calculated;

  update public.sales set discount = p_discount, status = 'completed' where id = created_sale_id;
  return created_sale_id;
end;
$$;

revoke all on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz) to authenticated, service_role;

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
    'vat_21', target_sale.vat_21, 'rounding_adjustment', target_sale.rounding_adjustment,
    'surcharge', target_sale.surcharge, 'total', target_sale.total,
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
    select jsonb_agg(jsonb_build_object(
      'method', case payment.card_type
        when 'debit' then method.name || ' de débito'
        when 'credit' then method.name || ' de crédito'
        else method.name
      end,
      'amount', payment.amount,
      'base_amount', payment.base_amount,
      'card_type', payment.card_type,
      'surcharge_percentage', payment.surcharge_percentage,
      'surcharge_amount', payment.surcharge_amount
    ) order by method.sort_order, method.name) as rows
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
  'Returns a customer-safe immutable receipt with exact historical payment allocations and card surcharge snapshots.';

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
    select string_agg(
      case payment.card_type
        when 'debit' then method.name || ' de débito'
        when 'credit' then method.name || ' de crédito'
        else method.name
      end,
      ' + ' order by method.sort_order, method.name
    ) as names
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
  'Lists authorized sales and renders exact combined payment method and card type labels.';

comment on column public.payment_methods.debit_surcharge_percent is
  'Current configurable debit card surcharge. New sales snapshot this value.';
comment on column public.payment_methods.credit_surcharge_percent is
  'Current configurable credit card surcharge. New sales snapshot this value.';
comment on column public.sales.surcharge is
  'Immutable sum of the payment surcharge snapshots applied when the sale completed.';
comment on table public.sale_payments is
  'Immutable payment allocation snapshots. Amount includes any card surcharge; base_amount does not.';
