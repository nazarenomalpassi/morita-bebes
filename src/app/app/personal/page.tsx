import {
  BadgeDollarSign,
  CircleDollarSign,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import { redirect } from "next/navigation";

import {
  deletePayrollMovementAction,
  toggleEmployeeAction,
} from "@/app/app/personal/actions";
import {
  CompensationForm,
  PaymentForm,
  SettlementForm,
} from "@/app/app/personal/payroll-forms";
import {
  EmployeeForm,
  PayrollMovementForm,
  type StaffAccountOption,
} from "@/app/app/personal/personnel-forms";
import { CompensationSummary } from "@/components/payroll/compensation-summary";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { isYearMonth } from "@/lib/date";
import { ars, localDate } from "@/lib/format";
import {
  currentYearMonth,
  payrollMonthLabel,
  type PayrollDashboard,
} from "@/lib/payroll/dashboard";
import { enrichPayrollDashboard } from "@/lib/payroll/adjustments";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const kindLabels = {
  salary: "Sueldo liquidado",
  advance: "Adelanto",
  bonus: "Bono",
  deduction: "Descuento",
} as const;

export default async function PersonnelPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const params = await searchParams;
  const currentMonth = currentYearMonth();
  const month = isYearMonth(params.mes) ? params.mes : currentMonth;
  const periodStart = `${month}-01`;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  if (organization.role === "staff") redirect("/app/mi-sueldo");

  const [employeesResult, movementsResult, dashboardResult, settlementsResult, membersResult, paymentMethodsResult] = await Promise.all([
    supabase.from("employees").select("*").eq("organization_id", organization.id).order("status").order("last_name"),
    supabase
      .from("payroll_movements")
      .select("*, employees(first_name, last_name), expenses(expense_date, description)")
      .eq("organization_id", organization.id)
      .eq("period_month", periodStart)
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase.rpc("get_payroll_dashboard", {
      p_organization_id: organization.id,
      p_period_month: periodStart,
      p_employee_id: undefined,
    }),
    supabase
      .from("payroll_settlements")
      .select("*, employees(first_name, last_name), payroll_settlement_payments(amount, payment_methods(name)), payroll_settlement_adjustments(id, kind, amount, occurred_on, description, source_type)")
      .eq("organization_id", organization.id)
      .order("period_month", { ascending: false })
      .order("settled_at", { ascending: false })
      .limit(36),
    supabase.rpc("list_organization_members", { p_organization_id: organization.id }),
    supabase.from("payment_methods").select("id, name").eq("organization_id", organization.id).eq("is_active", true).order("sort_order").order("name"),
  ]);

  if (employeesResult.error || movementsResult.error || dashboardResult.error || settlementsResult.error || membersResult.error || paymentMethodsResult.error) {
    throw new Error("No se pudo cargar la información salarial.");
  }

  const employees = employeesResult.data ?? [];
  const movements = movementsResult.data ?? [];
  const adjustmentMovements = movements.filter((movement) => movement.kind !== "salary");
  const settlements = settlementsResult.data ?? [];
  const dashboard = enrichPayrollDashboard(
    dashboardResult.data as unknown as PayrollDashboard,
    adjustmentMovements,
    settlements,
  );
  const dashboardByEmployee = new Map(dashboard.employees.map((employee) => [employee.id, employee]));
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const accounts: StaffAccountOption[] = (membersResult.data ?? [])
    .filter((member) => member.role === "staff" && member.is_active)
    .map((member) => ({
      id: member.user_id,
      name: member.display_name || member.email || member.user_id,
    }));
  const grossSales = dashboard.employees[0]?.grossSales ?? 0;
  const estimatedPayroll = dashboard.employees.reduce((sum, employee) => sum + employee.estimatedSalary, 0);
  const totalMovements = adjustmentMovements.reduce((sum, movement) => {
    const sign = movement.kind === "bonus" ? 1 : -1;
    return sum + sign * Number(movement.amount);
  }, 0);
  const periodClosed = month < currentMonth;

  return (
    <div className="page-container payroll-admin-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Equipo y remuneraciones</span>
          <h1 className="page-title mt-2">Personal y sueldos</h1>
          <p className="page-lead">Cálculo automático sobre ventas del local, liquidaciones mensuales y pagos.</p>
        </div>
        <details className="header-details">
          <summary className="button button-primary"><Plus size={17} /> Nuevo empleado</summary>
          <div className="details-panel"><EmployeeForm accounts={accounts} /></div>
        </details>
      </header>

      <section className="summary-strip payroll-summary-strip">
        <span className="summary-strip-icon"><UsersRound size={20} /></span>
        <div><small>Personal activo</small><strong>{activeEmployees.length}</strong></div>
        <div><small>Ventas del local</small><strong>{ars.format(grossSales)}</strong></div>
        <div><small>Sueldos estimados</small><strong>{ars.format(estimatedPayroll)}</strong></div>
        <form className="month-filter" method="get"><label className="field-label">Período<input className="field-input" defaultValue={month} name="mes" type="month" /></label><button className="button button-secondary" type="submit">Ver</button></form>
      </section>

      <section className="records-section">
        <div className="section-heading-row"><div><span className="eyebrow">Condiciones actuales</span><h2>Acumulado de {payrollMonthLabel(month)}</h2></div></div>
        <div className="payroll-overview-list">
          {dashboard.employees.map((employee) => (
            <CompensationSummary
              actions={(
                <>
                  <details className="row-editor payroll-config-editor">
                    <summary className="button button-secondary"><Settings2 size={16} /> Configurar sueldo</summary>
                    <div className="row-editor-panel"><CompensationForm employee={employee} month={month} /></div>
                  </details>
                  {!employee.settlement ? (
                    <SettlementForm disabled={!periodClosed || !employee.configured} employeeId={employee.id} month={month} />
                  ) : employee.settlement.status === "settled" ? (
                    <details className="row-editor payroll-payment-editor">
                      <summary className="button button-primary"><CircleDollarSign size={16} /> Registrar pago</summary>
                      <div className="row-editor-panel"><PaymentForm paymentMethods={paymentMethodsResult.data ?? []} settlementId={employee.settlement.id} total={employee.settlement.netSalary} /></div>
                    </details>
                  ) : null}
                </>
              )}
              employee={employee}
              key={employee.id}
              meta={dashboard.meta}
            />
          ))}
          {dashboard.employees.length === 0 ? <p className="inline-empty">No hay empleados para mostrar.</p> : null}
        </div>
      </section>

      <section className="records-section">
        <div className="section-heading-row"><div><span className="eyebrow">Legajos y accesos</span><h2>Empleados</h2></div></div>
        <div className="entity-list">
          {employees.map((employee) => {
            const compensation = dashboardByEmployee.get(employee.id);
            return (
              <article className="entity-row" key={employee.id}>
                <span className="entity-avatar"><UsersRound size={19} /></span>
                <div className="entity-copy">
                  <strong>{employee.last_name}, {employee.first_name}</strong>
                  <small>{employee.document_number ? `DNI ${employee.document_number}` : "Documento pendiente"} · Base {ars.format(compensation?.baseSalary ?? Number(employee.base_salary))} · {employee.user_id ? "Cuenta vinculada" : "Sin acceso vinculado"}</small>
                </div>
                <span className={`tag ${employee.status === "inactive" ? "tag-muted" : ""}`}>{employee.status === "active" ? "Activo" : "Inactivo"}</span>
                <details className="row-editor"><summary className="icon-button" title="Editar"><Pencil size={17} /></summary><div className="row-editor-panel"><EmployeeForm accounts={accounts} values={employee} /></div></details>
                <form action={toggleEmployeeAction}><input name="id" type="hidden" value={employee.id} /><input name="status" type="hidden" value={employee.status === "active" ? "inactive" : "active"} /><button className="icon-button" title={employee.status === "active" ? "Dar de baja" : "Reactivar"} type="submit"><UserRoundX size={17} /></button></form>
              </article>
            );
          })}
          {employees.length === 0 ? <p className="inline-empty">Todavía no hay empleados cargados.</p> : null}
        </div>
      </section>

      <section className="records-section payroll-grid">
        <div>
          <div className="section-heading-row"><div><span className="eyebrow">Ajustes adicionales</span><h2>Adelantos, bonos y descuentos</h2></div><BadgeDollarSign size={21} /></div>
          <PayrollMovementForm employees={activeEmployees.map((employee) => ({ id: employee.id, name: `${employee.last_name}, ${employee.first_name}`, baseSalary: Number(employee.base_salary) }))} month={month} />
        </div>
        <div>
          <div className="section-heading-row"><div><span className="eyebrow">Período {month}</span><h2>Movimientos · {ars.format(totalMovements)}</h2></div></div>
          <div className="compact-list">
            {adjustmentMovements.map((movement) => (
              <div className="compact-list-row" key={movement.id}>
                <div><strong>{movement.employees?.last_name}, {movement.employees?.first_name}</strong><small>{kindLabels[movement.kind]} · {movement.expense_id ? `Gasto del ${localDate(movement.expenses?.expense_date ?? movement.period_month)}` : movement.paid_at ? localDate(movement.paid_at) : "Pendiente de pago"}</small></div>
                <strong className={movement.kind === "bonus" ? "positive-value" : "negative-value"}>{movement.kind === "bonus" ? "+ " : "- "}{ars.format(Number(movement.amount))}</strong>
                {!movement.settlement_id && !movement.expense_id ? <form action={deletePayrollMovementAction}><input name="id" type="hidden" value={movement.id} /><ConfirmSubmitButton message="¿Eliminar este movimiento? Esta acción no se puede deshacer." title="Eliminar movimiento"><Trash2 size={16} /></ConfirmSubmitButton></form> : null}
              </div>
            ))}
            {movements.length === 0 ? <p className="inline-empty">Sin movimientos adicionales para este mes.</p> : null}
          </div>
        </div>
      </section>

      <section className="records-section">
        <div className="section-heading-row"><div><span className="eyebrow">Snapshots inmutables</span><h2>Historial de liquidaciones</h2></div></div>
        <div className="data-table-wrap compact-table-wrap" data-mobile-cards>
          <table className="data-table payroll-history-table">
            <thead><tr><th>Período</th><th>Empleado</th><th>Bruto</th><th>Adelantos</th><th>Otros ajustes</th><th>A pagar</th><th>Pago</th><th>Estado</th></tr></thead>
            <tbody>
              {settlements.map((settlement) => (
                <tr key={settlement.id}>
                  <td data-label="Período">{payrollMonthLabel(settlement.period_month)}</td>
                  <td data-label="Empleado">{settlement.employees?.last_name}, {settlement.employees?.first_name}</td>
                  <td data-label="Bruto"><strong>{ars.format(Number(settlement.gross_salary))}</strong><small>Base + comisión</small></td>
                  <td data-label="Adelantos"><strong className={Number(settlement.advance_amount) > 0 ? "negative-value" : ""}>{Number(settlement.advance_amount) > 0 ? "- " : ""}{ars.format(Number(settlement.advance_amount))}</strong></td>
                  <td data-label="Otros ajustes"><small>Bonos +{ars.format(Number(settlement.bonus_amount))}</small><small>Descuentos -{ars.format(Number(settlement.deduction_amount))}</small></td>
                  <td data-label="A pagar"><strong>{ars.format(Number(settlement.net_salary))}</strong></td>
                  <td data-label="Pago">{settlement.payroll_settlement_payments.length > 0
                    ? settlement.payroll_settlement_payments.map((payment) => `${payment.payment_methods?.name ?? "Medio"}: ${ars.format(Number(payment.amount))}`).join(" + ")
                    : settlement.payment_method ?? "Pendiente"}</td>
                  <td data-label="Estado"><span className={`table-status ${settlement.status === "paid" ? "table-status-ok" : ""}`}>{settlement.status === "paid" ? "Pagado" : "Liquidado"}</span></td>
                </tr>
              ))}
              {settlements.length === 0 ? <tr><td className="table-empty-cell" colSpan={8}>Todavía no hay liquidaciones cerradas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
