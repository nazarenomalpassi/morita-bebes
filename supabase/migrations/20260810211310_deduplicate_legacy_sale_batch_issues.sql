delete from public.legacy_sale_import_issues as duplicate
using public.legacy_sale_import_issues as retained
where duplicate.batch_id = retained.batch_id
  and duplicate.source_row is not distinct from retained.source_row
  and duplicate.code = retained.code
  and duplicate.id > retained.id;

alter table public.legacy_sale_import_issues
  drop constraint legacy_sale_import_issues_dedup_key,
  add constraint legacy_sale_import_issues_dedup_key
    unique nulls not distinct (batch_id, source_row, code);

update public.legacy_sale_import_batches as batch
set warning_count = issue_counts.warning_count,
    error_sales = issue_counts.error_count
from (
  select
    issue.batch_id,
    count(*) filter (where issue.severity = 'warning') as warning_count,
    count(*) filter (where issue.severity = 'error') as error_count
  from public.legacy_sale_import_issues as issue
  group by issue.batch_id
) as issue_counts
where batch.id = issue_counts.batch_id;
