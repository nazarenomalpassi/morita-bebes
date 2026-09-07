alter table public.products
  add constraint products_sku_clean_identifier_check
  check (
    sku = btrim(sku)
    and sku !~ '[[:cntrl:]]'
    and position(U&'\200B' in sku) = 0
    and position(U&'\200C' in sku) = 0
    and position(U&'\200D' in sku) = 0
    and position(U&'\2060' in sku) = 0
    and position(U&'\FEFF' in sku) = 0
    and sku !~* '^[+-]?([0-9]+([.,][0-9]*)?|[.,][0-9]+)e[+-]?[0-9]+$'
  ),
  add constraint products_barcode_clean_identifier_check
  check (
    barcode is null
    or (
      barcode <> ''
      and barcode = btrim(barcode)
      and barcode !~ '[[:cntrl:]]'
      and position(U&'\200B' in barcode) = 0
      and position(U&'\200C' in barcode) = 0
      and position(U&'\200D' in barcode) = 0
      and position(U&'\2060' in barcode) = 0
      and position(U&'\FEFF' in barcode) = 0
      and barcode !~* '^[+-]?([0-9]+([.,][0-9]*)?|[.,][0-9]+)e[+-]?[0-9]+$'
    )
  );

comment on constraint products_sku_clean_identifier_check on public.products is
  'SKU must be normalized text without control, zero-width or scientific notation characters.';

comment on constraint products_barcode_clean_identifier_check on public.products is
  'Barcode must be null or normalized text without control, zero-width or scientific notation characters.';
