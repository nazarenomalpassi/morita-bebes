"use client";

import { Calculator, CircleDollarSign, Save } from "lucide-react";
import { useActionState, useState } from "react";

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
        <label className="field-label">Comisión sobre ventas<input className="field-input" defaultValue={employee.commissionPercentage || 1} inputMode="decimal" min="0" max="100" name="commission_percentage" required step="0.01" type="number" /></label>
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
  employeeId,
  month,
  disabled,
}: {
  employeeId: string;
  month: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(settlePayrollAction, {});
  return (
    <form action={action} className="payroll-inline-action">
      <input name="employee_id" type="hidden" value={employeeId} />
      <input name="period_month" type="hidden" value={month} />
      <input name="notes" type="hidden" value="Liquidación mensual confirmada desde Personal" />
      <ActionMessage state={state} />
      <button
        className="button button-primary"
        disabled={disabled || pending}
        onClick={(event) => {
          if (!window.confirm("¿Confirmar la liquidación? Los importes quedarán guardados como snapshot histórico.")) event.preventDefault();
        }}
        type="submit"
      >
        <Calculator size={16} /> {pending ? "Liquidando..." : disabled ? "Disponible al cerrar el mes" : "Liquidar sueldo"}
      </button>
    </form>
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
