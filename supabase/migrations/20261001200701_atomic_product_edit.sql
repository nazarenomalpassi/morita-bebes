create function public.update_product_details(
  p_organization_id uuid,
  p_product_id uuid,
  p_values jsonb,
  p_original_stock numeric,
  p_requested_stock numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_product public.products%rowtype;
  changes public.products%rowtype;
begin
  if not private.has_org_role(p_organization_id, array['owner', 'admin', 'staff']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'Not authorized to edit this product';
  end if;
  if jsonb_typeof(p_values) is distinct from 'object'
    or p_original_stock is null or p_requested_stock is null
    or p_original_stock < 0 or p_requested_stock < 0
    or p_original_stock > 999999999 or p_requested_stock > 999999999
    or p_original_stock <> round(p_original_stock, 3)
    or p_requested_stock <> round(p_requested_stock, 3) then
    raise exception using errcode = '22023', message = 'Invalid product edit values';
  end if;

  select * into current_product from public.products
  where id = p_product_id and organization_id = p_organization_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Product not found'; end if;

  -- A stale price/description form must never undo a sale made after it opened.
  if p_requested_stock <> p_original_stock and current_product.current_stock <> p_original_stock then
    raise exception using errcode = '40001', message = 'Product stock changed while editing';
  end if;
  changes := jsonb_populate_record(current_product, p_values);
  update public.products set
    name = changes.name, sku = changes.sku, barcode = changes.barcode,
    unit = changes.unit, description = changes.description, image_path = changes.image_path,
    category_id = changes.category_id, brand_id = changes.brand_id,
    default_supplier_id = changes.default_supplier_id,
    cost_price = changes.cost_price, retail_price = changes.retail_price,
    wholesale_price = changes.wholesale_price, wholesale_min_quantity = changes.wholesale_min_quantity,
    min_stock = changes.min_stock, target_stock = changes.target_stock,
    commercial_description = changes.commercial_description,
    is_featured = changes.is_featured, is_published = changes.is_published,
    hide_when_out_of_stock = changes.hide_when_out_of_stock,
    seo_title = changes.seo_title, seo_description = changes.seo_description,
    store_slug = changes.store_slug
  where id = p_product_id and organization_id = p_organization_id;
  if p_requested_stock <> p_original_stock then
    perform public.adjust_inventory(
      p_organization_id, p_product_id, p_requested_stock - current_product.current_stock,
      'Stock total actualizado desde la edicion del producto a ' || p_requested_stock::text
    );
  end if;
  return p_product_id;
end;
$$;

revoke all on function public.update_product_details(uuid, uuid, jsonb, numeric, numeric) from public, anon;
grant execute on function public.update_product_details(uuid, uuid, jsonb, numeric, numeric) to authenticated;
comment on function public.update_product_details(uuid, uuid, jsonb, numeric, numeric) is
  'Atomic, RLS-protected product editing. Unchanged stock is preserved; deliberate stock changes reject stale snapshots and keep the inventory ledger.';
notify pgrst, 'reload schema';
