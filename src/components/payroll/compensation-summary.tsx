import { BadgeDollarSign, CalendarDays, CircleCheck, ReceiptText, Store, TrendingUp } from "lucide-react";

import { ars, dateTime, localDate } from "@/lib/format";
import {
  payrollMonthLabel,
  payrollProgress,
  type PayrollDashboard,
  type PayrollEmployeeSummary,
} from "@/lib/payroll/dashboard";

export function CompensationSummary({
  employee,
  meta,
  actions,
  compact = false,
}: {
  employee: PayrollEmployeeSummary;
  meta: PayrollDashboard["meta"];
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  const settlement = employee.settlement;
  const grossTotal = settlement?.grossSalary ?? employee.grossSalary;
  const total = settlement?.netSalary ?? employee.estimatedSalary;
  const advanceAmount = settlement?.advanceAmount ?? employee.advanceAmount;
  const bonusAmount = settlement?.bonusAmount ?? employee.bonusAmount;
  const deductionAmount = settlement?.deductionAmount ?? employee.deductionAmount;
  const adjustments = settlement?.adjustments ?? employee.adjustments;
  const paidAmount = settlement?.status === "paid" ? settlement.netSalary : 0;
  const pendingAmount = Math.max(0, total - paidAmount);
  const progress = payrollProgress(meta.daysElapsed, meta.daysInMonth);

  return (
    <article className={`payroll-overview ${compact ? "payroll-overview-compact" : ""}`}>
      <header className="payroll-overview-header">
        <div className="payroll-person">
          <span className="payroll-person-icon"><BadgeDollarSign size={21} /></span>
          <div>
            <span className="eyebrow">{payrollMonthLabel(meta.periodMonth)}</span>
            <h2>{employee.name}</h2>
            <small>Comisión sobre las ventas brutas válidas de todo el local.</small>
          </div>
        </div>
        <span className={`table-status ${settlement?.status === "paid" ? "table-status-ok" : ""}`}>
          {settlement?.status === "paid" ? "Liquidado" : settlement ? "Pendiente de pago" : advanceAmount > 0 ? meta.isCurrentMonth ? "Con adelantos · provisorio" : "Con adelantos" : meta.isCurrentMonth ? "Provisorio" : "Pendiente de liquidación"}
        </span>
      </header>

      {!employee.configured ? (
        <div className="payroll-configuration-missing">
          Todavía no hay condiciones salariales configuradas para este período.
        </div>
      ) : (
        <>
          <div className="payroll-metrics">
            <div><span>Sueldo base</span><strong>{ars.format(settlement?.baseSalary ?? employee.baseSalary)}</strong></div>
            <div><span>Ventas del local</span><strong>{ars.format(settlement?.commissionBase ?? employee.grossSales)}</strong><small>{settlement?.salesCount ?? employee.salesCount} operaciones válidas</small></div>
            <div><span>Comisión {settlement?.commissionPercentage ?? employee.commissionPercentage}%</span><strong>{ars.format(settlement?.commissionAmount ?? employee.commissionAmount)}</strong></div>
            <div className="payroll-total"><span>Sueldo generado</span><strong>{ars.format(grossTotal)}</strong></div>
          </div>

          <div className="payroll-adjustments">
            <div className="payroll-adjustments-summary">
              <div><span>Adelantos</span><strong className="negative-value">- {ars.format(advanceAmount)}</strong></div>
              {bonusAmount > 0 ? <div><span>Bonos históricos</span><strong className="positive-value">+ {ars.format(bonusAmount)}</strong></div> : null}
              {deductionAmount > 0 ? <div><span>Descuentos históricos</span><strong className="negative-value">- {ars.format(deductionAmount)}</strong></div> : null}
              <div><span>Liquidación abonada</span><strong>{ars.format(paidAmount)}</strong></div>
              <div><span>Total abonado</span><strong>{ars.format(advanceAmount + paidAmount)}</strong></div>
              <div><span>Saldo pendiente</span><strong>{ars.format(pendingAmount)}</strong></div>
            </div>
          {adjustments.length > 0 ? (
              <details className="payroll-adjustment-details">
                <summary><ReceiptText size={15} /> Ver movimientos del período</summary>
                <div>
                  {adjustments.map((adjustment) => (
                    <p key={adjustment.id}>
                      <span><strong>{adjustment.description}</strong><small>{localDate(adjustment.occurredOn)} · {adjustment.sourceType === "expense" ? "Registro anterior" : "Personal"}</small></span>
                      <strong className={adjustment.kind === "bonus" ? "positive-value" : "negative-value"}>{adjustment.kind === "bonus" ? "+ " : "- "}{ars.format(adjustment.amount)}</strong>
                    </p>
                  ))}
                </div>
              </details>
          ) : null}
          </div>

          <div className="payroll-month-progress">
            <div>
              <span><CalendarDays size={15} /> Avance del período</span>
              <strong>{meta.daysElapsed}/{meta.daysInMonth} días</strong>
            </div>
            <div aria-label={`${progress}% del mes transcurrido`} className="payroll-progress-track"><span style={{ width: `${progress}%` }} /></div>
          </div>

          {meta.projectionAvailable && employee.projectedSalary !== null ? (
            <div className="payroll-projection">
              <TrendingUp size={19} />
              <div><span>Estimación de cierre</span><strong>{ars.format(employee.projectedSalary)}</strong></div>
              <div><span>Ventas proyectadas</span><strong>{ars.format(employee.projectedSales ?? 0)}</strong></div>
              <div><span>Comisión proyectada</span><strong>{ars.format(employee.projectedCommission ?? 0)}</strong></div>
            </div>
          ) : !settlement && meta.isCurrentMonth ? (
            <p className="payroll-projection-empty">Sin datos suficientes para proyectar el cierre del mes.</p>
          ) : null}

          <footer className="payroll-overview-footer">
            <span><Store size={14} /> Alcance: ventas totales del local</span>
            {employee.lastUpdated ? <span>Actualizado {dateTime.format(new Date(employee.lastUpdated))}</span> : <span>Sin ventas registradas en el período</span>}
            {settlement ? <span><CircleCheck size={14} /> Snapshot histórico guardado</span> : null}
          </footer>
        </>
      )}

      {actions ? <div className="payroll-actions">{actions}</div> : null}
    </article>
  );
}
