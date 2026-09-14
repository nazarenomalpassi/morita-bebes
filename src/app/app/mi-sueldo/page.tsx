import { BadgeDollarSign, CircleUserRound } from "lucide-react";
import { redirect } from "next/navigation";

import { CompensationSummary } from "@/components/payroll/compensation-summary";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { isYearMonth } from "@/lib/date";
import { ars, dateTime } from "@/lib/format";
import {
  currentYearMonth,
  payrollMonthLabel,
  type PayrollDashboard,
} from "@/lib/payroll/dashboard";
import { enrichPayrollDashboard } from "@/lib/payroll/adjustments";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MyPayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const params = await searchParams;
  const month = isYearMonth(params.mes) ? params.mes : currentYearMonth();
  const periodStart = `${month}-01`;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  if (organization.role !== "staff") redirect("/app/personal");

  const [dashboardResult, settlementsResult, movementsResult] = await Promise.all([
    supabase.rpc("get_payroll_dashboard", {
      p_organization_id: organization.id,
      p_period_month: periodStart,
      p_employee_id: undefined,
    }),
    supabase
      .from("payroll_settlements")
      .select("id, employee_id, period_month, base_salary, commission_base, commission_percentage, commission_amount, gross_salary, bonus_amount, advance_amount, deduction_amount, net_salary, status, settled_at, paid_at, payment_method, payroll_settlement_adjustments(id, kind, amount, occurred_on, description, source_type)")
      .eq("organization_id", organization.id)
      .order("period_month", { ascending: false })
      .limit(24),
    supabase
      .from("payroll_movements")
      .select("id, employee_id, kind, amount, paid_at, period_month, notes, expense_id, voided_at, expenses(expense_date, description)")
      .eq("organization_id", organization.id)
      .eq("period_month", periodStart)
      .neq("kind", "salary")
      .order("created_at", { ascending: false }),
  ]);

  if (dashboardResult.error || settlementsResult.error || movementsResult.error) {
    throw new Error("No se pudo cargar tu información salarial.");
  }

  const dashboard = enrichPayrollDashboard(
    dashboardResult.data as unknown as PayrollDashboard,
    movementsResult.data ?? [],
    settlementsResult.data ?? [],
  );
  const employee = dashboard.employees[0];
  const settlements = settlementsResult.data ?? [];

  if (!dashboard.meta.employeeLinked || !employee) {
    return (
      <div className="page-container permission-state payroll-link-state">
        <CircleUserRound size={34} />
        <h1>Tu legajo todavía no está vinculado</h1>
        <p>Pedile al administrador que vincule tu cuenta de acceso con tu ficha de empleado. Tus condiciones salariales permanecen protegidas mientras tanto.</p>
      </div>
    );
  }

  return (
    <div className="page-container payroll-self-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Información personal</span>
          <h1 className="page-title mt-2">Mi sueldo</h1>
          <p className="page-lead">Acumulado real del mes y liquidaciones anteriores. Esta información es de solo lectura.</p>
        </div>
        <span className="role-badge"><BadgeDollarSign size={16} /> Solo vos</span>
      </header>

      <section className="summary-strip payroll-self-filter">
        <span className="summary-strip-icon"><BadgeDollarSign size={20} /></span>
        <div><small>Período consultado</small><strong>{payrollMonthLabel(month)}</strong></div>
        <form className="month-filter" method="get"><label className="field-label">Mes<input className="field-input" defaultValue={month} name="mes" type="month" /></label><button className="button button-secondary" type="submit">Ver</button></form>
      </section>

      <section className="records-section">
        <CompensationSummary compact employee={employee} meta={dashboard.meta} />
      </section>

      <section className="records-section">
        <div className="section-heading-row"><div><span className="eyebrow">Solo lectura</span><h2>Mis liquidaciones anteriores</h2></div></div>
        <div className="payroll-settlement-list">
          {settlements.map((settlement) => (
            <article className="payroll-settlement-row" key={settlement.id}>
              <div><strong>{payrollMonthLabel(settlement.period_month)}</strong><small>Liquidado {dateTime.format(new Date(settlement.settled_at))}</small></div>
              <div><span>Ventas del local</span><strong>{ars.format(Number(settlement.commission_base))}</strong></div>
              <div><span>Comisión {Number(settlement.commission_percentage)}%</span><strong>{ars.format(Number(settlement.commission_amount))}</strong></div>
              <div><span>Bruto</span><strong>{ars.format(Number(settlement.gross_salary))}</strong></div>
              <div><span>Adelantos</span><strong className={Number(settlement.advance_amount) > 0 ? "negative-value" : ""}>{Number(settlement.advance_amount) > 0 ? "- " : ""}{ars.format(Number(settlement.advance_amount))}</strong></div>
              <div><span>A pagar</span><strong>{ars.format(Number(settlement.net_salary))}</strong></div>
              <span className={`table-status ${settlement.status === "paid" ? "table-status-ok" : ""}`}>{settlement.status === "paid" ? "Pagado" : "Liquidado"}</span>
            </article>
          ))}
          {settlements.length === 0 ? <p className="inline-empty">Todavía no tenés liquidaciones mensuales cerradas.</p> : null}
        </div>
      </section>
    </div>
  );
}
