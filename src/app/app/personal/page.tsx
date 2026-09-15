import {
  Ban,
  BadgeDollarSign,
  CircleDollarSign,
  Pencil,
  Plus,
  Settings2,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import { redirect } from "next/navigation";

import { toggleEmployeeAction } from "@/app/app/personal/actions";
import {
  CompensationForm,
  PaymentForm,
  SettlementForm,
} from "@/app/app/personal/payroll-forms";
import {
  EmployeeForm,
  PayrollAdvanceForm,
  VoidPayrollAdvanceForm,
  VoidPayrollSettlementForm,
  type StaffAccountOption,
} from "@/app/app/personal/personnel-forms";
import { CompensationSummary } from "@/components/payroll/compensation-summary";
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
  searchParams: Promise<{ mes?: string; empleado?: string; liquidar?: string }>;
}) {
  const params = await searchParams;
  const currentMonth = currentYearMonth();
  const month = isYearMonth(params.mes) ? params.mes : currentMonth;
  const periodStart = `${month}-01`;
  const selectedEmployeeId = /^[0-9a-f-]{36}$/i.test(params.empleado ?? "") ? params.empleado ?? "" : "";
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  if (organization.role === "staff") redirect("/app/mi-sueldo");

  const [employeesResult, movementsResult, dashboardResult, settlementsResult, membersResult, paymentMethodsResult] = await Promise.all([
    supabase.from("employees").select("*").eq("organization_id", organization.id).order("status").order("last_name"),
    supabase
      .from("payroll_movements")
      .select("*, employees(first_name, last_name), expenses(expense_date, description, payment_method_id, payment_methods(name)), payment_methods(name, code)")
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
      .select("*, employees(first_name, last_name), payroll_settlement_payments(amount, payment_methods(name)), payroll_settlement_adjustments(id, kind, amount, occurred_on, description, source_type, payroll_movements(paid_at, payment_methods(name), expenses(expense_date, payment_methods(name))))")
      .eq("organization_id", organization.id)
      .order("period_month", { ascending: false })
      .order("settled_at", { ascending: false })
      .limit(36),
    supabase.rpc("list_organization_members", { p_organization_id: organization.id }),
    supabase.from("payment_methods").select("id, name, code").eq("organization_id", organization.id).eq("is_active", true).order("sort_order").order("name"),
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
  const visibleEmployees = selectedEmployeeId
    ? dashboard.employees.filter((employee) => employee.id === selectedEmployeeId)
    : dashboard.employees;
  const payMethods = (paymentMethodsResult.data ?? []).filter((method) => method.code === "cash" || method.code === "transfer");
  const paymentNameById = new Map((paymentMethodsResult.data ?? []).map((method) => [method.id, method.name]));
  const accounts: StaffAccountOption[] = (membersResult.data ?? [])
    .filter((member) => member.role === "staff" && member.is_active)
    .map((member) => ({
      id: member.user_id,
      name: member.display_name || member.email || member.user_id,
    }));
  const grossSales = dashboard.employees[0]?.grossSales ?? 0;
  const estimatedPayroll = dashboard.employees.reduce((sum, employee) => sum + employee.estimatedSalary, 0);
  const totalMovements = adjustmentMovements.reduce((sum, movement) => {
    if (movement.voided_at || movement.kind !== "advance" || (selectedEmployeeId && movement.employee_id !== selectedEmployeeId)) return sum;
    return sum + Number(movement.amount);
  }, 0);
  const hasUnlinkedLegacyAdvances = adjustmentMovements.some((movement) => (
    movement.kind === "advance" && !movement.expense_id && !movement.payment_method_id
      && !movement.voided_at
  ));
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
        <form className="month-filter" method="get"><label className="field-label">Período<input className="field-input" defaultValue={month} name="mes" type="month" /></label><label className="field-label">Empleado<select className="field-input" defaultValue={selectedEmployeeId} name="empleado"><option value="">Todos</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.last_name}, {employee.first_name}</option>)}</select></label><button className="button button-secondary" type="submit">Ver</button></form>
      </section>

      <section className="records-section">
        <div className="section-heading-row"><div><span className="eyebrow">Condiciones actuales</span><h2>Acumulado de {payrollMonthLabel(month)}</h2></div></div>
        <div className="payroll-overview-list">
          {visibleEmployees.map((employee) => (
            <CompensationSummary
              actions={(
                <>
                  <details className="row-editor payroll-config-editor">
                    <summary className="button button-secondary"><Settings2 size={16} /> Configurar sueldo</summary>
                    <div className="row-editor-panel"><CompensationForm employee={employee} month={month} /></div>
                  </details>
                  {!employee.settlement ? (
                    <SettlementForm autoOpen={params.liquidar === employee.id} currentMonth={currentMonth} disabled={!periodClosed || !employee.configured} employee={employee} hasUnlinkedLegacyAdvances={adjustmentMovements.some((movement) => movement.employee_id === employee.id && movement.kind === "advance" && !movement.expense_id && !movement.payment_method_id && !movement.voided_at)} key={`${employee.id}-${month}`} month={month} paymentMethods={payMethods} />
                  ) : employee.settlement.status === "settled" ? (
                    <details className="row-editor payroll-payment-editor">
                      <summary className="button button-primary"><CircleDollarSign size={16} /> Registrar pago</summary>
                      <div className="row-editor-panel"><PaymentForm paymentMethods={payMethods} settlementId={employee.settlement.id} total={employee.settlement.netSalary} /></div>
                    </details>
                  ) : null}
                </>
              )}
              employee={employee}
              key={employee.id}
              meta={dashboard.meta}
            />
          ))}
          {visibleEmployees.length === 0 ? <p className="inline-empty">No hay empleados para mostrar.</p> : null}
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
          <div className="section-heading-row"><div><span className="eyebrow">Egresos de Personal</span><h2>Registrar adelanto</h2></div><BadgeDollarSign size={21} /></div>
          <PayrollAdvanceForm employees={activeEmployees.filter((employee) => !dashboardByEmployee.get(employee.id)?.settlement).map((employee) => ({ id: employee.id, name: `${employee.last_name}, ${employee.first_name}`, availableSalary: dashboardByEmployee.get(employee.id)?.estimatedSalary ?? 0 }))} month={month} paymentMethods={payMethods} selectedEmployeeId={selectedEmployeeId} />
        </div>
        <div>
          <div className="section-heading-row"><div><span className="eyebrow">Período {month}</span><h2>Adelantos vigentes · {ars.format(totalMovements)}</h2></div></div>
          <div className="compact-list">
            {adjustmentMovements.filter((movement) => !selectedEmployeeId || movement.employee_id === selectedEmployeeId).map((movement) => (
              <div className="compact-list-row" key={movement.id}>
                <div>
                  <strong>{movement.employees?.last_name}, {movement.employees?.first_name}</strong>
                  <small>{kindLabels[movement.kind]} · {movement.expense_id ? `Registro histórico del ${localDate(movement.expenses?.expense_date ?? movement.period_month)}` : movement.paid_at ? localDate(movement.paid_at) : "Fecha sin registrar"}</small>
                  {movement.kind === "advance" ? <small className="payroll-adjustment-payment">Medio de egreso: {movement.payment_methods?.name ?? movement.expenses?.payment_methods?.name ?? (movement.expenses?.payment_method_id ? paymentNameById.get(movement.expenses.payment_method_id) : null) ?? "sin registrar (histórico)"}</small> : null}
                  {movement.voided_at ? <small>Anulado: {movement.void_reason}</small> : null}
                </div>
                <strong className={movement.voided_at ? "" : movement.kind === "bonus" ? "positive-value" : "negative-value"}>{movement.voided_at ? "Anulado · " : movement.kind === "bonus" ? "+ " : "- "}{ars.format(Number(movement.amount))}</strong>
                {!movement.settlement_id && !movement.expense_id && movement.payment_method_id && !movement.voided_at && !dashboardByEmployee.get(movement.employee_id)?.settlement ? <details className="row-editor"><summary className="icon-button icon-button-danger" title="Anular adelanto"><Ban size={16} /></summary><div className="row-editor-panel"><VoidPayrollAdvanceForm id={movement.id} /></div></details> : null}
              </div>
            ))}
            {adjustmentMovements.length === 0 ? <p className="inline-empty">Sin adelantos para este mes.</p> : null}
          </div>
        </div>
      </section>

      {hasUnlinkedLegacyAdvances ? <p className="form-error payroll-legacy-notice">Este período tiene adelantos históricos sin egreso de caja vinculado. Revisá esos importes antes de liquidar; no se modificaron automáticamente.</p> : null}

      <section className="records-section">
        <div className="section-heading-row"><div><span className="eyebrow">Valores históricos guardados</span><h2>Historial de liquidaciones</h2></div></div>
        <div className="data-table-wrap compact-table-wrap" data-mobile-cards>
          <table className="data-table payroll-history-table">
            <thead><tr><th>Período</th><th>Empleado</th><th>Generado</th><th>Adelantos</th><th>Pago final</th><th>Abonado</th><th>Pendiente</th><th>Estado</th></tr></thead>
            <tbody>
              {settlements.filter((settlement) => !selectedEmployeeId || settlement.employee_id === selectedEmployeeId).map((settlement) => {
                const advance = Number(settlement.advance_amount);
                const finalPayment = Number(settlement.net_salary);
                const paid = settlement.status === "paid" && !settlement.voided_at ? finalPayment : 0;
                const totalPaid = settlement.voided_at ? 0 : advance + paid;
                return <tr key={settlement.id}>
                  <td data-label="Período">{payrollMonthLabel(settlement.period_month)}</td>
                  <td data-label="Empleado"><strong>{settlement.employees?.last_name}, {settlement.employees?.first_name}</strong><details className="payroll-history-details"><summary>Ver detalle</summary><div className="payroll-history-breakdown"><span>Básico</span><strong>{ars.format(Number(settlement.base_salary))}</strong><span>Ventas del mes</span><strong>{ars.format(Number(settlement.commission_base))}</strong><span>Comisión {Number(settlement.commission_percentage)}%</span><strong>{ars.format(Number(settlement.commission_amount))}</strong>{Number(settlement.bonus_amount) > 0 ? <><span>Bonos históricos</span><strong>{ars.format(Number(settlement.bonus_amount))}</strong></> : null}{Number(settlement.deduction_amount) > 0 ? <><span>Descuentos históricos</span><strong>- {ars.format(Number(settlement.deduction_amount))}</strong></> : null}</div><div className="payroll-history-events">{settlement.payroll_settlement_adjustments.map((movement) => <p key={movement.id}><span>{localDate(movement.occurred_on)} · {kindLabels[movement.kind]} · Medio de egreso: {movement.payroll_movements?.payment_methods?.name ?? movement.payroll_movements?.expenses?.payment_methods?.name ?? "sin registrar (histórico)"}</span><strong>{ars.format(Number(movement.amount))}</strong></p>)}{settlement.status === "paid" ? <p><span>{settlement.paid_at ? localDate(settlement.paid_at) : "Fecha no registrada"} · Liquidación · {settlement.payroll_settlement_payments.length > 0 ? settlement.payroll_settlement_payments.map((payment) => `${payment.payment_methods?.name ?? "Medio"} ${ars.format(Number(payment.amount))}`).join(" + ") : settlement.payment_method ?? "Sin egreso"}</span><strong>{ars.format(finalPayment)}</strong></p> : null}</div></details></td>
                  <td data-label="Generado"><strong>{ars.format(Number(settlement.gross_salary))}</strong></td>
                  <td data-label="Adelantos">{ars.format(advance)}</td>
                  <td data-label="Pago final">{settlement.status === "paid" ? <>{ars.format(finalPayment)}{settlement.voided_at ? <small>Reintegrado</small> : null}</> : "Pendiente"}</td>
                  <td data-label="Abonado">{ars.format(totalPaid)}</td>
                  <td data-label="Pendiente"><strong>{settlement.voided_at ? "No vigente" : ars.format(Math.max(0, finalPayment - paid))}</strong></td>
                  <td data-label="Estado"><span className={`table-status ${settlement.status === "paid" && !settlement.voided_at ? "table-status-ok" : ""}`}>{settlement.voided_at ? "Anulado" : settlement.status === "paid" ? "Pagado" : "Pendiente de pago"}</span>{settlement.voided_at ? <small>{settlement.void_reason}</small> : settlement.status === "paid" ? <details className="payroll-history-void"><summary>Corregir</summary><VoidPayrollSettlementForm id={settlement.id} /></details> : null}</td>
                </tr>;
              })}
              {settlements.length === 0 ? <tr><td className="table-empty-cell" colSpan={8}>Todavía no hay liquidaciones cerradas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
