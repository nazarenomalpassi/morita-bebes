-- Checkout público utiliza exclusivamente el wrapper idempotente. La función
-- original queda como implementación interna para el propietario y service role.
revoke execute on function public.create_web_order(text, jsonb, text) from authenticated;
grant execute on function public.create_web_order(text, jsonb, text) to service_role;
