alter table public.sale_items
  add column product_name_snapshot text,
  add column product_sku_snapshot text;

update public.sale_items as item
set product_name_snapshot = coalesce(
      nullif(trim(item.legacy_product_name), ''),
      product.name,
      'Producto sin nombre'
    ),
    product_sku_snapshot = coalesce(
      nullif(trim(item.legacy_product_code), ''),
      product.sku
    )
from public.products as product
where product.id = item.product_id
  and product.organization_id = item.organization_id;

update public.sale_items
set product_name_snapshot = coalesce(
      nullif(trim(legacy_product_name), ''),
      'Producto sin nombre'
    ),
    product_sku_snapshot = nullif(trim(legacy_product_code), '')
where product_name_snapshot is null;

alter table public.sale_items
  alter column product_name_snapshot set not null,
  add constraint sale_items_product_name_snapshot_check
    check (char_length(trim(product_name_snapshot)) between 1 and 240);

comment on column public.sale_items.product_name_snapshot is
  'Immutable product name captured when the sale item is created.';
comment on column public.sale_items.product_sku_snapshot is
  'Immutable product SKU or legacy code captured when the sale item is created.';

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

    new.product_name_snapshot := coalesce(
      nullif(trim(new.product_name_snapshot), ''),
      nullif(trim(new.legacy_product_name), ''),
      captured_product_name
    );
    new.product_sku_snapshot := coalesce(
      nullif(trim(new.product_sku_snapshot), ''),
      nullif(trim(new.legacy_product_code), ''),
      captured_product_sku
    );

    return new;
  end if;

  if (select auth.uid()) is not null
    and not private.can_edit_sale(target_organization_id, target_sale_id) then
    raise exception using errcode = '42501', message = 'Sale items can only be changed while an authorized draft is open';
  end if;

  if tg_op = 'UPDATE'
    and (
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
    new.unit_price := captured_retail_price;
    new.product_name_snapshot := captured_product_name;
    new.product_sku_snapshot := captured_product_sku;
    new.legacy_product_name := null;
    new.legacy_product_code := null;
    new.legacy_barcode := null;
    new.legacy_payload := '{}'::jsonb;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.get_sale_receipt(p_sale_id uuid)
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

  select sale.*
  into target_sale
  from public.sales as sale
  join public.organization_members as member
    on member.organization_id = sale.organization_id
   and member.user_id = actor_id
   and member.is_active
  where sale.id = p_sale_id
    and (
      member.role in ('owner', 'admin')
      or (member.role = 'staff' and sale.created_by = actor_id)
    );

  if not found then
    raise exception using errcode = 'P0002', message = 'Sale receipt was not found';
  end if;

  select jsonb_build_object(
    'display_number', coalesce(
      nullif(trim(target_sale.legacy_sale_number), ''),
      nullif(trim(target_sale.reference), ''),
      upper(substr(replace(target_sale.id::text, '-', ''), 1, 8))
    ),
    'source', target_sale.source,
    'status', target_sale.status,
    'occurred_at', target_sale.occurred_at,
    'original_time_known', target_sale.original_time_known,
    'item_detail_status', target_sale.item_detail_status,
    'subtotal', target_sale.subtotal,
    'discount', target_sale.discount,
    'vat_10_5', target_sale.vat_10_5,
    'vat_21', target_sale.vat_21,
    'rounding_adjustment', target_sale.rounding_adjustment,
    'total', target_sale.total,
    'customer', case
      when customer.id is null and nullif(trim(target_sale.legacy_customer_name), '') is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'name', coalesce(customer.name, nullif(trim(target_sale.legacy_customer_name), '')),
        'phone', coalesce(nullif(trim(customer.whatsapp), ''), nullif(trim(customer.phone), ''))
      ))
    end,
    'seller_name', coalesce(
      nullif(trim(profile.display_name), ''),
      nullif(trim(target_sale.legacy_seller_name), '')
    ),
    'payments', case
      when coalesce(payment_method.name, nullif(trim(target_sale.legacy_payment_method), '')) is null
        then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'method', coalesce(payment_method.name, nullif(trim(target_sale.legacy_payment_method), '')),
        'amount', target_sale.total
      ))
    end,
    'business', jsonb_strip_nulls(jsonb_build_object(
      'name', organization.name,
      'address', nullif(trim(settings.address), ''),
      'whatsapp', nullif(trim(settings.whatsapp), ''),
      'email', nullif(trim(settings.email), '')
    )),
    'items', coalesce(items.rows, '[]'::jsonb)
  )
  into receipt
  from public.organizations as organization
  left join public.customers as customer
    on customer.id = target_sale.customer_id
   and customer.organization_id = target_sale.organization_id
  left join public.payment_methods as payment_method
    on payment_method.id = target_sale.payment_method_id
   and payment_method.organization_id = target_sale.organization_id
  left join public.user_profiles as profile
    on profile.user_id = target_sale.created_by
  left join public.site_settings as settings
    on settings.organization_id = target_sale.organization_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'name', item.product_name_snapshot,
        'sku', item.product_sku_snapshot,
        'quantity', item.quantity,
        'unit_price', item.unit_price,
        'discount', item.discount,
        'line_total', item.line_total
      )
      order by item.created_at, item.id
    ) as rows
    from public.sale_items as item
    where item.sale_id = target_sale.id
      and item.organization_id = target_sale.organization_id
  ) as items on true
  where organization.id = target_sale.organization_id;

  return receipt;
end;
$$;

revoke all on function public.get_sale_receipt(uuid) from public, anon;
grant execute on function public.get_sale_receipt(uuid) to authenticated, service_role;

comment on function public.get_sale_receipt(uuid) is
  'Returns the customer-safe immutable representation of an authorized sale receipt.';
