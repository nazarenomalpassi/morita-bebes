-- Disambiguate the local variable from the snapshot table's settlement_id column.
do $migration$
declare
  definition text := pg_get_functiondef(
    'public.settle_employee_payroll(uuid,uuid,date,text)'::regprocedure
  );
begin
  if position('settlement_id uuid;' in definition) = 0
    or position('returning id into settlement_id;' in definition) = 0
    or position('select movement.organization_id, settlement_id, movement.id,' in definition) = 0
    or position('return settlement_id;' in definition) = 0 then
    raise exception 'Payroll settlement function structure changed; review required';
  end if;
  definition := replace(definition, 'settlement_id uuid;', 'created_settlement_id uuid;');
  definition := replace(definition, 'returning id into settlement_id;', 'returning id into created_settlement_id;');
  definition := replace(definition,
    'select movement.organization_id, settlement_id, movement.id,',
    'select movement.organization_id, created_settlement_id, movement.id,');
  definition := replace(definition, 'return settlement_id;', 'return created_settlement_id;');
  execute definition;
end;
$migration$;
