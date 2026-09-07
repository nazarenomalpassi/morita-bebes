with category_images(name, image_path) as (
  values
    ('Pañales', '/store/categories/panales.webp'),
    ('Accesorios', '/store/categories/accesorios.webp'),
    ('Alimentación', '/store/categories/alimentacion.webp'),
    ('Chupetes', '/store/categories/chupetes.webp'),
    ('Cuidado personal', '/store/categories/cuidado-personal.webp'),
    ('Higiene', '/store/categories/higiene.webp'),
    ('Juguetes', '/store/categories/juguetes.webp'),
    ('Mamaderas', '/store/categories/mamaderas.webp'),
    ('Ropa para bebé', '/store/categories/ropa-para-bebe.webp'),
    ('Artículos', '/store/categories/articulos.webp'),
    ('Otros', '/store/categories/otros.webp'),
    ('Ropa y accesorios', '/store/categories/ropa-y-accesorios.webp'),
    ('Tela', '/store/categories/tela.webp')
)
update public.categories as category
set image_path = category_images.image_path
from category_images
where category.organization_id = (
    select id from public.organizations where slug = 'morita-bebes'
  )
  and category.name = category_images.name
  and coalesce(btrim(category.image_path), '') = '';
