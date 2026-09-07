alter table public.web_orders
  add column sale_id uuid,
  add column payment_method_id uuid,
  add column payment_card_type text,
  add column payment_surcharge_amount numeric(14, 2),
  add constraint web_orders_sale_fk
    foreign key (sale_id, organization_id)
    references public.sales (id, organization_id)
    on delete restrict,
  add constraint web_orders_payment_method_fk
    foreign key (payment_method_id, organization_id)
    references public.payment_methods (id, organization_id)
    on delete restrict,
  add constraint web_orders_payment_card_type_check
    check (payment_card_type is null or payment_card_type in ('debit', 'credit')),
  add constraint web_orders_payment_surcharge_amount_check
    check (payment_surcharge_amount is null or payment_surcharge_amount >= 0);

create unique index web_orders_sale_id_key
  on public.web_orders (sale_id)
  where sale_id is not null;

comment on column public.web_orders.sale_id is
  'Internal sale created atomically when the store order is confirmed as paid.';
comment on column public.web_orders.payment_method_id is
  'Payment method selected when the order becomes an internal sale.';
comment on column public.web_orders.payment_card_type is
  'Debit or credit subtype when the selected payment method is card.';
comment on column public.web_orders.payment_surcharge_amount is
  'Immutable card surcharge shown at confirmation time; it is not duplicated in the financial account balance.';

create or replace function private.guard_sale_item_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_sale_id uuid := coalesce(new.sale_id, old.sale_id);
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_source text;
  captured_product_cost numeric(14, 2);
  captured_retail_price numeric(14, 2);
  captured_product_name text;
  captured_product_sku text;
  snapshot_source text := current_setting('morita.sale_item_snapshot_source', true);
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  select sale.source
  into target_source
  from public.sales as sale
  where sale.id = target_sale_id
    and sale.organization_id = target_organization_id;

  if not found then
    raise exception using errcode = '23503', message = 'Sale is missing or belongs to another organization';
  end if;

  if target_source = 'legacy_import' then
    if (select auth.uid()) is not null then
      raise exception using errcode = '42501', message = 'Legacy sale items can only be written by the controlled importer';
    end if;
    if tg_op <> 'INSERT' then
      raise exception using errcode = '42501', message = 'Imported sale items are immutable';
    end if;
    if new.product_id is not null then
      select product.name, product.sku
      into captured_product_name, captured_product_sku
      from public.products as product
      where product.id = new.product_id
        and product.organization_id = new.organization_id;
      if not found then
        raise exception using errcode = '23503', message = 'Mapped legacy product is missing or belongs to another organization';
      end if;
    end if;
    new.product_name_snapshot := coalesce(nullif(trim(new.product_name_snapshot), ''), nullif(trim(new.legacy_product_name), ''), captured_product_name);
    new.product_sku_snapshot := coalesce(nullif(trim(new.product_sku_snapshot), ''), nullif(trim(new.legacy_product_code), ''), captured_product_sku);
    return new;
  end if;

  if (select auth.uid()) is not null
    and not private.can_edit_sale(target_organization_id, target_sale_id) then
    raise exception using errcode = '42501', message = 'Sale items can only be changed while an authorized draft is open';
  end if;

  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.sale_id is distinct from old.sale_id
    or new.product_id is distinct from old.product_id
    or new.unit_price is distinct from old.unit_price
    or new.unit_cost is distinct from old.unit_cost
    or new.product_name_snapshot is distinct from old.product_name_snapshot
    or new.product_sku_snapshot is distinct from old.product_sku_snapshot
    or new.legacy_product_name is distinct from old.legacy_product_name
    or new.legacy_product_code is distinct from old.legacy_product_code
    or new.legacy_barcode is distinct from old.legacy_barcode
    or new.legacy_payload is distinct from old.legacy_payload
  ) then
    raise exception using errcode = '42501', message = 'Sale item identity, price, and captured product fields are immutable';
  end if;

  if tg_op = 'INSERT' then
    select product.cost_price, product.retail_price, product.name, product.sku
    into captured_product_cost, captured_retail_price, captured_product_name, captured_product_sku
    from public.products as product
    where product.id = new.product_id
      and product.organization_id = new.organization_id
      and product.is_active;
    if not found then
      raise exception using errcode = '23503', message = 'Sale product is missing, inactive, or belongs to another organization';
    end if;

    new.unit_cost := captured_product_cost;
    if snapshot_source = 'web_order' then
      if new.unit_price is null or new.unit_price < 0 then
        raise exception using errcode = '23514', message = 'Web order unit price is invalid';
      end if;
      new.unit_price := round(new.unit_price, 2);
      new.product_name_snapshot := coalesce(nullif(trim(new.product_name_snapshot), ''), captured_product_name);
      new.product_sku_snapshot := coalesce(nullif(trim(new.product_sku_snapshot), ''), captured_product_sku);
    else
      new.unit_price := captured_retail_price;
      new.product_name_snapshot := captured_product_name;
      new.product_sku_snapshot := captured_product_sku;
    end if;
    new.legacy_product_name := null;
    new.legacy_product_code := null;
    new.legacy_barcode := null;
    new.legacy_payload := '{}'::jsonb;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.confirm_web_order_sale(
  p_order_id uuid,
  p_payment_method_id uuid,
  p_card_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_order public.web_orders%rowtype;
  method public.payment_methods%rowtype;
  created_sale_id uuid;
  item_count integer;
  expected_subtotal numeric(14, 2);
  surcharge_percentage numeric(8, 4) := 0;
  surcharge_amount numeric(14, 2) := 0;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  select * into target_order
  from public.web_orders
  where id = p_order_id
  for update;

  if not found or not private.has_org_role(target_order.organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'No tenés permiso para confirmar este pedido';
  end if;
  if target_order.sale_id is not null then
    return jsonb_build_object(
      'order_id', target_order.id,
      'order_number', target_order.order_number,
      'sale_id', target_order.sale_id,
      'status', target_order.status
    );
  end if;
  if target_order.status not in ('pending', 'contacted') then
    raise exception using errcode = '55000', message = 'Solo se pueden cobrar pedidos pendientes o contactados';
  end if;

  select * into method
  from public.payment_methods
  where id = p_payment_method_id
    and organization_id = target_order.organization_id
    and is_active
    and code in ('cash', 'transfer', 'card')
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'Seleccioná un medio de pago activo';
  end if;
  if method.code = 'card' and coalesce(p_card_type, '') not in ('debit', 'credit') then
    raise exception using errcode = '22023', message = 'Indicá si la tarjeta es de débito o crédito';
  end if;
  if method.code <> 'card' and p_card_type is not null then
    raise exception using errcode = '22023', message = 'El tipo de tarjeta no corresponde al medio de pago';
  end if;

  select count(*), round(coalesce(sum(item.line_total), 0), 2)
  into item_count, expected_subtotal
  from public.web_order_items as item
  where item.order_id = target_order.id
    and item.organization_id = target_order.organization_id;
  if item_count = 0 or expected_subtotal is distinct from target_order.total then
    raise exception using errcode = '23514', message = 'El detalle del pedido no coincide con su total';
  end if;

  if method.code = 'card' then
    surcharge_percentage := case p_card_type
      when 'debit' then method.debit_surcharge_percent
      when 'credit' then method.credit_surcharge_percent
      else 0
    end;
    surcharge_amount := round(target_order.total * surcharge_percentage / 100, 2);
  end if;

  insert into public.sales (
    organization_id, payment_method_id, reference, occurred_at,
    notes, created_by, manual_surcharge
  ) values (
    target_order.organization_id, null, target_order.order_number, now(),
    concat('Venta originada en pedido web ', target_order.order_number), actor_id, 0
  ) returning id into created_sale_id;

  perform set_config('morita.sale_item_snapshot_source', 'web_order', true);
  insert into public.sale_items (
    organization_id, sale_id, product_id, quantity, unit_price, unit_cost,
    discount, product_name_snapshot, product_sku_snapshot
  )
  select item.organization_id, created_sale_id, item.product_id, item.quantity,
    item.unit_price, product.cost_price, 0, item.product_name, item.product_sku
  from public.web_order_items as item
  join public.products as product
    on product.id = item.product_id
   and product.organization_id = item.organization_id
   and product.is_active
  where item.order_id = target_order.id
    and item.organization_id = target_order.organization_id;
  get diagnostics item_count = row_count;
  if item_count <> (
    select count(*) from public.web_order_items
    where order_id = target_order.id and organization_id = target_order.organization_id
  ) then
    raise exception using errcode = '23503', message = 'Uno de los productos del pedido ya no está disponible';
  end if;

  perform set_config('morita.sale_payment_write', 'append', true);
  insert into public.sale_payments (
    organization_id, sale_id, payment_method_id, amount, base_amount,
    card_type, surcharge_percentage, surcharge_amount
  ) values (
    target_order.organization_id, created_sale_id, method.id,
    target_order.total + surcharge_amount, target_order.total,
    case when method.code = 'card' then p_card_type else null end,
    surcharge_percentage, surcharge_amount
  );

  update public.sales
  set discount_percent = 0,
      discount = 0,
      payment_method_id = method.id,
      status = 'completed'
  where id = created_sale_id;

  update public.web_orders
  set status = 'confirmed',
      confirmed_at = now(),
      confirmed_by = actor_id,
      sale_id = created_sale_id,
      payment_method_id = method.id,
      payment_card_type = case when method.code = 'card' then p_card_type else null end,
      payment_surcharge_amount = surcharge_amount,
      updated_at = now()
  where id = target_order.id;

  return jsonb_build_object(
    'order_id', target_order.id,
    'order_number', target_order.order_number,
    'sale_id', created_sale_id,
    'status', 'confirmed',
    'payment_method', method.name,
    'base_total', target_order.total,
    'surcharge_amount', surcharge_amount,
    'charge_total', target_order.total + surcharge_amount
  );
end;
$$;

revoke all on function public.confirm_web_order_sale(uuid, uuid, text) from public, anon;
grant execute on function public.confirm_web_order_sale(uuid, uuid, text) to authenticated, service_role;

comment on function public.confirm_web_order_sale(uuid, uuid, text) is
  'Atomically converts a pending web order into one internal sale, payment, stock deduction and cash movement.';

create or replace function public.transition_web_order(
  p_order_id uuid,
  p_status public.web_order_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_order public.web_orders%rowtype;
  order_item record;
  allowed boolean := false;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required';
  end if;

  select * into target_order from public.web_orders where id = p_order_id for update;
  if not found or not private.has_org_role(target_order.organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'No tenés permiso para gestionar este pedido';
  end if;
  if target_order.status = p_status then
    return jsonb_build_object('id', target_order.id, 'status', target_order.status, 'order_number', target_order.order_number, 'sale_id', target_order.sale_id);
  end if;
  if p_status = 'confirmed' then
    raise exception using errcode = '22023', message = 'Confirmá la venta indicando el medio de pago';
  end if;

  allowed := case target_order.status
    when 'pending' then p_status in ('contacted', 'cancelled')
    when 'contacted' then p_status = 'cancelled'
    when 'confirmed' then p_status in ('preparing', 'cancelled')
    when 'preparing' then p_status in ('ready', 'cancelled')
    when 'ready' then p_status in ('completed', 'cancelled')
    else false
  end;
  if not allowed then
    raise exception using errcode = '22023', message = 'La transición de estado no es válida';
  end if;

  if p_status = 'cancelled' and target_order.sale_id is not null then
    perform public.cancel_sale(
      target_order.sale_id,
      'Pedido web ' || target_order.order_number || ' cancelado desde gestión'
    );
  elsif p_status = 'cancelled' and target_order.status in ('confirmed', 'preparing', 'ready') then
    for order_item in
      select item.* from public.web_order_items item
      where item.order_id = target_order.id
      order by item.product_id
    loop
      perform 1 from public.products product
      where product.id = order_item.product_id and product.organization_id = target_order.organization_id
      for update;
      insert into public.inventory_movements (
        organization_id, product_id, kind, quantity_delta, reference_type,
        reference_id, notes, created_by
      ) values (
        target_order.organization_id, order_item.product_id, 'adjustment', order_item.quantity,
        'web_order_cancel', target_order.id,
        'Pedido web cancelado ' || target_order.order_number, actor_id
      ) on conflict (organization_id, reference_type, reference_id, product_id)
        where reference_type in ('web_order_confirm', 'web_order_cancel') and reference_id is not null
        do nothing;
    end loop;
  end if;

  update public.web_orders set
    status = p_status,
    contacted_at = case when p_status = 'contacted' then now() else contacted_at end,
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by = case when p_status = 'cancelled' then actor_id else cancelled_by end,
    updated_at = now()
  where id = target_order.id
  returning * into target_order;

  return jsonb_build_object('id', target_order.id, 'status', target_order.status, 'order_number', target_order.order_number, 'sale_id', target_order.sale_id);
end;
$$;

revoke all on function public.transition_web_order(uuid, public.web_order_status) from public, anon;
grant execute on function public.transition_web_order(uuid, public.web_order_status) to authenticated, service_role;

create function private.sync_web_order_sale_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'completed' and new.status = 'cancelled' then
    update public.web_orders
    set status = 'cancelled',
        cancelled_at = coalesce(new.cancelled_at, now()),
        cancelled_by = new.cancelled_by,
        updated_at = now()
    where sale_id = new.id
      and status <> 'cancelled';
  end if;
  return new;
end;
$$;

revoke all on function private.sync_web_order_sale_cancellation() from public;

create trigger sync_web_order_sale_cancellation
after update of status on public.sales
for each row
when (old.status is distinct from new.status)
execute function private.sync_web_order_sale_cancellation();
