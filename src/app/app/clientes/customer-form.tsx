"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import { saveCustomerAction } from "@/app/app/clientes/actions";
import type { ActionState } from "@/lib/actions/form-state";

type CustomerValues = {
  id?: string;
  name?: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  is_wholesale?: boolean;
};

export function CustomerForm({ values = {} }: { values?: CustomerValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveCustomerAction,
    {},
  );

  return (
    <form action={action} className="entity-form">
      <input name="id" type="hidden" value={values.id ?? ""} />
      <div className="form-grid">
        <label className="field-label form-span-2">
          Nombre y apellido o razón social
          <input className="field-input" defaultValue={values.name} maxLength={160} name="name" required />
        </label>
        <label className="field-label">
          Teléfono
          <input className="field-input" defaultValue={values.phone ?? ""} maxLength={60} name="phone" type="tel" />
        </label>
        <label className="field-label">
          WhatsApp
          <input className="field-input" defaultValue={values.whatsapp ?? ""} maxLength={60} name="whatsapp" type="tel" />
        </label>
        <label className="field-label">
          Correo
          <input className="field-input" defaultValue={values.email ?? ""} maxLength={160} name="email" type="email" />
        </label>
        <label className="field-label">
          Dirección
          <input className="field-input" defaultValue={values.address ?? ""} maxLength={240} name="address" />
        </label>
        <label className="field-label form-span-2">
          Notas
          <textarea className="field-textarea" defaultValue={values.notes ?? ""} maxLength={1000} name="notes" rows={2} />
        </label>
      </div>
      <label className="check-field">
        <input defaultChecked={values.is_wholesale} name="is_wholesale" type="checkbox" />
        Cliente mayorista
      </label>
      {(state.error || state.message) && (
        <p aria-live="polite" className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>
      )}
      <button className="button button-primary" disabled={pending} type="submit">
        <Save size={17} /> {pending ? "Guardando..." : "Guardar cliente"}
      </button>
    </form>
  );
}

