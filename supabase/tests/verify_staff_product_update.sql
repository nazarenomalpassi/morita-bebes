begin;

create temporary table staff_product_update_context on commit drop as
select member.user_id, product.id as product_id, product.retail_price as original_price
from public.organization_members as member
join public.products as product
  on product.organization_id = member.organization_id
where member.role = 'staff'
  and member.is_active
order by member.created_at, product.created_at
limit 1;

grant select on staff_product_update_context to authenticated;

do $$
begin
  if not exists (select 1 from staff_product_update_context) then
    raise exception 'No active staff member with a product is available for this test';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from staff_product_update_context),
  true
);

set local role authenticated;

update public.products as product
set retail_price = product.retail_price + 1,
    commercial_description = product.commercial_description,
    hide_when_out_of_stock = product.hide_when_out_of_stock,
    store_slug = product.store_slug,
    seo_title = product.seo_title,
    seo_description = product.seo_description
where product.id = (select product_id from staff_product_update_context);

do $$
begin
  if (
    select product.retail_price
    from public.products as product
    where product.id = (select product_id from staff_product_update_context)
  ) <> (select original_price + 1 from staff_product_update_context) then
    raise exception 'Staff price update was not persisted';
  end if;
end;
$$;

rollback;
