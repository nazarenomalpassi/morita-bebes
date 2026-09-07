"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import {
  createPayrollMovementAction,
  saveEmployeeAction,
} from "@/app/app/personal/actions";
import type { ActionState } from "@/lib/actions/form-state";

type EmployeeValues = {
  id?: string;
  first_name?: string;
  last_name?: string;
  document_number?: string | null;
  email?: string | null;
  phone?: string | null;
  hire_date?: string | null;
  user_id?: string | null;
  notes?: string | null;
};

type EmployeeOption = { id: string; name: string; baseSalary: number };
export type StaffAccountOption = { id: string; name: string };

function localToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

export function EmployeeForm({ values = {}, accounts = [] }: { values?: EmployeeValues; accounts?: StaffAccountOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveEmployeeAction, {});
  return (
    <form action={action} className="entity-form">
      <input name="id" type="hidden" value={values.id ?? ""} />
      <div className="form-grid">
        <label className="field-label">Nombre<input className="field-input" defaultValue={values.first_name} maxLength={100} name="first_name" required /></label>
        <label className="field-label">Apellido<input className="field-input" defaultValue={values.last_name} maxLength={100} name="last_name" required /></label>
        <label className="field-label">Documento<input className="field-input" defaultValue={values.document_number ?? ""} maxLength={30} name="document_number" /></label>
        <label className="field-label">Teléfono<input className="field-input" defaultValue={values.phone ?? ""} maxLength={60} name="phone" type="tel" /></label>
        <label className="field-label">Correo<input className="field-input" defaultValue={values.email ?? ""} maxLength={254} name="email" type="email" /></label>
        <label className="field-label">Fecha de ingreso<input className="field-input" defaultValue={values.hire_date ?? ""} name="hire_date" type="date" /></label>
        <label className="field-label form-span-2">Cuenta de acceso<select className="field-input" defaultValue={values.user_id ?? ""} name="user_id"><option value="">Sin cuenta vinculada</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label className="field-label form-span-2">Notas<textarea className="field-textarea" defaultValue={values.notes ?? ""} maxLength={1000} name="notes" rows={2} /></label>
      </div>
      {(state.error || state.message) && <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>}
      <button className="button button-primary" disabled={pending} type="submit"><Save size={17} /> {pending ? "Guardando..." : "Guardar empleado"}</button>
    </form>
  );
}

export function PayrollMovementForm({ employees, month }: { employees: EmployeeOption[]; month: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createPayrollMovementAction, {});
  return (
    <form action={action} className="entity-form">
      <div className="form-grid">
        <label className="field-label form-span-2">Empleado<select className="field-input" name="employee_id" required defaultValue=""><option disabled value="">Seleccionar</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
        <label className="field-label">Concepto<select className="field-input" name="kind" defaultValue="advance"><option value="advance">Adelanto</option><option value="bonus">Bono</option><option value="deduction">Descuento</option></select></label>
        <label className="field-label">Importe<input className="field-input" inputMode="decimal" min="0.01" name="amount" required step="0.01" type="number" /></label>
        <label className="field-label">Período<input className="field-input" defaultValue={month} name="period_month" required type="month" /></label>
        <label className="field-label">Fecha de pago<input className="field-input" defaultValue={localToday()} name="paid_at" type="date" /></label>
        <label className="field-label form-span-2">Nota<textarea className="field-textarea" maxLength={500} name="notes" rows={2} /></label>
      </div>
      {(state.error || state.message) && <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>}
      <button className="button button-primary" disabled={pending || employees.length === 0} type="submit"><Save size={17} /> {pending ? "Guardando..." : "Registrar movimiento"}</button>
    </form>
  );
}
