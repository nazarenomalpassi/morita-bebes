alter table public.products
  alter column store_slug set default '';

comment on column public.products.store_slug is
  'URL slug populated by the prepare_product_storefront_fields trigger. The empty default keeps inserts compatible with generated clients.';
