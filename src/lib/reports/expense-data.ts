import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchAllRows } from "@/lib/data/fetch-all-rows";
import type { ReportSearchParams, ResolvedReportPeriod } from "./analytics";
import { buildExpenseAnalytics } from "./expenses";

export async function loadExpenseAnalytics(supabase: SupabaseClient<Database>, organizationId: string, period: ResolvedReportPeriod, search: ReportSearchParams, employees: { id: string; name: string }[]) {
  const [expenses, methods] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("expenses")
      .select("id, description, expense_date, amount, status, category_id, created_by, payment_method_id, payment_allocations, expense_categories(name, is_payroll_advance)")
      .eq("organization_id", organizationId).eq("status", "posted")
      .or(`and(expense_date.gte.${period.from},expense_date.lte.${period.to}),and(expense_date.gte.${period.compareFrom},expense_date.lte.${period.compareTo})`)
      .order("expense_date").order("id").range(from, to)),
    supabase.from("payment_methods").select("id, name").eq("organization_id", organizationId).order("sort_order"),
  ]);
  if (methods.error) throw new Error("No se pudieron cargar los medios de egreso.");
  return buildExpenseAnalytics(expenses, methods.data ?? [], employees, period, search);
}
