create function public.get_store_product_metadata(
  p_organization_slug text,
  p_product_slug text
)
returns table (seo_title text, seo_description text)
language sql
stable
security definer
set search_path = ''
as $$
  select product.seo_title, product.seo_description
  from public.products product
  join public.organizations organization on organization.id = product.organization_id
  join public.site_settings settings on settings.organization_id = product.organization_id
  where organization.slug = p_organization_slug
    and settings.store_online
    and product.store_slug = p_product_slug
    and product.is_active
    and product.is_published
  limit 1;
$$;

revoke all on function public.get_store_product_metadata(text, text) from public;
grant execute on function public.get_store_product_metadata(text, text) to anon, authenticated, service_role;

with organizations_without_featured as (
  select organization_id
  from public.products
  group by organization_id
  having not bool_or(is_featured)
), ranked as (
  select product.id,
         row_number() over (
           partition by product.organization_id
           order by count(sale_item.id) desc, product.current_stock desc, product.name
         ) as position
  from public.products product
  join organizations_without_featured eligible on eligible.organization_id = product.organization_id
  left join public.sale_items sale_item on sale_item.product_id = product.id
  where product.is_active and product.is_published and product.current_stock > 0
  group by product.id
)
update public.products product
set is_featured = true
from ranked
where product.id = ranked.id and ranked.position <= 8;

comment on function public.get_store_product_metadata(text, text) is
  'Returns only public SEO fields for an active published storefront product.';
