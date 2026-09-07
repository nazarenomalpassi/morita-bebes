"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import type { InventoryActionState } from "./action-state";
import { initialInventoryActionState } from "./action-state";
import { ActionFeedback, FieldError } from "./action-feedback";
import { SubmitButton } from "./submit-button";

export type SupplierFormValue = {
  address: string | null;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  notes: string | null;
  phone: string | null;
  whatsapp: string | null;
};

type SupplierAction = (
  state: InventoryActionState,
  formData: FormData,
) => Promise<InventoryActionState>;

function FormField({
  children,
  label,
  name,
  state,
}: {
  children: React.ReactNode;
  label: string;
  name: string;
  state: InventoryActionState;
}) {
  return <label className="block"><span className="field-label mb-1.5">{label}</span>{children}<FieldError name={name} state={state} /></label>;
}

export function SupplierForm({
  action,
  supplier,
}: {
  action: SupplierAction;
  supplier?: SupplierFormValue;
}) {
  const [state, formAction] = useActionState(action, initialInventoryActionState);
  const editing = Boolean(supplier);
  return (
    <form action={formAction} className="mt-8 space-y-8">
      <ActionFeedback state={state} />
      <section>
        <div className="border-b border-[var(--line)] pb-3">
          <h2 className="text-base font-bold">Identificación</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Solo la razón social es obligatoria. El resto puede completarse cuando el dueño tenga los datos.</p>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FormField label="Razón social / nombre *" name="business_name" state={state}>
            <input className="field-input" defaultValue={supplier?.business_name} maxLength={160} name="business_name" required />
          </FormField>
          <FormField label="Persona de contacto" name="contact_name" state={state}>
            <input className="field-input" defaultValue={supplier?.contact_name ?? ""} maxLength={160} name="contact_name" />
          </FormField>
        </div>
      </section>
      <section>
        <div className="border-b border-[var(--line)] pb-3"><h2 className="text-base font-bold">Contacto</h2></div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FormField label="WhatsApp" name="whatsapp" state={state}>
            <input className="field-input" defaultValue={supplier?.whatsapp ?? ""} inputMode="tel" maxLength={50} name="whatsapp" placeholder="Ej.: +54 9 11 1234 5678" />
          </FormField>
          <FormField label="Teléfono" name="phone" state={state}>
            <input className="field-input" defaultValue={supplier?.phone ?? ""} inputMode="tel" maxLength={50} name="phone" />
          </FormField>
          <FormField label="Correo electrónico" name="email" state={state}>
            <input className="field-input" defaultValue={supplier?.email ?? ""} maxLength={254} name="email" type="email" />
          </FormField>
          <FormField label="Dirección" name="address" state={state}>
            <input className="field-input" defaultValue={supplier?.address ?? ""} maxLength={500} name="address" />
          </FormField>
        </div>
      </section>
      <section>
        <div className="border-b border-[var(--line)] pb-3"><h2 className="text-base font-bold">Notas comerciales</h2></div>
        <label className="mt-4 block"><span className="field-label mb-1.5">Condiciones, días de reparto o referencias</span><textarea className="field-textarea min-h-32" defaultValue={supplier?.notes ?? ""} maxLength={2000} name="notes" /></label>
      </section>
      <div className="flex justify-end border-t border-[var(--line)] pt-5">
        <SubmitButton pendingLabel={editing ? "Actualizando..." : "Creando proveedor..."}><Save size={17} /> {editing ? "Guardar cambios" : "Crear proveedor"}</SubmitButton>
      </div>
    </form>
  );
}
