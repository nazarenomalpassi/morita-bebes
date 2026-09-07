-- Staff maintain the catalog continuously. Keep structural columns protected,
-- but allow every product field exposed by the inventory editor.
grant update (
  category_id,
  brand_id,
  default_supplier_id,
  name,
  sku,
  barcode,
  description,
  commercial_description,
  cost_price,
  retail_price,
  wholesale_price,
  wholesale_min_quantity,
  min_stock,
  target_stock,
  unit,
  image_path,
  is_active,
  is_published,
  is_featured,
  hide_when_out_of_stock,
  store_slug,
  seo_title,
  seo_description
) on public.products to authenticated;

comment on policy "operational members update products" on public.products is
  'Every active organization member, including staff, may edit catalog and pricing fields. Structural identity and stock history remain protected.';
