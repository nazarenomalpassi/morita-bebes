import { Ban, Pencil, Plus, Receipt, WalletCards } from "lucide-react";

import { cancelExpenseAction } from "@/app/app/gastos/actions";
import { ExpenseCategoryForm, ExpenseForm } from "@/app/app/gastos/expense-forms";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { isYearMonth } from "@/lib/date";
import { ars, localDate } from "@/lib/format";
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
    supabase.from("payment_methods").select("id, name").eq("organization_id", organization.id).eq("is_active", true).order("sort_order"),
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
  const postedExpenses = expenses.filter((expense) => expense.status === "posted");
  const total = postedExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0);

  return (
    <div className="page-container page-container-wide">
      <header className="page-header"><div><span className="eyebrow">Egresos operativos</span><h1 className="page-title mt-2">Gastos</h1><p className="page-lead">Cada registro conserva autor, fecha real y estado.</p></div><details className="header-details"><summary className="button button-primary"><Plus size={17} /> Nuevo gasto</summary><div className="details-panel"><ExpenseForm canChooseDate={organization.role !== "staff"} categories={categories} closedThrough={latestClosureResult.data?.business_date ?? null} paymentMethods={paymentMethods} /></div></details></header>
      <section className="summary-strip"><span className="summary-strip-icon"><WalletCards size={20} /></span><div><small>Total vigente</small><strong>{ars.format(total)}</strong></div><div><small>Movimientos</small><strong>{expenses.length}</strong></div><form className="month-filter" method="get"><label className="field-label">Mes<input className="field-input" defaultValue={month} name="mes" type="month" /></label>{organization.role !== "staff" ? <label className="field-label">Empleado<select className="field-input" defaultValue={employee} name="empleado"><option value="">Todos</option>{(membersResult.data ?? []).map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email || member.user_id}</option>)}</select></label> : null}<button className="button button-secondary" type="submit">Ver</button></form></section>
      {organization.role !== "staff" ? <details className="maintenance-panel"><summary>Categorías de gasto</summary><ExpenseCategoryForm /></details> : null}
      <div className="data-table-wrap" data-mobile-cards><table className="data-table min-w-[58rem]"><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Pago</th><th>Realizado por</th><th>Importe</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
        {expenses.map((expense) => <tr className={expense.status === "cancelled" ? "opacity-60" : ""} key={expense.id}><td data-label="Fecha">{localDate(expense.expense_date)}</td><td data-label="Descripción"><strong>{expense.description}</strong>{expense.notes ? <small>{expense.notes}</small> : null}{expense.cancellation_reason ? <small>Anulación: {expense.cancellation_reason}</small> : null}</td><td data-label="Categoría">{expense.expense_categories?.name ?? "Sin categoría"}</td><td data-label="Pago">{expense.payment_methods?.name ?? "Sin indicar"}</td><td data-label="Realizado por">{expense.created_by ? people.get(expense.created_by) ?? (organization.role === "staff" ? "Otro usuario" : "Usuario histórico") : "Sistema/importado"}</td><td data-label="Importe"><strong>{ars.format(Number(expense.amount))}</strong></td><td data-label="Estado"><span className={`table-status ${expense.status === "cancelled" ? "table-status-alert" : "table-status-ok"}`}>{expense.status === "cancelled" ? "Anulado" : "Vigente"}</span></td><td className="table-actions" data-label="">{organization.role !== "staff" && expense.status === "posted" ? <><details className="row-editor"><summary className="icon-button" title="Corregir gasto"><Pencil size={16} /></summary><div className="row-editor-panel"><ExpenseForm categories={categories} closedThrough={latestClosureResult.data?.business_date ?? null} paymentMethods={paymentMethods} values={expense} /></div></details><details className="row-menu"><summary className="icon-button icon-button-danger" title="Anular gasto"><Ban size={16} /></summary><form action={cancelExpenseAction} className="row-menu-popover"><input name="id" type="hidden" value={expense.id} /><label className="field-label">Motivo<input className="field-input" minLength={3} name="reason" required /></label><button className="button button-danger" type="submit">Anular gasto</button></form></details></> : null}</td></tr>)}
        {expenses.length === 0 ? <tr><td className="table-empty-cell" colSpan={8}><Receipt size={22} /> No hay gastos en este período.</td></tr> : null}
      </tbody></table></div>
    </div>
  );
}
