"use client";

import { Plus, Save } from "lucide-react";
import { useActionState, useState } from "react";

import {
  createExpenseCategoryAction,
  saveExpenseAction,
} from "@/app/app/gastos/actions";
import type { ActionState } from "@/lib/actions/form-state";

type CategoryOption = { id: string; name: string; is_payroll_advance: boolean };
type Option = { id: string; name: string };
type ExpenseValues = {
  id?: string;
  description?: string;
  amount?: number;
  expense_date?: string;
  category_id?: string | null;
  payment_method_id?: string | null;
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
}: {
  categories: CategoryOption[];
  paymentMethods: Option[];
  values?: ExpenseValues;
  canChooseDate?: boolean;
  closedThrough?: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveExpenseAction, {});
  const initialDate = values.expense_date ?? today();
  const [expenseDate, setExpenseDate] = useState(initialDate);
  const [categoryId, setCategoryId] = useState(values.category_id ?? "");
  const usesCurrentCashDay = Boolean(closedThrough && expenseDate <= closedThrough);
  return (
    <form action={action} className="entity-form">
      <input name="id" type="hidden" value={values.id ?? ""} />
      <div className="form-grid">
        <label className="field-label form-span-2">
          Descripción
          <input className="field-input" defaultValue={values.description} maxLength={240} name="description" required />
        </label>
        <label className="field-label">
          Importe
          <input className="field-input" defaultValue={values.amount} inputMode="decimal" min="0.01" name="amount" required step="0.01" type="number" />
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
        <label className="field-label">
          Medio de pago
          <select className="field-input" defaultValue={values.payment_method_id ?? ""} name="payment_method_id" required>
            <option disabled value="">Seleccionar medio</option>
            {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
          </select>
        </label>
        <input name="payroll_employee_id" type="hidden" value="" />
        <input name="payroll_period_month" type="hidden" value="" />
        <label className="field-label form-span-2">
          Nota
          <textarea className="field-textarea" defaultValue={values.notes ?? ""} maxLength={1000} name="notes" rows={2} />
        </label>
      </div>
      {canChooseDate && usesCurrentCashDay ? (
        <p className="form-info">
          Esa fecha ya pertenece a un período de caja cerrado. El gasto conservará la fecha elegida y la salida de dinero se registrará en la caja abierta actual; el cierre histórico no se modifica.
        </p>
      ) : null}
      {(state.error || state.message) && <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>}
      <button className="button button-primary" disabled={pending} type="submit"><Save size={17} /> {pending ? "Guardando..." : "Guardar gasto"}</button>
    </form>
  );
}

export function ExpenseCategoryForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createExpenseCategoryAction, {});
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
