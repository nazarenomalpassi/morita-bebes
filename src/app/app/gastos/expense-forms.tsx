"use client";

import { Plus, Save } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";
import { useSubmissionState } from "@/lib/ui/use-submission-state";

import {
  createExpenseCategoryAction,
  saveExpenseAction,
  type ExpenseActionState,
} from "@/app/app/gastos/actions";
import type { ExpenseRecord, ExpenseCategory } from "@/lib/expenses/types";
import { readExpensePayments, validateExpensePayments } from "@/lib/expenses/payments";
import { ars } from "@/lib/format";
import { sanitizeDecimalInput } from "@/lib/sales/decimal-input";

type CategoryOption = { id: string; name: string; is_payroll_advance: boolean };
type Option = { id: string; name: string; is_active: boolean };
const subscribe = () => () => {};
type ExpenseValues = {
  id?: string;
  description?: string;
  amount?: number;
  expense_date?: string;
  category_id?: string | null;
  payment_method_id?: string | null;
  payment_allocations?: unknown;
  notes?: string | null;
};

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

export function ExpenseForm({
  categories,
  paymentMethods,
  values = {},
  canChooseDate = true,
  closedThrough = null,
  onSaved,
}: {
  categories: CategoryOption[];
  paymentMethods: Option[];
  values?: ExpenseValues;
  canChooseDate?: boolean;
  closedThrough?: string | null;
  onSaved?: (expense: ExpenseRecord, message: string) => void;
}) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const formRef = useRef<HTMLFormElement>(null);
  const initialPayments = readExpensePayments(values.payment_allocations);
  const initialDate = values.expense_date ?? today();
  const [description, setDescription] = useState(values.description ?? "");
  const [amount, setAmount] = useState(values.amount === undefined ? "" : String(values.amount));
  const [notes, setNotes] = useState(values.notes ?? "");
  const [expenseDate, setExpenseDate] = useState(initialDate);
  const [categoryId, setCategoryId] = useState(values.category_id ?? "");
  const [combined, setCombined] = useState(initialPayments.length > 1);
  const [methodId, setMethodId] = useState(values.payment_method_id ?? initialPayments[0]?.payment_method_id ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(
    initialPayments.map((payment) => [payment.payment_method_id, String(payment.amount)]),
  ));
  const [state, action, pending] = useSubmissionState<ExpenseActionState, FormData>(async (previous, formData) => {
    const result = await saveExpenseAction(previous, formData);
    if (result.expense && !result.error) {
      if (values.id) {
        const panel = formRef.current?.closest("details");
        if (panel) panel.open = false;
      }
      onSaved?.(result.expense, result.message ?? "Gasto guardado.");
    }
    if (result.message && !values.id) {
      setDescription("");
      setAmount("");
      setNotes("");
      setCategoryId("");
      setMethodId("");
      setAmounts({});
      setCombined(false);
    }
    return result;
  }, {});
  const methods = paymentMethods.filter((method) => method.is_active
    || method.id === values.payment_method_id
    || initialPayments.some((payment) => payment.payment_method_id === method.id));
  const parsedAmount = Number(amount || 0);
  const total = Number.isFinite(parsedAmount) ? parsedAmount : 0;
  const payments = combined
    ? methods.flatMap((method) => Number(amounts[method.id] || 0) > 0
      ? [{ payment_method_id: method.id, amount: Number(amounts[method.id]) }]
      : [])
    : methodId && total > 0 ? [{ payment_method_id: methodId, amount: total }] : [];
  const allocated = payments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0) / 100;
  const remaining = Math.round((total - allocated) * 100) / 100;
  const matches = Boolean(validateExpensePayments(payments, total).payments);
  const usesCurrentCashDay = Boolean(closedThrough && expenseDate <= closedThrough);
  return (
    <form action={action} className="entity-form" ref={formRef}>
      <input name="id" type="hidden" value={values.id ?? ""} />
      <input name="payments" type="hidden" value={JSON.stringify(payments)} />
      <fieldset className="form-grid expense-fields" disabled={pending || !ready}>
        <label className="field-label form-span-2">
          Descripción
          <input className="field-input" maxLength={240} name="description" onChange={(event) => setDescription(event.target.value)} required value={description} />
        </label>
        <label className="field-label">
          Importe
          <input className="field-input" inputMode="decimal" name="amount" onChange={(event) => {
            const next = sanitizeDecimalInput(event.target.value);
            if (next !== null) setAmount(next);
          }} placeholder="$ 0" required type="text" value={amount} />
        </label>
        {canChooseDate ? <label className="field-label">Fecha<input className="field-input" name="expense_date" onChange={(event) => {
          const nextDate = event.target.value;
          setExpenseDate(nextDate);
        }} required type="date" value={expenseDate} /></label> : <input name="expense_date" type="hidden" value={today()} />}
        <label className="field-label">
          Categoría
          <select className="field-input" name="category_id" onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
            <option value="">Sin categoría</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        {!combined ? <label className="field-label">
          Medio de pago
          <select className="field-input" onChange={(event) => setMethodId(event.target.value)} required value={methodId}>
            <option disabled value="">Seleccionar medio</option>
            {methods.map((method) => <option disabled={!method.is_active} key={method.id} value={method.id}>{method.name}{!method.is_active ? " (inactivo)" : ""}</option>)}
          </select>
        </label> : null}
        <label className="field-label sale-combined-toggle form-span-2">
          <span>Pago combinado</span>
          <input checked={combined} disabled={pending} onChange={(event) => {
            setCombined(event.target.checked);
            if (event.target.checked && methodId && Object.keys(amounts).length === 0 && total > 0) {
              setAmounts({ [methodId]: String(total) });
            }
          }} type="checkbox" />
        </label>
        {combined ? <div className="sale-payment-allocation expense-payment-allocation form-span-2">
          <div aria-live="polite" className="sale-payment-allocation-head">
            <strong>Distribución del gasto</strong>
            <span className={matches ? "positive-value" : "negative-value"}>{ars.format(allocated)} / {ars.format(total)}</span>
          </div>
          {methods.map((method) => <label className="field-label" key={method.id}>
            {method.name}{!method.is_active ? " (inactivo)" : ""}
            <input className="field-input" inputMode="decimal" onChange={(event) => {
              const next = sanitizeDecimalInput(event.target.value);
              if (next !== null) setAmounts((current) => ({ ...current, [method.id]: next }));
            }} placeholder="$ 0" type="text" value={amounts[method.id] ?? ""} />
          </label>)}
          <small aria-live="polite" className="form-span-2">{matches ? "Importe completo distribuido." : remaining >= 0 ? `Falta distribuir ${ars.format(remaining)}.` : `La distribución supera el gasto por ${ars.format(-remaining)}.`}</small>
        </div> : null}
        <input name="payroll_employee_id" type="hidden" value="" />
        <input name="payroll_period_month" type="hidden" value="" />
        <label className="field-label form-span-2">
          Nota
          <textarea className="field-textarea" maxLength={1000} name="notes" onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} />
        </label>
      </fieldset>
      {canChooseDate && usesCurrentCashDay ? (
        <p className="form-info">
          Esa fecha ya pertenece a un período de caja cerrado. El gasto conservará la fecha elegida y la salida de dinero se registrará en la caja abierta actual; el cierre histórico no se modifica.
        </p>
      ) : null}
      {(state.error || state.message) && <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>}
      <button className="button button-primary" disabled={pending || !ready || !matches} type="submit"><Save size={17} /> {pending ? "Guardando..." : "Guardar gasto"}</button>
    </form>
  );
}

export function ExpenseCategoryForm({ onSaved }: { onSaved?: (category: ExpenseCategory) => void }) {
  const [state, action, pending] = useSubmissionState<ExpenseActionState, FormData>(async (previous, formData) => {
    const result = await createExpenseCategoryAction(previous, formData);
    if (result.category && !result.error) onSaved?.(result.category);
    return result;
  }, {});
  return (
    <form action={action} className="inline-create-form">
      <label className="field-label">
        Nueva categoría
        <input className="field-input" maxLength={100} name="name" required />
      </label>
      <button className="button button-secondary" disabled={pending} type="submit"><Plus size={17} /> Agregar</button>
      {(state.error || state.message) && <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>}
    </form>
  );
}
