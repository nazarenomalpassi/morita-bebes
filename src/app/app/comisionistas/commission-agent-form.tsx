"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import { saveCommissionAgentAction } from "@/app/app/comisionistas/actions";
import type { ActionState } from "@/lib/actions/form-state";

type CommissionAgentValues = {
  id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  route_description?: string;
  notes?: string | null;
};

export function CommissionAgentForm({ values = {} }: { values?: CommissionAgentValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveCommissionAgentAction,
    {},
  );

  return (
    <form action={action} className="entity-form">
      <input name="id" type="hidden" value={values.id ?? ""} />
      <div className="form-grid">
        <label className="field-label">
          Nombre
          <input className="field-input" defaultValue={values.first_name} maxLength={80} name="first_name" required />
        </label>
        <label className="field-label">
          Apellido
          <input className="field-input" defaultValue={values.last_name} maxLength={80} name="last_name" required />
        </label>
        <label className="field-label form-span-2">
          Teléfono
          <input className="field-input" defaultValue={values.phone} inputMode="tel" maxLength={40} name="phone" required type="tel" />
        </label>
        <label className="field-label form-span-2">
          Zona / recorrido
          <textarea className="field-textarea" defaultValue={values.route_description} maxLength={500} name="route_description" placeholder="Ej. Córdoba Capital - Río Tercero" required rows={3} />
        </label>
        <label className="field-label form-span-2">
          Notas
          <textarea className="field-textarea" defaultValue={values.notes ?? ""} maxLength={1000} name="notes" rows={2} />
        </label>
      </div>
      {(state.error || state.message) ? (
        <p aria-live="polite" className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>
      ) : null}
      <button className="button button-primary" disabled={pending} type="submit">
        <Save size={17} /> {pending ? "Guardando..." : "Guardar comisionista"}
      </button>
    </form>
  );
}
