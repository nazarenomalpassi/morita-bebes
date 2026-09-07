-- These are the two pre-existing Morita salary expenses. The September period
-- is explicit in its description; the other follows its August expense date.
update public.expenses as expense
set payroll_employee_id = employee.id,
    payroll_period_month = case expense.id
      when '0217bbb0-90f7-4f2a-b07d-8d6443cb042f'::uuid then date '2026-09-01'
      when '740af0cd-7b67-47b5-9eca-14398de95bff'::uuid then date '2026-08-01'
    end
from public.employees as employee
where expense.id in (
    '0217bbb0-90f7-4f2a-b07d-8d6443cb042f'::uuid,
    '740af0cd-7b67-47b5-9eca-14398de95bff'::uuid
  )
  and expense.payroll_employee_id is null
  and expense.payroll_period_month is null
  and expense.status = 'posted'
  and employee.organization_id = expense.organization_id
  and employee.first_name = 'Nahir'
  and employee.last_name = 'Asieri'
  and exists (
    select 1
    from public.expense_categories as category
    where category.id = expense.category_id
      and category.organization_id = expense.organization_id
      and category.is_payroll_advance
  );
