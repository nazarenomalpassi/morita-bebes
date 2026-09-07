create function public.set_primary_product_image(p_product_id uuid, p_image_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  image_row public.product_images%rowtype;
begin
  select * into image_row
  from public.product_images
  where id = p_image_id and product_id = p_product_id
  for update;

  if not found or not private.has_org_role(image_row.organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'No tenés permiso para administrar esta galería';
  end if;

  update public.product_images set is_primary = false
  where product_id = p_product_id and organization_id = image_row.organization_id;
  update public.product_images set is_primary = true where id = p_image_id;
end;
$$;

create function public.reorder_product_image(p_image_id uuid, p_direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_image public.product_images%rowtype;
  neighbor public.product_images%rowtype;
begin
  if p_direction not in (-1, 1) then
    raise exception using errcode = '22023', message = 'Invalid image direction';
  end if;
  select * into current_image from public.product_images where id = p_image_id for update;
  if not found or not private.has_org_role(current_image.organization_id, array['owner', 'admin']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'No tenés permiso para administrar esta galería';
  end if;

  if p_direction < 0 then
    select * into neighbor from public.product_images
    where product_id = current_image.product_id and organization_id = current_image.organization_id
      and (sort_order, created_at, id) < (current_image.sort_order, current_image.created_at, current_image.id)
    order by sort_order desc, created_at desc, id desc limit 1 for update;
  else
    select * into neighbor from public.product_images
    where product_id = current_image.product_id and organization_id = current_image.organization_id
      and (sort_order, created_at, id) > (current_image.sort_order, current_image.created_at, current_image.id)
    order by sort_order, created_at, id limit 1 for update;
  end if;

  if found then
    update public.product_images set sort_order = neighbor.sort_order where id = current_image.id;
    update public.product_images set sort_order = current_image.sort_order where id = neighbor.id;
  end if;
end;
$$;

revoke all on function public.set_primary_product_image(uuid, uuid) from public, anon;
revoke all on function public.reorder_product_image(uuid, integer) from public, anon;
grant execute on function public.set_primary_product_image(uuid, uuid) to authenticated, service_role;
grant execute on function public.reorder_product_image(uuid, integer) to authenticated, service_role;
