"use client";

import { Ban, Pencil, Plus, Receipt, WalletCards } from "lucide-react";
import { useRef, useState } from "react";
import { cancelExpenseAction } from "./actions";
import { ExpenseCategoryForm, ExpenseForm } from "./expense-forms";
import { readExpensePayments } from "@/lib/expenses/payments";
import type { ExpenseCategory, ExpenseRecord } from "@/lib/expenses/types";
import { ars, localDate } from "@/lib/format";
import { usePreservedActionState } from "@/lib/ui/use-preserved-action-state";
import type { ActionState } from "@/lib/actions/form-state";

type Props = {
  initialExpenses: ExpenseRecord[];
  categories: ExpenseCategory[];
  paymentMethods: { id: string; name: string; is_active: boolean }[];
  people: [string, string][];
  month: string;
  employee: string;
  role: "owner" | "admin" | "staff";
  closedThrough: string | null;
};

function CancelExpenseForm({ id, onSaved }: { id: string; onSaved: (expense: ExpenseRecord, message: string) => void }) {
  const { state, formAction, pending, onReset } = usePreservedActionState<ActionState>(async (_previous, data) => {
    try {
      onSaved(await cancelExpenseAction(data), "Gasto anulado.");
      return { message: "Gasto anulado." };
    } catch { return { error: "No pudimos confirmar la anulacion. Verifica el gasto antes de reintentar." }; }
  }, {});
  return <form action={formAction} onReset={onReset} className="row-menu-popover"><input name="id" type="hidden" value={id} /><label className="field-label">Motivo<input className="field-input" minLength={3} name="reason" required /></label>{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}<button className="button button-danger" disabled={pending} type="submit">{pending ? "Anulando..." : "Anular gasto"}</button></form>;
}

export function ExpenseWorkspace({ initialExpenses, categories, paymentMethods, people, month, employee, role, closedThrough }: Props) {
  const [updates, setUpdates] = useState<Record<string, ExpenseRecord>>({});
  const [addedCategories, setAddedCategories] = useState<ExpenseCategory[]>([]);
  const [message, setMessage] = useState("");
  const createPanel = useRef<HTMLDetailsElement>(null);
  const records = new Map(initialExpenses.map((expense) => [expense.id, expense]));
  for (const update of Object.values(updates)) {
    const existing = records.get(update.id);
    if (!existing || Date.parse(update.updated_at) >= Date.parse(existing.updated_at)) records.set(update.id, update);
  }
  const expenses = [...records.values()].filter((expense) => expense.expense_date.startsWith(`${month}-`)
    && !expense.expense_categories?.is_payroll_advance && (!employee || role === "staff" || expense.created_by === employee))
    .sort((left, right) => right.expense_date.localeCompare(left.expense_date) || right.created_at.localeCompare(left.created_at));
  const categoryOptions = [...new Map([...categories, ...addedCategories].map((category) => [category.id, category])).values()].sort((left, right) => left.name.localeCompare(right.name, "es"));
  const names = new Map(people);
  const methodNames = new Map(paymentMethods.map((method) => [method.id, method.name]));
  const total = expenses.filter((expense) => expense.status === "posted").reduce((sum, expense) => sum + Number(expense.amount), 0);
  function onSaved(expense: ExpenseRecord, feedback: string) {
    setUpdates((current) => ({ ...current, [expense.id]: expense }));
    setMessage(feedback);
  }

  return <div className="page-container page-container-wide">
    <header className="page-header"><div><span className="eyebrow">Egresos operativos</span><h1 className="page-title mt-2">Gastos</h1><p className="page-lead">Cada registro conserva autor, fecha real y estado.</p></div><details className="header-details" ref={createPanel}><summary className="button button-primary"><Plus size={17} /> Nuevo gasto</summary><div className="details-panel"><ExpenseForm canChooseDate={role !== "staff"} categories={categoryOptions} closedThrough={closedThrough} paymentMethods={paymentMethods} onSaved={(expense, feedback) => {
      onSaved(expense, feedback);
      if (createPanel.current) createPanel.current.open = false;
    }} /></div></details></header>
    <section className="summary-strip"><span className="summary-strip-icon"><WalletCards size={20} /></span><div><small>Total vigente</small><strong>{ars.format(total)}</strong></div><div><small>Movimientos</small><strong>{expenses.length}</strong></div><form className="month-filter" method="get"><label className="field-label">Mes<input className="field-input" defaultValue={month} name="mes" type="month" /></label>{role !== "staff" ? <label className="field-label">Empleado<select className="field-input" defaultValue={employee} name="empleado"><option value="">Todos</option>{people.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label> : null}<button className="button button-secondary" type="submit">Ver</button></form></section>
    {message ? <p className="form-success" role="status">{message}</p> : null}
    {role !== "staff" ? <details className="maintenance-panel"><summary>Categorías de gasto</summary><ExpenseCategoryForm onSaved={(category) => setAddedCategories((current) => [...current, category])} /></details> : null}
    <div className="data-table-wrap" data-mobile-cards><table className="data-table min-w-[58rem]"><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Pago</th><th>Realizado por</th><th>Importe</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
      {expenses.map((expense) => {
        const payments = readExpensePayments(expense.payment_allocations);
        return <tr key={expense.id}><td data-label="Fecha">{localDate(expense.expense_date)}</td><td data-label="Descripción"><strong>{expense.description}</strong>{expense.notes ? <small>{expense.notes}</small> : null}{expense.cancellation_reason ? <small>Anulación: {expense.cancellation_reason}</small> : null}</td><td data-label="Categoría">{expense.expense_categories?.name ?? "Sin categoría"}</td><td data-label="Pago"><div className="expense-payment-detail">{payments.length > 1 ? <><strong>Pago combinado</strong>{payments.map((payment) => <small key={payment.payment_method_id}>{methodNames.get(payment.payment_method_id) ?? "Medio histórico"}: {ars.format(payment.amount)}</small>)}</> : expense.payment_methods?.name ?? "Sin indicar"}</div></td><td data-label="Realizado por">{expense.created_by ? names.get(expense.created_by) ?? (role === "staff" ? "Otro usuario" : "Usuario histórico") : "Sistema/importado"}</td><td data-label="Importe"><strong>{ars.format(Number(expense.amount))}</strong></td><td data-label="Estado"><span className={`table-status ${expense.status === "cancelled" ? "table-status-alert" : "table-status-ok"}`}>{expense.status === "cancelled" ? "Anulado" : "Vigente"}</span></td><td className="table-actions" data-label="">{role !== "staff" && expense.status === "posted" ? <><details className="row-editor"><summary className="icon-button" title="Corregir gasto"><Pencil size={16} /></summary><div className="row-editor-panel"><ExpenseForm key={expense.updated_at} categories={categoryOptions} closedThrough={closedThrough} paymentMethods={paymentMethods} values={expense} onSaved={onSaved} /></div></details><details className="row-menu"><summary className="icon-button icon-button-danger" title="Anular gasto"><Ban size={16} /></summary><CancelExpenseForm id={expense.id} onSaved={onSaved} /></details></> : null}</td></tr>;
      })}
      {expenses.length === 0 ? <tr><td className="table-empty-cell" colSpan={8}><Receipt size={22} /> No hay gastos en este período.</td></tr> : null}
    </tbody></table></div>
  </div>;
}
