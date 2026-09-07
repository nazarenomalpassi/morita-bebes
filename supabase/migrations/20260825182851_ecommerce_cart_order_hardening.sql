alter table public.web_orders
  add column if not exists idempotency_key uuid;

create unique index if not exists web_orders_customer_idempotency_key_idx
  on public.web_orders (organization_id, customer_user_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.get_store_cart_snapshot(
  p_organization_slug text,
  p_product_ids uuid[]
)
returns table (
  id uuid,
  slug text,
  name text,
  display_price numeric,
  price_kind text,
  wholesale_available boolean,
  minimum_quantity numeric,
  current_stock numeric,
  unit text,
  category_slug text,
  cover_image_path text,
  is_available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with context as (
    select
      organization.id as organization_id,
      exists (
        select 1
        from public.store_customer_profiles profile
        where profile.user_id = (select auth.uid())
          and profile.organization_id = organization.id
          and profile.customer_type = 'wholesale'
          and profile.wholesale_status = 'approved'
      ) as is_approved_wholesale
    from public.organizations organization
    join public.site_settings settings on settings.organization_id = organization.id
    where organization.slug = p_organization_slug
      and settings.store_online
  )
  select
    product.id,
    product.store_slug as slug,
    product.name,
    case when context.is_approved_wholesale then product.wholesale_price else product.retail_price end as display_price,
    case when context.is_approved_wholesale then 'wholesale' else 'retail' end as price_kind,
    context.is_approved_wholesale
      and product.wholesale_price is not null
      and product.wholesale_price > 0 as wholesale_available,
    case when context.is_approved_wholesale then product.wholesale_min_quantity else 1 end as minimum_quantity,
    product.current_stock,
    product.unit,
    category.slug as category_slug,
    coalesce(primary_image.storage_path, product.image_path) as cover_image_path,
    product.is_active and product.is_published as is_available
  from context
  join public.products product on product.organization_id = context.organization_id
  left join public.categories category
    on category.id = product.category_id
    and category.organization_id = product.organization_id
  left join lateral (
    select image.storage_path
    from public.product_images image
    where image.product_id = product.id
      and image.organization_id = product.organization_id
    order by image.is_primary desc, image.sort_order, image.created_at
    limit 1
  ) primary_image on true
  where product.id = any(coalesce(p_product_ids, array[]::uuid[]))
    and cardinality(coalesce(p_product_ids, array[]::uuid[])) between 1 and 100;
$$;

revoke all on function public.get_store_cart_snapshot(text, uuid[]) from public;
grant execute on function public.get_store_cart_snapshot(text, uuid[]) to anon, authenticated, service_role;

create or replace function public.create_web_order_idempotent(
  p_organization_slug text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  existing_order public.web_orders%rowtype;
  result jsonb;
  normalized_items jsonb;
  whatsapp_number text;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Iniciá sesión para generar el pedido';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'La solicitud del pedido no es válida';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || p_idempotency_key::text, 0)
  );

  select orders.* into existing_order
  from public.web_orders orders
  join public.organizations organization on organization.id = orders.organization_id
  where orders.customer_user_id = actor_id
    and orders.idempotency_key = p_idempotency_key
    and organization.slug = p_organization_slug;

  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', item.product_id,
          'product_name', item.product_name,
          'product_sku', item.product_sku,
          'quantity', item.quantity,
          'unit_price', item.unit_price
        ) order by item.created_at
      ),
      '[]'::jsonb
    ) into normalized_items
    from public.web_order_items item
    where item.order_id = existing_order.id
      and item.organization_id = existing_order.organization_id;

    select settings.whatsapp into whatsapp_number
    from public.site_settings settings
    where settings.organization_id = existing_order.organization_id;

    return jsonb_build_object(
      'id', existing_order.id,
      'order_number', existing_order.order_number,
      'total', existing_order.total,
      'customer_type', existing_order.customer_type,
      'customer_name', existing_order.customer_name,
      'customer_phone', existing_order.customer_phone,
      'customer_locality', existing_order.customer_locality,
      'customer_province', existing_order.customer_province,
      'whatsapp', whatsapp_number,
      'items', normalized_items
    );
  end if;

  result := public.create_web_order(p_organization_slug, p_items, p_notes);

  update public.web_orders orders
  set idempotency_key = p_idempotency_key
  where orders.id = (result ->> 'id')::uuid
    and orders.customer_user_id = actor_id;

  return result;
end;
$$;

revoke all on function public.create_web_order_idempotent(text, jsonb, uuid, text) from public, anon;
grant execute on function public.create_web_order_idempotent(text, jsonb, uuid, text) to authenticated, service_role;

comment on column public.web_orders.idempotency_key is
  'Clave por intento de checkout. Evita pedidos duplicados ante reintentos o doble envío.';
comment on function public.get_store_cart_snapshot(text, uuid[]) is
  'Revalida precio, tipo de cuenta, publicación y stock del carrito con datos actuales.';
comment on function public.create_web_order_idempotent(text, jsonb, uuid, text) is
  'Crea o recupera el mismo pedido para una clave idempotente del cliente autenticado.';
