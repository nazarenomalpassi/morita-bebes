alter table public.sales
  drop constraint sales_total_matches_components_check,
  add column manual_surcharge numeric(14, 2) not null default 0
    check (manual_surcharge >= 0),
  add constraint sales_total_matches_components_check check (
    total = subtotal + vat_10_5 + vat_21 + rounding_adjustment
      + manual_surcharge + surcharge - discount
  );

comment on column public.sales.manual_surcharge is
  'Immutable fixed surcharge entered by the operator. It is real collected revenue and is separate from card processor surcharge previews.';

create or replace function private.guard_sale_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  calculated_subtotal numeric(14, 2);
  calculated_discount numeric(14, 2);
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
      or new.discount_percent is distinct from old.discount_percent
      or new.manual_surcharge is distinct from old.manual_surcharge
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
    if new.discount_percent is null or new.discount_percent < 0 or new.discount_percent > 100 then
      raise exception using errcode = '23514', message = 'Sale discount percentage must be between zero and one hundred';
    end if;
    if new.manual_surcharge is null or new.manual_surcharge < 0 or new.manual_surcharge > 999999999 then
      raise exception using errcode = '23514', message = 'Sale manual surcharge must be between zero and 999999999';
    end if;

    calculated_discount := round(calculated_subtotal * new.discount_percent / 100, 2);

    select round(coalesce(sum(payment.surcharge_amount), 0), 2)
    into calculated_surcharge
    from public.sale_payments as payment
    where payment.sale_id = old.id
      and payment.organization_id = old.organization_id;

    new.subtotal := calculated_subtotal;
    new.discount := calculated_discount;
    new.vat_10_5 := 0;
    new.vat_21 := 0;
    new.rounding_adjustment := 0;
    new.surcharge := calculated_surcharge;
    new.total := calculated_subtotal + new.manual_surcharge + calculated_surcharge - calculated_discount;
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
    if new.cancellation_reason is null or char_length(trim(new.cancellation_reason)) < 3 then
      raise exception using errcode = '23514', message = 'A cancellation reason is required';
    end if;

    new.cancelled_at := now();
    new.cancelled_by := coalesce(actor_id, new.cancelled_by);
    new.subtotal := old.subtotal;
    new.discount := old.discount;
    new.discount_percent := old.discount_percent;
    new.manual_surcharge := old.manual_surcharge;
    new.surcharge := old.surcharge;
    new.total := old.total;
    return new;
  end if;

  raise exception using
    errcode = '23514',
    message = format('Invalid sale status transition: %s to %s', old.status, new.status);
end;
$$;

drop function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz);

create function public.create_sale_with_payments(
  p_organization_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid default null,
  p_discount numeric default 0,
  p_notes text default null,
  p_reference text default null,
  p_occurred_at timestamptz default now(),
  p_manual_surcharge numeric default 0
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
  payment_count integer := 0;
  effective_occurred_at timestamptz;
  sale_subtotal numeric(14, 2);
  discount_amount numeric(14, 2);
  amount_to_allocate numeric(14, 2);
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
  if p_discount is null or p_discount < 0 or p_discount > 100 then
    raise exception using errcode = '22023', message = 'Sale discount percentage must be between zero and one hundred';
  end if;
  if p_manual_surcharge is null or p_manual_surcharge < 0 or p_manual_surcharge > 999999999 then
    raise exception using errcode = '22023', message = 'Sale manual surcharge must be between zero and 999999999';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as input(product_id uuid, quantity numeric, discount numeric)
    where product_id is null or quantity is null or quantity <= 0 or quantity > 100000
      or (discount is not null and discount < 0)
  ) or (select count(*) from jsonb_to_recordset(p_items) as input(product_id uuid)) <>
       (select count(distinct product_id) from jsonb_to_recordset(p_items) as input(product_id uuid)) then
    raise exception using errcode = '22023', message = 'Sale item values are invalid or duplicated';
  end if;
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception using errcode = '22023', message = 'Sale payment allocations must be an array';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id
      and organization_id = p_organization_id and is_active
  ) then
    raise exception using errcode = '23503', message = 'Customer is missing or inactive';
  end if;

  effective_occurred_at := case when actor_role = 'staff' then now() else coalesce(p_occurred_at, now()) end;
  insert into public.sales (
    organization_id, customer_id, payment_method_id, reference, occurred_at,
    notes, created_by, manual_surcharge
  ) values (
    p_organization_id, p_customer_id, null, nullif(trim(p_reference), ''),
    effective_occurred_at, nullif(trim(p_notes), ''), actor_id, round(p_manual_surcharge, 2)
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

  select round(sum(item.line_total), 2) into sale_subtotal
  from public.sale_items as item
  where item.sale_id = created_sale_id and item.organization_id = p_organization_id;
  discount_amount := round(sale_subtotal * p_discount / 100, 2);
  amount_to_allocate := sale_subtotal - discount_amount + round(p_manual_surcharge, 2);

  select count(*), (array_agg(payment_method_id))[1] into payment_count, single_method_id
  from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text);
  payment_count := coalesce(payment_count, 0);

  if payment_count > 0 and (
    payment_count <> (
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
    )
  ) then
    raise exception using errcode = '22023', message = 'Payment allocations are invalid or duplicated';
  end if;

  if amount_to_allocate > 0 then
    if payment_count = 0 then
      raise exception using errcode = '22023', message = 'A charged sale requires a payment allocation';
    end if;
    if round((
      select sum(amount)
      from jsonb_to_recordset(p_payments) as payment(payment_method_id uuid, amount numeric, card_type text)
    ), 2) is distinct from amount_to_allocate then
      raise exception using errcode = '23514', message = 'Payment allocations must equal the exact sale amount after discount and manual surcharge';
    end if;
  elsif amount_to_allocate = 0 then
    if payment_count <> 0 then
      raise exception using errcode = '23514', message = 'A zero-total sale must not allocate a payment';
    end if;
  else
    raise exception using errcode = '23514', message = 'Sale total cannot be negative';
  end if;

  if payment_count > 0 then
    perform set_config('morita.sale_payment_write', 'append', true);
    insert into public.sale_payments (
      organization_id, sale_id, payment_method_id, amount, base_amount,
      card_type, surcharge_percentage, surcharge_amount
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
      select case
        when method.code = 'card' and payment.card_type = 'debit' then method.debit_surcharge_percent
        when method.code = 'card' and payment.card_type = 'credit' then method.credit_surcharge_percent
        else 0::numeric
      end as surcharge_percentage
    ) as percentage
    cross join lateral (
      select percentage.surcharge_percentage,
        round(round(payment.amount, 2) * percentage.surcharge_percentage / 100, 2) as surcharge_amount
    ) as calculated;
  end if;

  update public.sales
  set discount_percent = p_discount,
      discount = discount_amount,
      payment_method_id = case when payment_count = 1 then single_method_id else null end,
      status = 'completed'
  where id = created_sale_id;

  return created_sale_id;
end;
$$;

revoke all on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz, numeric) from public, anon;
grant execute on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz, numeric) to authenticated, service_role;

comment on function public.create_sale_with_payments(uuid, jsonb, jsonb, uuid, numeric, text, text, timestamptz, numeric) is
  'Creates an atomic sale. Percentage discount is applied first, then the fixed manual surcharge. Card processor surcharge remains a separate preview snapshot.';

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
    'subtotal', target_sale.subtotal, 'discount', target_sale.discount,
    'discount_percent', target_sale.discount_percent, 'vat_10_5', target_sale.vat_10_5,
    'vat_21', target_sale.vat_21, 'rounding_adjustment', target_sale.rounding_adjustment,
    'manual_surcharge', target_sale.manual_surcharge,
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
    select jsonb_agg(jsonb_build_object(
      'name', item.product_name_snapshot,
      'sku', item.product_sku_snapshot,
      'quantity', item.quantity,
      'unit_price', item.unit_price,
      'discount', item.discount,
      'line_total', item.line_total
    ) order by item.created_at, item.id) as rows
    from public.sale_items as item
    where item.sale_id = target_sale.id and item.organization_id = target_sale.organization_id
  ) as items on true
  where organization.id = target_sale.organization_id;

  return receipt;
end;
$$;

comment on function public.get_sale_receipt(uuid) is
  'Returns an immutable customer-safe receipt including historical discounts, fixed manual surcharge and card surcharge snapshots.';

create or replace function public.get_sales_discount_summary(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_compare_from date,
  p_compare_to date,
  p_category_id uuid default null,
  p_product_id uuid default null,
  p_created_by uuid default null,
  p_unassigned_only boolean default false,
  p_payment_key text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  result jsonb;
begin
  select member.role into actor_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = actor_id
    and member.is_active;

  if actor_id is null or not found or actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'Administrator access is required';
  end if;
  if p_from is null or p_to is null or p_from > p_to
    or p_compare_from is null or p_compare_to is null or p_compare_from > p_compare_to then
    raise exception using errcode = '22023', message = 'Invalid discount summary date range';
  end if;

  with candidate_sales as (
    select
      sale.*,
      case
        when sale.occurred_at >= p_from::timestamp at time zone 'America/Argentina/Cordoba'
          and sale.occurred_at < (p_to + 1)::timestamp at time zone 'America/Argentina/Cordoba'
          then 'current'
        else 'previous'
      end as period
    from public.sales as sale
    where sale.organization_id = p_organization_id
      and sale.status = 'completed'
      and (
        (sale.occurred_at >= p_from::timestamp at time zone 'America/Argentina/Cordoba'
          and sale.occurred_at < (p_to + 1)::timestamp at time zone 'America/Argentina/Cordoba')
        or
        (sale.occurred_at >= p_compare_from::timestamp at time zone 'America/Argentina/Cordoba'
          and sale.occurred_at < (p_compare_to + 1)::timestamp at time zone 'America/Argentina/Cordoba')
      )
      and (p_created_by is null or sale.created_by = p_created_by)
      and (not p_unassigned_only or sale.created_by is null)
      and (
        p_payment_key is null
        or coalesce(
          sale.payment_method_id::text,
          'legacy:' || lower(coalesce(nullif(trim(sale.legacy_payment_method), ''), 'sin-registrar'))
        ) = p_payment_key
      )
  ), weighted_sales as (
    select
      sale.period,
      sale.subtotal,
      sale.discount,
      sale.manual_surcharge,
      sale.total,
      sale.surcharge,
      case
        when p_product_id is null and p_category_id is null then 1::numeric
        else coalesce(rollup.matched_line_total / nullif(sale.subtotal, 0), 0)
      end as weight
    from candidate_sales as sale
    left join lateral (
      select coalesce(sum(item.line_total), 0) as matched_line_total
      from public.sale_items as item
      left join public.products as product
        on product.id = item.product_id
       and product.organization_id = item.organization_id
      where item.sale_id = sale.id
        and item.organization_id = sale.organization_id
        and (p_product_id is null or item.product_id = p_product_id)
        and (p_category_id is null or product.category_id = p_category_id)
    ) as rollup on true
    where (p_product_id is null and p_category_id is null)
      or rollup.matched_line_total > 0
  ), totals as (
    select
      periods.period,
      round(coalesce(sum(weighted.subtotal * weighted.weight), 0), 2) as gross_revenue,
      round(coalesce(sum(weighted.discount * weighted.weight), 0), 2) as discounts,
      round(coalesce(sum(weighted.manual_surcharge * weighted.weight), 0), 2) as manual_surcharges,
      round(coalesce(sum((weighted.subtotal - weighted.discount + weighted.manual_surcharge) * weighted.weight), 0), 2) as net_revenue,
      round(coalesce(sum(weighted.surcharge * weighted.weight), 0), 2) as card_surcharge_preview,
      round(coalesce(sum(weighted.total * weighted.weight), 0), 2) as customer_charged_total
    from (values ('current'::text), ('previous'::text)) as periods(period)
    left join weighted_sales as weighted on weighted.period = periods.period
    group by periods.period
  )
  select jsonb_build_object(
    'current', (select to_jsonb(totals) - 'period' from totals where period = 'current'),
    'previous', (select to_jsonb(totals) - 'period' from totals where period = 'previous')
  ) into result;

  return result;
end;
$$;

comment on function public.get_sales_discount_summary(uuid, date, date, date, date, uuid, uuid, uuid, boolean, text) is
  'Separates gross merchandise value, discounts, fixed manual surcharges, real net revenue and card surcharge previews.';
