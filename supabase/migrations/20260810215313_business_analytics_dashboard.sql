create table public.monthly_sales_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  goal_month date not null,
  sales_target numeric(14, 2) not null check (sales_target > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_sales_goals_month_start_check
    check (goal_month = date_trunc('month', goal_month)::date),
  constraint monthly_sales_goals_org_month_key unique (organization_id, goal_month)
);

create index monthly_sales_goals_org_month_idx
  on public.monthly_sales_goals (organization_id, goal_month desc);

alter table public.monthly_sales_goals enable row level security;

create policy "administrators read monthly sales goals"
on public.monthly_sales_goals for select to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

create policy "administrators create monthly sales goals"
on public.monthly_sales_goals for insert to authenticated
with check (
  private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])
  and created_by = (select auth.uid())
);

create policy "administrators update monthly sales goals"
on public.monthly_sales_goals for update to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));

grant select, insert, update on public.monthly_sales_goals to authenticated;
revoke delete on public.monthly_sales_goals from anon, authenticated;

create trigger monthly_sales_goals_set_updated_at
before update on public.monthly_sales_goals
for each row execute function private.set_updated_at();

create trigger audit_monthly_sales_goals
after insert or update on public.monthly_sales_goals
for each row execute function private.audit_row_change();

create index sales_org_completed_payment_occurred_idx
  on public.sales (organization_id, payment_method_id, occurred_at desc)
  where status = 'completed';

create index sales_org_completed_actor_occurred_idx
  on public.sales (organization_id, created_by, occurred_at desc)
  where status = 'completed';

create index expenses_org_posted_category_date_idx
  on public.expenses (organization_id, category_id, expense_date desc)
  where status = 'posted';

create index payroll_movements_org_paid_at_idx
  on public.payroll_movements (organization_id, paid_at desc)
  where paid_at is not null;

create or replace function public.get_business_analytics(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_compare_from date,
  p_compare_to date,
  p_goal_month date,
  p_category_id uuid default null,
  p_product_id uuid default null,
  p_created_by uuid default null,
  p_unassigned_only boolean default false,
  p_payment_key text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role;
  report jsonb;
begin
  select member.role
  into actor_role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = actor_id
    and member.is_active;

  if actor_id is null or not found or actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'Administrator access is required';
  end if;

  if p_from is null or p_to is null or p_from > p_to
    or p_compare_from is null or p_compare_to is null or p_compare_from > p_compare_to
    or p_to - p_from > 730 or p_compare_to - p_compare_from > 730 then
    raise exception using errcode = '22023', message = 'Invalid analytics date range';
  end if;

  if p_goal_month is null or p_goal_month <> date_trunc('month', p_goal_month)::date then
    raise exception using errcode = '22023', message = 'Goal month must be the first day of a month';
  end if;

  with
  report_settings as (
    select
      case
        when (p_to - p_from) <= 45 then 'day'
        when (p_to - p_from) <= 180 then 'week'
        else 'month'
      end as bucket,
      case
        when (p_to - p_from) <= 45 then (p_to - p_from) + 1
        when (p_to - p_from) <= 180 then ceil(((p_to - p_from) + 1)::numeric / 7)::integer
        else ((extract(year from age(date_trunc('month', p_to), date_trunc('month', p_from))) * 12)
          + extract(month from age(date_trunc('month', p_to), date_trunc('month', p_from))) + 1)::integer
      end as current_bucket_count,
      case
        when (p_compare_to - p_compare_from) <= 45 then (p_compare_to - p_compare_from) + 1
        when (p_compare_to - p_compare_from) <= 180 then ceil(((p_compare_to - p_compare_from) + 1)::numeric / 7)::integer
        else ((extract(year from age(date_trunc('month', p_compare_to), date_trunc('month', p_compare_from))) * 12)
          + extract(month from age(date_trunc('month', p_compare_to), date_trunc('month', p_compare_from))) + 1)::integer
      end as compare_bucket_count
  ),
  candidate_sales as materialized (
    select
      sale.*,
      case
        when sale.occurred_at >= p_from::timestamp at time zone 'America/Argentina/Buenos_Aires'
         and sale.occurred_at < (p_to + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'
          then 'current'
        else 'previous'
      end as period,
      (sale.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as local_date,
      (sale.occurred_at at time zone 'America/Argentina/Buenos_Aires')::time as local_time,
      coalesce(method.name, nullif(trim(sale.legacy_payment_method), ''), 'Sin registrar') as payment_label,
      coalesce(sale.payment_method_id::text, 'legacy:' || lower(coalesce(nullif(trim(sale.legacy_payment_method), ''), 'sin-registrar'))) as payment_key
    from public.sales as sale
    left join public.payment_methods as method
      on method.id = sale.payment_method_id
     and method.organization_id = sale.organization_id
    where sale.organization_id = p_organization_id
      and sale.status = 'completed'
      and (
        (sale.occurred_at >= p_from::timestamp at time zone 'America/Argentina/Buenos_Aires'
          and sale.occurred_at < (p_to + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
        or
        (sale.occurred_at >= p_compare_from::timestamp at time zone 'America/Argentina/Buenos_Aires'
          and sale.occurred_at < (p_compare_to + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
      )
      and (p_created_by is null or sale.created_by = p_created_by)
      and (not p_unassigned_only or sale.created_by is null)
      and (
        p_payment_key is null
        or coalesce(sale.payment_method_id::text, 'legacy:' || lower(coalesce(nullif(trim(sale.legacy_payment_method), ''), 'sin-registrar'))) = p_payment_key
      )
  ),
  item_rollup as materialized (
    select
      sale.id as sale_id,
      count(item.id) filter (
        where (p_product_id is null or item.product_id = p_product_id)
          and (p_category_id is null or product.category_id = p_category_id)
      ) as matched_item_count,
      coalesce(sum(item.quantity) filter (
        where (p_product_id is null or item.product_id = p_product_id)
          and (p_category_id is null or product.category_id = p_category_id)
      ), 0) as matched_units,
      coalesce(sum(item.line_total) filter (
        where (p_product_id is null or item.product_id = p_product_id)
          and (p_category_id is null or product.category_id = p_category_id)
      ), 0) as matched_line_total,
      coalesce(sum(item.quantity * item.unit_cost) filter (
        where item.unit_cost is not null
          and (p_product_id is null or item.product_id = p_product_id)
          and (p_category_id is null or product.category_id = p_category_id)
      ), 0) as matched_cogs,
      count(item.id) filter (
        where item.unit_cost is null
          and (p_product_id is null or item.product_id = p_product_id)
          and (p_category_id is null or product.category_id = p_category_id)
      ) as matched_unknown_cost_count
    from candidate_sales as sale
    left join public.sale_items as item
      on item.sale_id = sale.id
     and item.organization_id = sale.organization_id
    left join public.products as product
      on product.id = item.product_id
     and product.organization_id = item.organization_id
    group by sale.id
  ),
  metric_sales as materialized (
    select
      sale.id,
      sale.period,
      sale.local_date,
      sale.local_time,
      sale.original_time_known,
      sale.created_by,
      sale.payment_label,
      sale.payment_key,
      case
        when p_product_id is not null or p_category_id is not null
          then round(rollup.matched_line_total * sale.total / nullif(sale.subtotal, 0), 2)
        else sale.total
      end as revenue,
      rollup.matched_units as units,
      rollup.matched_cogs as cogs,
      rollup.matched_item_count > 0 and rollup.matched_unknown_cost_count = 0 as cost_known
    from candidate_sales as sale
    join item_rollup as rollup on rollup.sale_id = sale.id
    where (p_product_id is null and p_category_id is null)
       or rollup.matched_item_count > 0
  ),
  summary_by_period as (
    select
      period,
      count(*) as sale_count,
      coalesce(sum(revenue), 0) as revenue,
      coalesce(sum(units), 0) as units,
      coalesce(sum(revenue) filter (where cost_known), 0) as known_revenue,
      coalesce(sum(revenue) filter (where not cost_known), 0) as unknown_revenue,
      coalesce(sum(cogs) filter (where cost_known), 0) as known_cogs
    from metric_sales
    group by period
  ),
  expense_rows as materialized (
    select
      case when expense.expense_date between p_from and p_to then 'current' else 'previous' end as period,
      expense.expense_date as local_date,
      coalesce(category.name, 'Sin categoría') as category,
      expense.amount
    from public.expenses as expense
    left join public.expense_categories as category
      on category.id = expense.category_id
     and category.organization_id = expense.organization_id
    where expense.organization_id = p_organization_id
      and expense.status = 'posted'
      and (expense.expense_date between p_from and p_to or expense.expense_date between p_compare_from and p_compare_to)
  ),
  payroll_rows as materialized (
    select
      case when payroll.paid_at between p_from and p_to then 'current' else 'previous' end as period,
      payroll.paid_at as local_date,
      case when payroll.kind = 'deduction' then -payroll.amount else payroll.amount end as amount
    from public.payroll_movements as payroll
    where payroll.organization_id = p_organization_id
      and payroll.paid_at is not null
      and (payroll.paid_at between p_from and p_to or payroll.paid_at between p_compare_from and p_compare_to)
  ),
  expenses_by_period as (
    select period, sum(amount) as expenses from expense_rows group by period
  ),
  payroll_by_period as (
    select period, sum(amount) as payroll from payroll_rows group by period
  ),
  period_summary as (
    select
      periods.period,
      coalesce(sale.sale_count, 0) as sale_count,
      coalesce(sale.revenue, 0) as revenue,
      coalesce(sale.units, 0) as units,
      coalesce(sale.known_revenue, 0) as known_revenue,
      coalesce(sale.unknown_revenue, 0) as unknown_revenue,
      coalesce(sale.known_cogs, 0) as known_cogs,
      coalesce(expense.expenses, 0) as expenses,
      coalesce(payroll.payroll, 0) as payroll
    from (values ('current'::text), ('previous'::text)) as periods(period)
    left join summary_by_period as sale on sale.period = periods.period
    left join expenses_by_period as expense on expense.period = periods.period
    left join payroll_by_period as payroll on payroll.period = periods.period
  ),
  bucket_positions as (
    select generate_series(0, greatest(settings.current_bucket_count, settings.compare_bucket_count) - 1) as position
    from report_settings as settings
  ),
  sales_timeline as (
    select
      metric.period,
      case settings.bucket
        when 'day' then (metric.local_date - case when metric.period = 'current' then p_from else p_compare_from end)::integer
        when 'week' then floor((metric.local_date - case when metric.period = 'current' then p_from else p_compare_from end)::numeric / 7)::integer
        else (
          extract(year from age(date_trunc('month', metric.local_date), date_trunc('month', case when metric.period = 'current' then p_from else p_compare_from end))) * 12
          + extract(month from age(date_trunc('month', metric.local_date), date_trunc('month', case when metric.period = 'current' then p_from else p_compare_from end)))
        )::integer
      end as position,
      sum(metric.revenue) as revenue,
      count(*) as sales,
      sum(metric.units) as units
    from metric_sales as metric
    cross join report_settings as settings
    group by metric.period, position
  ),
  expense_timeline as (
    select
      expense.period,
      case settings.bucket
        when 'day' then (expense.local_date - case when expense.period = 'current' then p_from else p_compare_from end)::integer
        when 'week' then floor((expense.local_date - case when expense.period = 'current' then p_from else p_compare_from end)::numeric / 7)::integer
        else (
          extract(year from age(date_trunc('month', expense.local_date), date_trunc('month', case when expense.period = 'current' then p_from else p_compare_from end))) * 12
          + extract(month from age(date_trunc('month', expense.local_date), date_trunc('month', case when expense.period = 'current' then p_from else p_compare_from end)))
        )::integer
      end as position,
      sum(expense.amount) as amount
    from expense_rows as expense
    cross join report_settings as settings
    group by expense.period, position
  ),
  payroll_timeline as (
    select
      payroll.period,
      case settings.bucket
        when 'day' then (payroll.local_date - case when payroll.period = 'current' then p_from else p_compare_from end)::integer
        when 'week' then floor((payroll.local_date - case when payroll.period = 'current' then p_from else p_compare_from end)::numeric / 7)::integer
        else (
          extract(year from age(date_trunc('month', payroll.local_date), date_trunc('month', case when payroll.period = 'current' then p_from else p_compare_from end))) * 12
          + extract(month from age(date_trunc('month', payroll.local_date), date_trunc('month', case when payroll.period = 'current' then p_from else p_compare_from end)))
        )::integer
      end as position,
      sum(payroll.amount) as amount
    from payroll_rows as payroll
    cross join report_settings as settings
    group by payroll.period, position
  ),
  current_product_sales as materialized (
    select
      item.product_id,
      product.name,
      product.sku,
      category.name as category,
      sum(item.quantity) as units,
      sum(case when sale.subtotal > 0 then item.line_total * sale.total / sale.subtotal else 0 end) as revenue
    from candidate_sales as sale
    join public.sale_items as item
      on item.sale_id = sale.id
     and item.organization_id = sale.organization_id
    join public.products as product
      on product.id = item.product_id
     and product.organization_id = item.organization_id
    left join public.categories as category
      on category.id = product.category_id
     and category.organization_id = product.organization_id
    where sale.period = 'current'
      and (p_product_id is null or item.product_id = p_product_id)
      and (p_category_id is null or product.category_id = p_category_id)
    group by item.product_id, product.name, product.sku, category.name
  ),
  current_category_sales as (
    select
      coalesce(category, 'Sin categoría') as category,
      sum(units) as units,
      sum(revenue) as revenue
    from current_product_sales
    group by coalesce(category, 'Sin categoría')
  ),
  payment_sales as (
    select payment_key, payment_label, count(*) as operations, sum(revenue) as amount
    from metric_sales
    where period = 'current'
    group by payment_key, payment_label
  ),
  weekday_calendar as (
    select extract(isodow from day)::integer as weekday, count(*) as occurrences
    from generate_series(p_from, p_to, interval '1 day') as calendar(day)
    group by weekday
  ),
  weekday_sales as (
    select extract(isodow from local_date)::integer as weekday, count(*) as operations, sum(revenue) as revenue
    from metric_sales
    where period = 'current'
    group by weekday
  ),
  hour_sales as (
    select
      case
        when extract(hour from local_time) < 8 then 'Antes de 08'
        when extract(hour from local_time) >= 22 then 'Desde 22'
        else lpad((floor(extract(hour from local_time) / 2) * 2)::integer::text, 2, '0') || '-' ||
          lpad(((floor(extract(hour from local_time) / 2) * 2) + 2)::integer::text, 2, '0')
      end as band,
      case
        when extract(hour from local_time) < 8 then 0
        when extract(hour from local_time) >= 22 then 99
        else (floor(extract(hour from local_time) / 2) * 2)::integer
      end as sort_order,
      count(*) as operations,
      sum(revenue) as revenue
    from metric_sales
    where period = 'current' and original_time_known
    group by band, sort_order
  ),
  employee_sales as (
    select
      metric.created_by,
      coalesce(profile.display_name, profile.email, case when metric.created_by is null then 'Histórico / sin identificar' else 'Usuario sin nombre' end) as name,
      count(*) as operations,
      sum(metric.revenue) as revenue,
      sum(metric.units) as units
    from metric_sales as metric
    left join public.user_profiles as profile on profile.user_id = metric.created_by
    where metric.period = 'current'
    group by metric.created_by, profile.display_name, profile.email
  ),
  expense_categories as (
    select category, sum(amount) as amount
    from expense_rows
    where period = 'current'
    group by category
    union all
    select 'Personal', coalesce(sum(amount), 0)
    from payroll_rows
    where period = 'current'
  ),
  filtered_products as materialized (
    select product.*
    from public.products as product
    where product.organization_id = p_organization_id
      and product.is_active
      and (p_product_id is null or product.id = p_product_id)
      and (p_category_id is null or product.category_id = p_category_id)
  ),
  product_last_sale as (
    select item.product_id, max((sale.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date) as last_sale
    from public.sale_items as item
    join public.sales as sale
      on sale.id = item.sale_id
     and sale.organization_id = item.organization_id
    where item.organization_id = p_organization_id
      and sale.status = 'completed'
      and item.product_id is not null
    group by item.product_id
  ),
  selected_goal as (
    select goal.id, goal.goal_month, goal.sales_target, goal.updated_at
    from public.monthly_sales_goals as goal
    where goal.organization_id = p_organization_id and goal.goal_month = p_goal_month
  ),
  goal_sales as (
    select coalesce(sum(sale.total), 0) as revenue
    from public.sales as sale
    where sale.organization_id = p_organization_id
      and sale.status = 'completed'
      and sale.occurred_at >= p_goal_month::timestamp at time zone 'America/Argentina/Buenos_Aires'
      and sale.occurred_at < (p_goal_month + interval '1 month')::timestamp at time zone 'America/Argentina/Buenos_Aires'
  ),
  filter_options as (
    select jsonb_build_object(
      'categories', coalesce((select jsonb_agg(jsonb_build_object('id', category.id, 'name', category.name) order by category.name) from public.categories as category where category.organization_id = p_organization_id and category.is_active), '[]'::jsonb),
      'products', coalesce((select jsonb_agg(jsonb_build_object('id', product.id, 'name', product.name, 'sku', product.sku) order by product.name) from public.products as product where product.organization_id = p_organization_id and product.is_active), '[]'::jsonb),
      'employees', coalesce((select jsonb_agg(jsonb_build_object('id', member.user_id, 'name', coalesce(profile.display_name, profile.email, member.user_id::text)) order by coalesce(profile.display_name, profile.email, member.user_id::text)) from public.organization_members as member left join public.user_profiles as profile on profile.user_id = member.user_id where member.organization_id = p_organization_id and member.is_active), '[]'::jsonb),
      'paymentMethods', coalesce((
        select jsonb_agg(jsonb_build_object('key', option_key, 'name', option_name) order by option_name)
        from (
          select method.id::text as option_key, method.name as option_name
          from public.payment_methods as method
          where method.organization_id = p_organization_id and method.is_active
          union
          select 'legacy:' || lower(coalesce(nullif(trim(sale.legacy_payment_method), ''), 'sin-registrar')), coalesce(nullif(trim(sale.legacy_payment_method), ''), 'Sin registrar')
          from public.sales as sale
          where sale.organization_id = p_organization_id and sale.source = 'legacy_import'
        ) as payment_options
      ), '[]'::jsonb)
    ) as value
  )
  select jsonb_build_object(
    'meta', jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'compareFrom', p_compare_from,
      'compareTo', p_compare_to,
      'bucket', settings.bucket,
      'generatedAt', now(),
      'costPolicy', 'historical_only',
      'timeZone', 'America/Argentina/Buenos_Aires'
    ),
    'summary', jsonb_build_object(
      'current', (
        select jsonb_build_object(
          'revenue', revenue,
          'saleCount', sale_count,
          'averageTicket', case when sale_count > 0 then round(revenue / sale_count, 2) else 0 end,
          'unitsSold', units,
          'knownRevenue', known_revenue,
          'unknownRevenue', unknown_revenue,
          'knownCogs', known_cogs,
          'grossProfitKnown', known_revenue - known_cogs,
          'grossMarginKnownPct', case when known_revenue > 0 then round((known_revenue - known_cogs) * 100 / known_revenue, 2) else null end,
          'expenses', expenses,
          'payroll', payroll,
          'operatingExpenses', expenses + payroll,
          'expenseToRevenuePct', case when revenue > 0 then round((expenses + payroll) * 100 / revenue, 2) else null end,
          'estimatedResult', case when unknown_revenue = 0 then known_revenue - known_cogs - expenses - payroll else null end
        ) from period_summary where period = 'current'
      ),
      'previous', (
        select jsonb_build_object(
          'revenue', revenue,
          'saleCount', sale_count,
          'averageTicket', case when sale_count > 0 then round(revenue / sale_count, 2) else 0 end,
          'unitsSold', units,
          'knownRevenue', known_revenue,
          'unknownRevenue', unknown_revenue,
          'knownCogs', known_cogs,
          'grossProfitKnown', known_revenue - known_cogs,
          'grossMarginKnownPct', case when known_revenue > 0 then round((known_revenue - known_cogs) * 100 / known_revenue, 2) else null end,
          'expenses', expenses,
          'payroll', payroll,
          'operatingExpenses', expenses + payroll,
          'expenseToRevenuePct', case when revenue > 0 then round((expenses + payroll) * 100 / revenue, 2) else null end,
          'estimatedResult', case when unknown_revenue = 0 then known_revenue - known_cogs - expenses - payroll else null end
        ) from period_summary where period = 'previous'
      )
    ),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', position.position,
        'currentLabel', case settings.bucket
          when 'day' then (p_from + position.position)::text
          when 'week' then ((p_from + (position.position * 7))::date)::text
          else (date_trunc('month', p_from) + (position.position || ' months')::interval)::date::text
        end,
        'previousLabel', case settings.bucket
          when 'day' then (p_compare_from + position.position)::text
          when 'week' then ((p_compare_from + (position.position * 7))::date)::text
          else (date_trunc('month', p_compare_from) + (position.position || ' months')::interval)::date::text
        end,
        'currentRevenue', coalesce(current_sales.revenue, 0),
        'previousRevenue', coalesce(previous_sales.revenue, 0),
        'currentSales', coalesce(current_sales.sales, 0),
        'previousSales', coalesce(previous_sales.sales, 0),
        'currentExpenses', coalesce(current_expense.amount, 0) + coalesce(current_payroll.amount, 0),
        'previousExpenses', coalesce(previous_expense.amount, 0) + coalesce(previous_payroll.amount, 0)
      ) order by position.position)
      from bucket_positions as position
      left join sales_timeline as current_sales on current_sales.period = 'current' and current_sales.position = position.position
      left join sales_timeline as previous_sales on previous_sales.period = 'previous' and previous_sales.position = position.position
      left join expense_timeline as current_expense on current_expense.period = 'current' and current_expense.position = position.position
      left join expense_timeline as previous_expense on previous_expense.period = 'previous' and previous_expense.position = position.position
      left join payroll_timeline as current_payroll on current_payroll.period = 'current' and current_payroll.position = position.position
      left join payroll_timeline as previous_payroll on previous_payroll.period = 'previous' and previous_payroll.position = position.position
    ), '[]'::jsonb),
    'topProducts', coalesce((select jsonb_agg(row_data order by ranking) from (select row_number() over (order by revenue desc, name) as ranking, jsonb_build_object('id', product_id, 'name', name, 'sku', sku, 'units', units, 'revenue', round(revenue, 2)) as row_data from current_product_sales order by revenue desc, name limit 10) ranked), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', category, 'units', units, 'revenue', round(revenue, 2)) order by revenue desc, category) from current_category_sales), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('key', payment_key, 'name', payment_label, 'operations', operations, 'amount', round(amount, 2)) order by amount desc, payment_label) from payment_sales), '[]'::jsonb),
    'weekdays', coalesce((select jsonb_agg(jsonb_build_object(
      'weekday', calendar.weekday,
      'name', (array['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'])[calendar.weekday],
      'occurrences', calendar.occurrences,
      'operations', coalesce(sales.operations, 0),
      'revenue', coalesce(sales.revenue, 0),
      'averageRevenue', round(coalesce(sales.revenue, 0) / calendar.occurrences, 2)
    ) order by calendar.weekday) from weekday_calendar as calendar left join weekday_sales as sales using (weekday)), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('band', band, 'operations', operations, 'revenue', round(revenue, 2)) order by sort_order) from hour_sales), '[]'::jsonb),
    'timeCoverage', jsonb_build_object(
      'operationsWithKnownTime', (select count(*) from metric_sales where period = 'current' and original_time_known),
      'totalOperations', (select count(*) from metric_sales where period = 'current')
    ),
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', created_by, 'name', name, 'operations', operations, 'revenue', round(revenue, 2), 'averageTicket', round(revenue / nullif(operations, 0), 2), 'units', units) order by revenue desc, name) from employee_sales), '[]'::jsonb),
    'expenseCategories', coalesce((select jsonb_agg(jsonb_build_object('name', category, 'amount', round(amount, 2)) order by amount desc, category) from expense_categories where amount <> 0), '[]'::jsonb),
    'inventory', (
      select jsonb_build_object(
        'productCount', count(*),
        'stockUnits', coalesce(sum(current_stock), 0),
        'outOfStock', count(*) filter (where current_stock <= 0),
        'lowStock', count(*) filter (where needs_restock),
        'excessStock', count(*) filter (where target_stock is not null and current_stock > target_stock),
        'costValue', coalesce(sum(greatest(current_stock, 0) * cost_price), 0),
        'retailValue', coalesce(sum(greatest(current_stock, 0) * retail_price), 0)
      ) from filtered_products
    ),
    'slowProducts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', product.id,
        'name', product.name,
        'sku', product.sku,
        'stock', product.current_stock,
        'lastSale', last_sale.last_sale,
        'daysWithoutSale', case when last_sale.last_sale is null then null else current_date - last_sale.last_sale end,
        'immobilizedCost', round(greatest(product.current_stock, 0) * product.cost_price, 2)
      ) order by last_sale.last_sale nulls first, product.name)
      from filtered_products as product
      left join product_last_sale as last_sale on last_sale.product_id = product.id
      where product.current_stock > 0
        and (last_sale.last_sale is null or last_sale.last_sale <= current_date - 30)
      limit 20
    ), '[]'::jsonb),
    'goal', (
      select jsonb_build_object(
        'id', goal.id,
        'month', p_goal_month,
        'target', goal.sales_target,
        'revenue', sales.revenue,
        'progressPct', case when goal.sales_target > 0 then round(sales.revenue * 100 / goal.sales_target, 2) else null end,
        'remaining', greatest(goal.sales_target - sales.revenue, 0),
        'daysRemaining', case
          when p_goal_month = date_trunc('month', current_date)::date then greatest((p_goal_month + interval '1 month - 1 day')::date - current_date, 0)
          when p_goal_month > date_trunc('month', current_date)::date then (p_goal_month + interval '1 month - 1 day')::date - p_goal_month + 1
          else 0
        end,
        'requiredDaily', case
          when goal.sales_target <= sales.revenue then 0
          when p_goal_month = date_trunc('month', current_date)::date then round((goal.sales_target - sales.revenue) / greatest((p_goal_month + interval '1 month - 1 day')::date - current_date, 1), 2)
          else null
        end,
        'projectedRevenue', case
          when p_goal_month = date_trunc('month', current_date)::date then round(sales.revenue / greatest(current_date - p_goal_month + 1, 1) * ((p_goal_month + interval '1 month')::date - p_goal_month), 2)
          when p_goal_month < date_trunc('month', current_date)::date then sales.revenue
          else 0
        end,
        'updatedAt', goal.updated_at
      )
      from selected_goal as goal cross join goal_sales as sales
    ),
    'goalMonthRevenue', (select revenue from goal_sales),
    'filters', (select value from filter_options)
  )
  into report
  from report_settings as settings;

  return report;
end;
$$;

revoke all on function public.get_business_analytics(
  uuid, date, date, date, date, date, uuid, uuid, uuid, boolean, text
) from public, anon;
grant execute on function public.get_business_analytics(
  uuid, date, date, date, date, date, uuid, uuid, uuid, boolean, text
) to authenticated, service_role;
