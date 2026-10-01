import { ExpenseWorkspace } from "@/app/app/gastos/expense-workspace";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { isYearMonth } from "@/lib/date";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ mes?: string; empleado?: string }> }) {
  const params = await searchParams;
  const month = isYearMonth(params.mes) ? params.mes : currentMonth();
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const employee = params.empleado && /^[0-9a-f-]{36}$/i.test(params.empleado) ? params.empleado : "";

  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;

  let expensesQuery = supabase.from("expenses").select("*, expense_categories(name, is_payroll_advance), payment_methods(name)").eq("organization_id", organization.id).gte("expense_date", `${month}-01`).lt("expense_date", nextMonth).order("expense_date", { ascending: false }).order("created_at", { ascending: false });
  if (employee && organization.role !== "staff") expensesQuery = expensesQuery.eq("created_by", employee);

  const [expensesResult, categoriesResult, methodsResult, membersResult, ownProfileResult, latestClosureResult] = await Promise.all([
    expensesQuery,
    supabase.from("expense_categories").select("id, name, is_payroll_advance").eq("organization_id", organization.id).eq("is_active", true).order("name"),
    supabase.from("payment_methods").select("id, name, is_active").eq("organization_id", organization.id).order("sort_order"),
    organization.role === "staff" ? Promise.resolve({ data: [], error: null }) : supabase.rpc("list_organization_members", { p_organization_id: organization.id }),
    organization.role === "staff" ? supabase.from("user_profiles").select("user_id, display_name, email").maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("daily_cash_closures").select("business_date").eq("organization_id", organization.id).order("business_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (expensesResult.error || categoriesResult.error || methodsResult.error || membersResult.error || ownProfileResult.error || latestClosureResult.error) throw new Error("No se pudo cargar la información de gastos.");

  const expenses = (expensesResult.data ?? []).filter((expense) => !expense.expense_categories?.is_payroll_advance);
  const categories = (categoriesResult.data ?? []).filter((category) => !category.is_payroll_advance);
  const paymentMethods = methodsResult.data ?? [];
  const people = new Map<string, string>();
  for (const member of membersResult.data ?? []) people.set(member.user_id, member.display_name || member.email || "Usuario");
  if (ownProfileResult.data) people.set(ownProfileResult.data.user_id, ownProfileResult.data.display_name || ownProfileResult.data.email || "Usuario");
  return (
    <ExpenseWorkspace initialExpenses={expenses} categories={categories} paymentMethods={paymentMethods}
      people={[...people.entries()]} month={month} employee={employee} role={organization.role}
      closedThrough={latestClosureResult.data?.business_date ?? null} />
  );
}
