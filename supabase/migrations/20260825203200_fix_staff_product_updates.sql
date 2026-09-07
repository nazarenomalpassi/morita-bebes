-- El trigger se ejecuta para cualquier cambio del producto y necesita acceder
-- a la función privada que normaliza la URL de la tienda.
alter function private.prepare_product_storefront_fields() security definer;

revoke all on function private.prepare_product_storefront_fields() from public;

