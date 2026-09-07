alter table public.sales
  drop constraint sales_total_matches_components_check,
  add constraint sales_total_matches_components_check check (
    (
      status = 'draft'
      and subtotal = 0
      and discount = 0
      and vat_10_5 = 0
      and vat_21 = 0
      and rounding_adjustment = 0
      and surcharge = 0
      and total = 0
    )
    or total = subtotal + vat_10_5 + vat_21 + rounding_adjustment
      + manual_surcharge + surcharge - discount
  );

comment on constraint sales_total_matches_components_check on public.sales is
  'Completed and cancelled totals must match every historical component. Drafts may stage a fixed surcharge before their workflow-managed totals are finalized.';
