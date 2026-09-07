create type public.store_customer_type as enum ('retail', 'wholesale');
create type public.wholesale_account_status as enum (
  'not_requested',
  'pending',
  'approved',
  'rejected',
  'suspended'
);
create type public.web_order_status as enum (
  'pending',
  'contacted',
  'confirmed',
  'preparing',
  'ready',
  'completed',
  'cancelled'
);

create function private.store_slugify(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(value, 'producto')), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

revoke all on function private.store_slugify(text) from public;

alter table public.products
  add column store_slug text,
  add column commercial_description text,
  add column hide_when_out_of_stock boolean not null default false,
  add column published_at timestamptz,
  add column seo_title text,
  add column seo_description text;

update public.products
set store_slug = private.store_slugify(name) || '-' || left(replace(id::text, '-', ''), 6),
    published_at = case when is_published then coalesce(published_at, updated_at, now()) else null end;

alter table public.products
  alter column store_slug set not null,
  add constraint products_store_slug_format_check
    check (store_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  add constraint products_commercial_description_check
    check (commercial_description is null or char_length(commercial_description) <= 4000),
  add constraint products_seo_title_check
    check (seo_title is null or char_length(seo_title) <= 70),
  add constraint products_seo_description_check
    check (seo_description is null or char_length(seo_description) <= 180);

create unique index products_org_store_slug_key
  on public.products (organization_id, store_slug);

create function private.prepare_product_storefront_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.store_slug is null or btrim(new.store_slug) = '' then
    new.store_slug := private.store_slugify(new.name) || '-' || left(replace(new.id::text, '-', ''), 6);
  else
    new.store_slug := private.store_slugify(new.store_slug);
  end if;

  if new.is_published and (tg_op = 'INSERT' or not coalesce(old.is_published, false)) then
    new.published_at := now();
  elsif not new.is_published then
    new.published_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.prepare_product_storefront_fields() from public;

create trigger prepare_product_storefront_fields
before insert or update on public.products
for each row execute function private.prepare_product_storefront_fields();

alter table public.categories
  add column image_path text,
  add column store_description text,
  add column is_featured_online boolean not null default false;

alter table public.categories
  add constraint categories_store_description_check
    check (store_description is null or char_length(store_description) <= 500);

alter table public.brands
  add column logo_path text,
  add column is_featured_online boolean not null default false;

alter table public.site_settings
  add column minimum_retail_amount numeric(14, 2) not null default 20000
    check (minimum_retail_amount >= 0),
  add column store_online boolean not null default true,
  add column store_description text,
  add column shipping_message text,
  add column whatsapp_prefill text not null default 'Hola Morita Bebés, quiero consultar por un pedido.';

update public.site_settings
set minimum_retail_amount = 20000,
    minimum_wholesale_amount = coalesce(minimum_wholesale_amount, 500000),
    wholesale_visibility = 'registered',
    homepage_title = 'Todo para acompañar sus primeros momentos',
    homepage_message = coalesce(homepage_message, 'Productos para bebés elegidos con cuidado, precios claros y atención cercana.'),
    store_description = coalesce(store_description, 'Pañalera y tienda de productos para bebés. Compras minoristas y mayoristas por pedido.'),
    shipping_message = coalesce(shipping_message, 'Coordinamos retiro o envío por WhatsApp.');

create table public.store_customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  first_name text not null check (char_length(btrim(first_name)) between 2 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 2 and 80),
  phone text not null check (char_length(btrim(phone)) between 6 and 40),
  locality text not null check (char_length(btrim(locality)) between 2 and 120),
  province text not null check (char_length(btrim(province)) between 2 and 120),
  business_name text,
  cuit text,
  address text,
  customer_type public.store_customer_type not null default 'retail',
  wholesale_status public.wholesale_account_status not null default 'not_requested',
  wholesale_review_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_customer_profiles_email_check check (email = lower(btrim(email))),
  constraint store_customer_profiles_wholesale_consistency_check check (
    (customer_type = 'retail' and wholesale_status in ('not_requested', 'pending', 'rejected', 'suspended'))
    or customer_type = 'wholesale'
  )
);

create index store_customer_profiles_org_status_idx
  on public.store_customer_profiles (organization_id, wholesale_status, created_at desc);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  storage_path text not null check (char_length(btrim(storage_path)) between 3 and 500),
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_images_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete cascade,
  constraint product_images_path_key unique (organization_id, storage_path)
);

create unique index product_images_single_primary_idx
  on public.product_images (product_id)
  where is_primary;
create index product_images_product_order_idx
  on public.product_images (product_id, sort_order, created_at);

create table public.store_banners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 100),
  subtitle text,
  image_path text not null,
  cta_label text,
  cta_href text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index store_banners_org_active_order_idx
  on public.store_banners (organization_id, sort_order)
  where is_active;

create sequence public.web_order_number_seq start 1;

create table public.web_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_number text not null default ('MB-' || lpad(nextval('public.web_order_number_seq')::text, 6, '0')),
  customer_user_id uuid not null references auth.users(id) on delete restrict,
  customer_type public.store_customer_type not null,
  status public.web_order_status not null default 'pending',
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  customer_locality text not null,
  customer_province text not null,
  customer_business_name text,
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  total numeric(14, 2) not null check (total >= 0 and total = subtotal),
  minimum_amount numeric(14, 2) not null check (minimum_amount >= 0),
  notes text,
  source text not null default 'ecommerce' check (source = 'ecommerce'),
  contacted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint web_orders_id_org_unique unique (id, organization_id),
  constraint web_orders_org_order_number_key unique (organization_id, order_number)
);

create index web_orders_org_status_created_idx
  on public.web_orders (organization_id, status, created_at desc);
create index web_orders_customer_created_idx
  on public.web_orders (customer_user_id, created_at desc);

create table public.web_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  product_id uuid not null,
  product_name text not null,
  product_sku text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  line_total numeric(14, 2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now(),
  constraint web_order_items_order_fk foreign key (order_id, organization_id)
    references public.web_orders(id, organization_id) on delete cascade,
  constraint web_order_items_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete restrict,
  constraint web_order_items_order_product_key unique (order_id, product_id)
);

create index web_order_items_order_idx on public.web_order_items (order_id);

create unique index inventory_web_order_reference_key
  on public.inventory_movements (organization_id, reference_type, reference_id, product_id)
  where reference_type in ('web_order_confirm', 'web_order_cancel') and reference_id is not null;

create trigger set_store_customer_profiles_updated_at
before update on public.store_customer_profiles
for each row execute function private.set_updated_at();
create trigger set_product_images_updated_at
before update on public.product_images
for each row execute function private.set_updated_at();
create trigger set_store_banners_updated_at
before update on public.store_banners
for each row execute function private.set_updated_at();
create trigger set_web_orders_updated_at
before update on public.web_orders
for each row execute function private.set_updated_at();

create function private.sync_store_customer_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  target_organization_id uuid;
  requested_type public.store_customer_type;
begin
  if coalesce(metadata ->> 'store_registration', 'false') <> 'true' then
    return new;
  end if;

  select id into target_organization_id
  from public.organizations
  where slug = coalesce(nullif(metadata ->> 'organization_slug', ''), 'morita-bebes')
  limit 1;

  if target_organization_id is null then
    return new;
  end if;

  requested_type := case when metadata ->> 'customer_type' = 'wholesale'
    then 'wholesale'::public.store_customer_type
    else 'retail'::public.store_customer_type
  end;

  insert into public.store_customer_profiles (
    user_id, organization_id, email, first_name, last_name, phone, locality,
    province, business_name, cuit, address, customer_type, wholesale_status
  ) values (
    new.id,
    target_organization_id,
    lower(new.email),
    left(coalesce(nullif(btrim(metadata ->> 'first_name'), ''), 'Cliente'), 80),
    left(coalesce(nullif(btrim(metadata ->> 'last_name'), ''), 'Morita'), 80),
    left(coalesce(nullif(btrim(metadata ->> 'phone'), ''), 'Sin informar'), 40),
    left(coalesce(nullif(btrim(metadata ->> 'locality'), ''), 'Sin informar'), 120),
    left(coalesce(nullif(btrim(metadata ->> 'province'), ''), 'Córdoba'), 120),
    nullif(left(btrim(metadata ->> 'business_name'), 160), ''),
    nullif(left(btrim(metadata ->> 'cuit'), 20), ''),
    nullif(left(btrim(metadata ->> 'address'), 240), ''),
    requested_type,
    case when requested_type = 'wholesale'
      then 'pending'::public.wholesale_account_status
      else 'not_requested'::public.wholesale_account_status
    end
  )
  on conflict (user_id) do update set
    email = excluded.email,
    updated_at = now();

  return new;
end;
$$;

revoke all on function private.sync_store_customer_profile() from public;

create trigger sync_store_customer_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function private.sync_store_customer_profile();

create function private.guard_store_customer_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) = old.user_id
    and not private.has_org_role(old.organization_id, array['owner', 'admin']::public.app_role[])
    and (
      new.organization_id is distinct from old.organization_id
      or new.email is distinct from old.email
      or new.customer_type is distinct from old.customer_type
      or new.wholesale_status is distinct from old.wholesale_status
      or new.wholesale_review_notes is distinct from old.wholesale_review_notes
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
    ) then
    raise exception using errcode = '42501', message = 'Commercial account status is managed by Morita Bebés';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_store_customer_profile_update() from public;

create trigger guard_store_customer_profile_update
before update on public.store_customer_profiles
for each row execute function private.guard_store_customer_profile_update();

alter table public.store_customer_profiles enable row level security;
alter table public.product_images enable row level security;
alter table public.store_banners enable row level security;
alter table public.web_orders enable row level security;
alter table public.web_order_items enable row level security;

create policy "customers read own storefront profile"
on public.store_customer_profiles for select to authenticated
using ((select auth.uid()) = user_id);
create policy "customers update own storefront profile"
on public.store_customer_profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "administrators manage storefront profiles"
on public.store_customer_profiles for all to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "public reads published product images"
on public.product_images for select to anon, authenticated
using (exists (
  select 1 from public.products
  where products.id = product_images.product_id
    and products.organization_id = product_images.organization_id
    and products.is_active and products.is_published
));
create policy "administrators manage product images"
on public.product_images for all to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "public reads active storefront banners"
on public.store_banners for select to anon, authenticated
using (is_active);
create policy "administrators manage storefront banners"
on public.store_banners for all to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "customers read own web orders"
on public.web_orders for select to authenticated
using ((select auth.uid()) = customer_user_id);
create policy "administrators read web orders"
on public.web_orders for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "customers read own web order items"
on public.web_order_items for select to authenticated
using (exists (
  select 1 from public.web_orders
  where web_orders.id = web_order_items.order_id
    and web_orders.organization_id = web_order_items.organization_id
    and web_orders.customer_user_id = (select auth.uid())
));
create policy "administrators read web order items"
on public.web_order_items for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "public reads storefront categories"
on public.categories for select to anon, authenticated
using (is_active);
create policy "public reads storefront brands"
on public.brands for select to anon, authenticated
using (is_active);
create policy "public reads storefront settings"
on public.site_settings for select to anon, authenticated
using (store_online);

grant usage on schema public to anon;
grant select on public.categories, public.brands, public.site_settings,
  public.product_images, public.store_banners to anon;
grant select, update on public.store_customer_profiles to authenticated;
grant select, insert, update, delete on public.product_images, public.store_banners to authenticated;
grant select on public.web_orders, public.web_order_items to authenticated;
grant all privileges on public.store_customer_profiles, public.product_images,
  public.store_banners, public.web_orders, public.web_order_items to service_role;
grant usage, select on sequence public.web_order_number_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-media',
  'store-media',
  true,
  6291456,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "store administrators upload media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'store-media'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and private.has_org_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin']::public.app_role[])
);
create policy "store administrators update media"
on storage.objects for update to authenticated
using (
  bucket_id = 'store-media'
  and private.has_org_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin']::public.app_role[])
)
with check (
  bucket_id = 'store-media'
  and private.has_org_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin']::public.app_role[])
);
create policy "store administrators delete media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'store-media'
  and private.has_org_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin']::public.app_role[])
);

create function public.list_store_products(
  p_organization_slug text default 'morita-bebes',
  p_search text default null,
  p_category_slug text default null,
  p_brand_id uuid default null,
  p_availability text default 'all',
  p_sort text default 'featured',
  p_product_slug text default null,
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  display_price numeric,
  retail_price numeric,
  price_kind text,
  wholesale_available boolean,
  minimum_quantity numeric,
  current_stock numeric,
  unit text,
  category_id uuid,
  category_name text,
  category_slug text,
  brand_id uuid,
  brand_name text,
  cover_image_path text,
  is_featured boolean,
  is_new boolean,
  total_count bigint
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
  ), catalog as (
    select
      product.id,
      product.store_slug as slug,
      product.name,
      coalesce(product.commercial_description, product.description) as description,
      case when context.is_approved_wholesale then product.wholesale_price else product.retail_price end as display_price,
      product.retail_price,
      case when context.is_approved_wholesale then 'wholesale' else 'retail' end as price_kind,
      context.is_approved_wholesale and product.wholesale_price is not null and product.wholesale_price > 0 as wholesale_available,
      case when context.is_approved_wholesale then product.wholesale_min_quantity else 1 end as minimum_quantity,
      product.current_stock,
      product.unit,
      category.id as category_id,
      category.name as category_name,
      category.slug as category_slug,
      brand.id as brand_id,
      brand.name as brand_name,
      coalesce(primary_image.storage_path, product.image_path) as cover_image_path,
      product.is_featured,
      product.published_at >= now() - interval '45 days' as is_new,
      product.published_at,
      context.is_approved_wholesale
    from context
    join public.products product on product.organization_id = context.organization_id
    left join public.categories category on category.id = product.category_id and category.organization_id = product.organization_id
    left join public.brands brand on brand.id = product.brand_id and brand.organization_id = product.organization_id
    left join lateral (
      select image.storage_path
      from public.product_images image
      where image.product_id = product.id
        and image.organization_id = product.organization_id
      order by image.is_primary desc, image.sort_order, image.created_at
      limit 1
    ) primary_image on true
    where product.is_active
      and product.is_published
      and (not product.hide_when_out_of_stock or product.current_stock > 0)
      and (p_product_slug is null or product.store_slug = p_product_slug)
      and (p_category_slug is null or category.slug = p_category_slug)
      and (p_brand_id is null or brand.id = p_brand_id)
      and (p_availability <> 'in_stock' or product.current_stock > 0)
      and (
        p_search is null or btrim(p_search) = ''
        or product.name ilike '%' || btrim(p_search) || '%'
        or coalesce(product.commercial_description, product.description, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(brand.name, '') ilike '%' || btrim(p_search) || '%'
      )
  )
  select
    catalog.id, catalog.slug, catalog.name, catalog.description,
    catalog.display_price, catalog.retail_price, catalog.price_kind,
    catalog.wholesale_available, catalog.minimum_quantity, catalog.current_stock,
    catalog.unit, catalog.category_id, catalog.category_name, catalog.category_slug,
    catalog.brand_id, catalog.brand_name, catalog.cover_image_path,
    catalog.is_featured, catalog.is_new, count(*) over() as total_count
  from catalog
  order by
    case when p_sort = 'price_asc' then catalog.display_price end asc nulls last,
    case when p_sort = 'price_desc' then catalog.display_price end desc nulls last,
    case when p_sort = 'newest' then catalog.published_at end desc nulls last,
    case when p_sort = 'name' then catalog.name end asc,
    case when p_sort = 'featured' then catalog.is_featured end desc,
    catalog.name asc
  limit greatest(1, least(coalesce(p_limit, 24), 60))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_store_products(text, text, text, uuid, text, text, text, integer, integer) from public;
grant execute on function public.list_store_products(text, text, text, uuid, text, text, text, integer, integer) to anon, authenticated, service_role;

create function public.create_web_order(
  p_organization_slug text,
  p_items jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  profile public.store_customer_profiles%rowtype;
  settings public.site_settings%rowtype;
  requested record;
  product_row public.products%rowtype;
  normalized_items jsonb := '[]'::jsonb;
  item_price numeric(14, 2);
  order_subtotal numeric(14, 2) := 0;
  required_minimum numeric(14, 2);
  created_order public.web_orders%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Iniciá sesión para generar el pedido';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception using errcode = '22023', message = 'El carrito no contiene productos válidos';
  end if;

  select customer.* into profile
  from public.store_customer_profiles customer
  join public.organizations organization on organization.id = customer.organization_id
  where customer.user_id = actor_id and organization.slug = p_organization_slug;
  if not found then
    raise exception using errcode = '42501', message = 'Completá tu cuenta de la tienda antes de generar el pedido';
  end if;

  select site.* into settings
  from public.site_settings site
  where site.organization_id = profile.organization_id and site.store_online;
  if not found then
    raise exception using errcode = '55000', message = 'La tienda no está disponible en este momento';
  end if;

  if (
    select count(*) <> count(distinct (item ->> 'product_id'))
    from jsonb_array_elements(p_items) item
  ) then
    raise exception using errcode = '22023', message = 'El carrito contiene productos duplicados';
  end if;

  for requested in
    select (item ->> 'product_id')::uuid as product_id, (item ->> 'quantity')::numeric as quantity
    from jsonb_array_elements(p_items) item
  loop
    if requested.quantity <= 0 or requested.quantity > 999 then
      raise exception using errcode = '22023', message = 'Revisá las cantidades del carrito';
    end if;

    select * into product_row
    from public.products
    where id = requested.product_id
      and organization_id = profile.organization_id
      and is_active and is_published
      and (not hide_when_out_of_stock or current_stock > 0)
    for share;
    if not found then
      raise exception using errcode = 'P0002', message = 'Uno de los productos ya no está publicado';
    end if;
    if product_row.current_stock < requested.quantity then
      raise exception using errcode = '23514', message = format('Solo quedan %s unidades de %s', product_row.current_stock, product_row.name);
    end if;

    if profile.customer_type = 'wholesale' and profile.wholesale_status = 'approved' then
      if product_row.wholesale_price is null or product_row.wholesale_price <= 0 then
        raise exception using errcode = '23514', message = format('%s requiere consulta de precio mayorista', product_row.name);
      end if;
      if requested.quantity < product_row.wholesale_min_quantity then
        raise exception using errcode = '23514', message = format('La cantidad mínima mayorista de %s es %s', product_row.name, product_row.wholesale_min_quantity);
      end if;
      item_price := product_row.wholesale_price;
    else
      item_price := product_row.retail_price;
    end if;

    order_subtotal := order_subtotal + requested.quantity * item_price;
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
      'product_id', product_row.id,
      'product_name', product_row.name,
      'product_sku', product_row.sku,
      'quantity', requested.quantity,
      'unit_price', item_price
    ));
  end loop;

  required_minimum := case
    when profile.customer_type = 'wholesale' and profile.wholesale_status = 'approved'
      then coalesce(settings.minimum_wholesale_amount, 500000)
    else settings.minimum_retail_amount
  end;
  if order_subtotal < required_minimum then
    raise exception using errcode = '23514', message = format('Faltan $%s para alcanzar la compra mínima', required_minimum - order_subtotal);
  end if;

  insert into public.web_orders (
    organization_id, customer_user_id, customer_type, customer_name,
    customer_email, customer_phone, customer_locality, customer_province,
    customer_business_name, subtotal, total, minimum_amount, notes
  ) values (
    profile.organization_id,
    actor_id,
    case when profile.customer_type = 'wholesale' and profile.wholesale_status = 'approved'
      then 'wholesale'::public.store_customer_type else 'retail'::public.store_customer_type end,
    btrim(profile.first_name || ' ' || profile.last_name),
    profile.email,
    profile.phone,
    profile.locality,
    profile.province,
    profile.business_name,
    order_subtotal,
    order_subtotal,
    required_minimum,
    nullif(btrim(p_notes), '')
  ) returning * into created_order;

  insert into public.web_order_items (
    organization_id, order_id, product_id, product_name, product_sku, quantity, unit_price
  )
  select
    profile.organization_id,
    created_order.id,
    (item ->> 'product_id')::uuid,
    item ->> 'product_name',
    item ->> 'product_sku',
    (item ->> 'quantity')::numeric,
    (item ->> 'unit_price')::numeric
  from jsonb_array_elements(normalized_items) item;

  return jsonb_build_object(
    'id', created_order.id,
    'order_number', created_order.order_number,
    'total', created_order.total,
    'customer_type', created_order.customer_type,
    'customer_name', created_order.customer_name,
    'customer_phone', created_order.customer_phone,
    'customer_locality', created_order.customer_locality,
    'customer_province', created_order.customer_province,
    'whatsapp', settings.whatsapp,
    'items', normalized_items
  );
end;
$$;

revoke all on function public.create_web_order(text, jsonb, text) from public, anon;
grant execute on function public.create_web_order(text, jsonb, text) to authenticated, service_role;

create function public.transition_web_order(
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
  current_stock numeric;
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
    return jsonb_build_object('id', target_order.id, 'status', target_order.status, 'order_number', target_order.order_number);
  end if;

  allowed := case target_order.status
    when 'pending' then p_status in ('contacted', 'confirmed', 'cancelled')
    when 'contacted' then p_status in ('confirmed', 'cancelled')
    when 'confirmed' then p_status in ('preparing', 'cancelled')
    when 'preparing' then p_status in ('ready', 'cancelled')
    when 'ready' then p_status in ('completed', 'cancelled')
    else false
  end;
  if not allowed then
    raise exception using errcode = '22023', message = 'La transición de estado no es válida';
  end if;

  if p_status = 'confirmed' then
    for order_item in
      select item.* from public.web_order_items item
      where item.order_id = target_order.id
      order by item.product_id
    loop
      select product.current_stock into current_stock
      from public.products product
      where product.id = order_item.product_id and product.organization_id = target_order.organization_id
      for update;
      if current_stock is null or current_stock < order_item.quantity then
        raise exception using errcode = '23514', message = format('Stock insuficiente para %s', order_item.product_name);
      end if;
      insert into public.inventory_movements (
        organization_id, product_id, kind, quantity_delta, reference_type,
        reference_id, notes, created_by
      ) values (
        target_order.organization_id, order_item.product_id, 'adjustment', -order_item.quantity,
        'web_order_confirm', target_order.id,
        'Pedido web confirmado ' || target_order.order_number, actor_id
      ) on conflict (organization_id, reference_type, reference_id, product_id)
        where reference_type in ('web_order_confirm', 'web_order_cancel') and reference_id is not null
        do nothing;
    end loop;
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
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
    confirmed_by = case when p_status = 'confirmed' then actor_id else confirmed_by end,
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by = case when p_status = 'cancelled' then actor_id else cancelled_by end
  where id = target_order.id
  returning * into target_order;

  return jsonb_build_object('id', target_order.id, 'status', target_order.status, 'order_number', target_order.order_number);
end;
$$;

revoke all on function public.transition_web_order(uuid, public.web_order_status) from public, anon;
grant execute on function public.transition_web_order(uuid, public.web_order_status) to authenticated, service_role;

update public.products
set is_published = true,
    published_at = coalesce(published_at, now())
where is_active and retail_price > 0 and not is_published;

insert into public.store_banners (
  organization_id, title, subtitle, image_path, cta_label, cta_href, sort_order
)
select id, 'Todo para acompañar sus primeros momentos',
  'Pañales, cuidado, alimentación y juegos elegidos con cariño.',
  '/store/hero-morita.webp', 'Ver productos', '/tienda/productos', 10
from public.organizations where slug = 'morita-bebes'
on conflict do nothing;

comment on function public.list_store_products(text, text, text, uuid, text, text, text, integer, integer) is
  'Returns customer-safe storefront products. Wholesale prices are emitted only for approved wholesale accounts.';
comment on function public.create_web_order(text, jsonb, text) is
  'Validates current stock and server-side prices, snapshots order items, and never changes stock.';
comment on function public.transition_web_order(uuid, public.web_order_status) is
  'Applies the web order state machine and idempotent inventory movements on confirmation/cancellation.';
