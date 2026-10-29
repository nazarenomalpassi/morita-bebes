-- Expand both rankings without changing sales, costs, payroll or historical data.
-- Returning the union avoids losing low-priced best sellers when ranking by units.
do $migration$
declare
  definition text;
  old_segment text := $old$from current_product_sales order by revenue desc, name limit 10) ranked$old$;
  new_segment text := $new$from current_product_sales
    where product_id in (
      (select product_id from current_product_sales order by revenue desc, name, product_id limit 50)
      union
      (select product_id from current_product_sales order by units desc, name, product_id limit 50)
    ) order by revenue desc, name, product_id) ranked$new$;
begin
  definition := pg_get_functiondef('public.get_business_analytics(uuid,date,date,date,date,date,uuid,uuid,uuid,boolean,text)'::regprocedure);
  if position(old_segment in definition) = 0
    or length(definition) - length(replace(definition, old_segment, '')) <> length(old_segment) then
    raise exception 'Analytics product ranking structure changed; review required';
  end if;
  execute replace(definition, old_segment, new_segment);
end;
$migration$;

notify pgrst, 'reload schema';
