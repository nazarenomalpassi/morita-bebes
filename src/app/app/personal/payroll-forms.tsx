"use client";

import { Calculator, CircleDollarSign, Save } from "lucide-react";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

import {
  markPayrollPaidAction,
  saveCompensationAction,
  settlePayrollAction,
} from "@/app/app/personal/actions";
import type { ActionState } from "@/lib/actions/form-state";
import { ars } from "@/lib/format";
import type { PayrollEmployeeSummary } from "@/lib/payroll/dashboard";
import { sanitizeDecimalInput } from "@/lib/sales/decimal-input";

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

function ActionMessage({ state }: { state: ActionState }) {
  if (!state.error && !state.message) return null;
  return <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>;
}

export function CompensationForm({
  employee,
  month,
}: {
  employee: PayrollEmployeeSummary;
  month: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCompensationAction, {});
  return (
    <form action={action} className="entity-form payroll-config-form">
      <input name="employee_id" type="hidden" value={employee.id} />
      <div className="form-grid">
        <label className="field-label">Sueldo base<input className="field-input" defaultValue={employee.baseSalary} inputMode="decimal" min="0" name="base_salary" required step="0.01" type="number" /></label>
        <label className="field-label">Comisión sobre ventas<input className="field-input" defaultValue={employee.commissionPercentage} inputMode="decimal" min="0" max="100" name="commission_percentage" required step="0.01" type="number" /></label>
        <label className="field-label">Vigente desde<input className="field-input" defaultValue={month} name="effective_month" required type="month" /></label>
        <label className="field-label">Tipo<input className="field-input" disabled value="Ventas totales del local" /></label>
        <label className="field-label form-span-2">Motivo o nota<textarea className="field-textarea" maxLength={500} name="notes" rows={2} /></label>
      </div>
      <ActionMessage state={state} />
      <button className="button button-primary" disabled={pending} type="submit"><Save size={16} /> {pending ? "Guardando..." : "Guardar condiciones"}</button>
    </form>
  );
}

export function SettlementForm({
  employee,
  month,
  currentMonth,
  autoOpen,
  hasUnlinkedLegacyAdvances,
  disabled,
  paymentMethods,
}: {
  employee: PayrollEmployeeSummary;
  month: string;
  currentMonth: string;
  autoOpen: boolean;
  hasUnlinkedLegacyAdvances: boolean;
  disabled: boolean;
  paymentMethods: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(settlePayrollAction, {});
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [combined, setCombined] = useState(false);
  const [methodId, setMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const roundedTotal = Math.round(employee.estimatedSalary * 100) / 100;
  const payments = roundedTotal === 0 ? [] : combined
    ? paymentMethods.flatMap((method) => {
        const amount = Number(amounts[method.id] || 0);
        return amount > 0 ? [{ payment_method_id: method.id, amount: Math.round(amount * 100) / 100 }] : [];
      })
    : methodId ? [{ payment_method_id: methodId, amount: roundedTotal }] : [];
  const allocated = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const matches = roundedTotal === 0 || (payments.length > 0 && Math.abs(allocated - roundedTotal) < 0.005);
  return (
    <details className="row-editor payroll-payment-editor" open={autoOpen}>
    <summary className="button button-primary"><Calculator size={16} /> Liquidar sueldo</summary>
    <div className="row-editor-panel">
    <form action={action} className="entity-form payroll-payment-form">
      <input name="employee_id" type="hidden" value={employee.id} />
      <input name="period_month" type="hidden" value={month} />
      <input name="payments" type="hidden" value={JSON.stringify(payments)} />
      <input name="notes" type="hidden" value="Liquidación mensual confirmada desde Personal" />
      <label className="field-label">Mes a liquidar<input className="field-input" max={currentMonth} onChange={(event) => {
        const nextMonth = event.target.value;
        setSelectedMonth(nextMonth);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(nextMonth)) return;
        const params = new URLSearchParams({ mes: nextMonth, empleado: employee.id, liquidar: employee.id });
        router.push(`/app/personal?${params}`, { scroll: false });
      }} required type="month" value={selectedMonth} /></label>
      <div aria-live="polite" className="payroll-settlement-breakdown">
        <div><span>Sueldo básico</span><strong>{ars.format(employee.baseSalary)}</strong></div>
        <div><span>Ventas del mes</span><strong>{ars.format(employee.grossSales)}</strong></div>
        <div><span>Comisión {employee.commissionPercentage}%</span><strong>{ars.format(employee.commissionAmount)}</strong></div>
        <div><span>Sueldo generado</span><strong>{ars.format(employee.grossSalary)}</strong></div>
        <div><span>Adelantos del mes</span><strong>- {ars.format(employee.advanceAmount)}</strong></div>
        {employee.bonusAmount > 0 ? <div><span>Bonos históricos</span><strong>+ {ars.format(employee.bonusAmount)}</strong></div> : null}
        {employee.deductionAmount > 0 ? <div><span>Descuentos históricos</span><strong>- {ars.format(employee.deductionAmount)}</strong></div> : null}
        <div className="payroll-settlement-total"><span>Total a cobrar</span><strong>{ars.format(roundedTotal)}</strong></div>
      </div>
      {hasUnlinkedLegacyAdvances ? <p className="form-error">Este mes incluye adelantos históricos sin salida de Caja vinculada. Revisá que no dupliquen otros pagos antes de confirmar.</p> : null}
      <p className="payroll-advance-hint">El egreso de Caja se registra con la fecha de hoy al confirmar. Los importes se verifican nuevamente en la base.</p>
      {roundedTotal > 0 ? <>
        <label className="field-label sale-combined-toggle"><span>Pago combinado</span><input checked={combined} onChange={(event) => setCombined(event.target.checked)} type="checkbox" /></label>
        {combined ? <div className="sale-payment-allocation">
          {paymentMethods.map((method) => <label className="field-label" key={method.id}>{method.name}<input className="field-input" inputMode="decimal" min="0" onChange={(event) => {
            const sanitized = sanitizeDecimalInput(event.target.value);
            if (sanitized !== null) setAmounts((current) => ({ ...current, [method.id]: sanitized }));
          }} step="0.01" type="number" value={amounts[method.id] ?? ""} /></label>)}
          <small className={matches ? "positive-value" : "negative-value"}>{ars.format(allocated)} / {ars.format(roundedTotal)}</small>
        </div> : <label className="field-label">Medio de egreso<select className="field-input" onChange={(event) => setMethodId(event.target.value)} value={methodId}><option disabled value="">Seleccionar</option>{paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>}
      </> : <p className="payroll-advance-hint">Sin saldo a pagar. No se generará otro egreso.</p>}
      <ActionMessage state={state} />
      <button
        className="button button-primary"
        disabled={disabled || pending || selectedMonth !== month || !matches || (roundedTotal > 0 && paymentMethods.length === 0)}
        onClick={(event) => {
          const message = `¿Liquidar ${month} por ${ars.format(roundedTotal)}?\n\nSueldo generado: ${ars.format(employee.grossSalary)}\nAdelantos: ${ars.format(employee.advanceAmount)}\n\nEl pago se descontará de Caja hoy.${hasUnlinkedLegacyAdvances ? "\n\nAtención: hay adelantos históricos sin salida de Caja vinculada." : ""}`;
          if (!window.confirm(message)) event.preventDefault();
        }}
        type="submit"
      >
        <Calculator size={16} /> {pending ? "Liquidando..." : disabled ? month >= currentMonth ? "Elegí un mes cerrado" : "Configurá el sueldo primero" : "Confirmar liquidación y pago"}
      </button>
    </form>
    </div>
    </details>
  );
}

export function PaymentForm({
  settlementId,
  total,
  paymentMethods = [],
}: {
  settlementId: string;
  total: number;
  paymentMethods?: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(markPayrollPaidAction, {});
  const [combinedPayment, setCombinedPayment] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(paymentMethods[0]?.id ?? "");
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const roundedTotal = Math.round(total * 100) / 100;
  const nothingToPay = roundedTotal === 0;
  const payments = nothingToPay ? [] : combinedPayment
    ? paymentMethods.flatMap((method) => {
        const amount = Number(paymentAmounts[method.id] || 0);
        return amount > 0 ? [{ payment_method_id: method.id, amount: Math.round(amount * 100) / 100 }] : [];
      })
    : selectedPaymentMethod
      ? [{ payment_method_id: selectedPaymentMethod, amount: roundedTotal }]
      : [];
  const allocatedTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const allocationMatches = nothingToPay || (payments.length > 0 && Math.abs(allocatedTotal - roundedTotal) < 0.005);

  return (
    <form action={action} className="entity-form payroll-payment-form">
      <input name="settlement_id" type="hidden" value={settlementId} />
      <input name="payments" type="hidden" value={JSON.stringify(payments)} />
      <div className="form-grid">
        <label className="field-label">Fecha de pago<input className="field-input" defaultValue={localToday()} name="paid_at" required type="date" /></label>
        {!nothingToPay && !combinedPayment ? (
          <label className="field-label">Medio de pago<select className="field-input" onChange={(event) => setSelectedPaymentMethod(event.target.value)} required value={selectedPaymentMethod}><option disabled value="">Seleccionar medio</option>{paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
        ) : nothingToPay ? <div className="payroll-zero-balance"><strong>Sin saldo pendiente</strong><small>Los adelantos y ajustes cubren el total. No se generará otro egreso de caja.</small></div> : <div />}
        {!nothingToPay ? <label className="field-label sale-combined-toggle form-span-2"><span>Pago combinado</span><input checked={combinedPayment} onChange={(event) => setCombinedPayment(event.target.checked)} type="checkbox" /></label> : null}
        {!nothingToPay && combinedPayment ? (
          <div className="sale-payment-allocation form-span-2">
            <div className="sale-payment-allocation-head">
              <strong>Distribución del sueldo</strong>
              <span className={allocationMatches ? "positive-value" : "negative-value"}>{ars.format(allocatedTotal)} / {ars.format(roundedTotal)}</span>
            </div>
            {paymentMethods.map((method) => (
              <div className="sale-payment-allocation-row" key={method.id}>
                <label className="field-label">
                  {method.name}
                  <input
                    className="field-input"
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => {
                      const sanitized = sanitizeDecimalInput(event.target.value);
                      if (sanitized === null) return;
                      setPaymentAmounts((current) => ({ ...current, [method.id]: sanitized }));
                    }}
                    placeholder="$ 0"
                    step="0.01"
                    type="number"
                    value={paymentAmounts[method.id] ?? ""}
                  />
                </label>
              </div>
            ))}
            {!allocationMatches ? <small className="form-span-2">La suma debe coincidir exactamente con {ars.format(roundedTotal)}.</small> : null}
          </div>
        ) : null}
        <label className="field-label form-span-2">Nota<textarea className="field-textarea" maxLength={500} name="notes" rows={2} /></label>
      </div>
      <ActionMessage state={state} />
      <button className="button button-primary" disabled={pending || !allocationMatches} type="submit"><CircleDollarSign size={16} /> {pending ? "Registrando..." : nothingToPay ? "Cerrar liquidación" : "Marcar como pagado"}</button>
    </form>
  );
}
