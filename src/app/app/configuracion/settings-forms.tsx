"use client";

import { ArrowLeftRight, Banknote, CreditCard, Save } from "lucide-react";
import { useActionState } from "react";

import {
  savePaymentSurchargesAction,
  saveSettingsAction,
} from "@/app/app/configuracion/actions";
import type { ActionState } from "@/lib/actions/form-state";

type Settings = {
  organizationName: string;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  instagramUrl?: string | null;
};

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSettingsAction, {});
  return (
    <form action={action} className="entity-form">
      <div className="form-grid">
        <label className="field-label form-span-2">Nombre del comercio<input className="field-input" defaultValue={settings.organizationName} maxLength={80} name="organization_name" required /></label>
        <label className="field-label">WhatsApp<input className="field-input" defaultValue={settings.whatsapp ?? ""} maxLength={60} name="whatsapp" type="tel" /></label>
        <label className="field-label">Correo<input className="field-input" defaultValue={settings.email ?? ""} maxLength={254} name="email" type="email" /></label>
        <label className="field-label form-span-2">Dirección<input className="field-input" defaultValue={settings.address ?? ""} maxLength={240} name="address" /></label>
        <label className="field-label form-span-2">Instagram<input className="field-input" defaultValue={settings.instagramUrl ?? ""} maxLength={500} name="instagram_url" placeholder="https://instagram.com/..." type="url" /></label>
      </div>
      {(state.error || state.message) && <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>}
      <button className="button button-primary" disabled={pending} type="submit"><Save size={17} /> {pending ? "Guardando..." : "Guardar cambios"}</button>
    </form>
  );
}

export function PaymentMethodsForm({
  debitSurchargePercent,
  creditSurchargePercent,
}: {
  debitSurchargePercent: number;
  creditSurchargePercent: number;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePaymentSurchargesAction, {});

  return (
    <form action={action} className="payment-settings-form">
      <div className="fixed-payment-method-list">
        <div className="fixed-payment-method-row">
          <span className="payment-method-icon"><Banknote size={19} /></span>
          <div><strong>Efectivo</strong><small>Sin recargo</small></div>
          <span className="table-status table-status-ok">Activo</span>
        </div>
        <div className="fixed-payment-method-row">
          <span className="payment-method-icon"><ArrowLeftRight size={19} /></span>
          <div><strong>Transferencia</strong><small>Sin recargo</small></div>
          <span className="table-status table-status-ok">Activo</span>
        </div>
        <div className="fixed-payment-method-row payment-method-card-row">
          <span className="payment-method-icon"><CreditCard size={19} /></span>
          <div><strong>Tarjeta</strong><small>Débito o crédito</small></div>
          <span className="table-status table-status-ok">Activo</span>
        </div>
      </div>

      <fieldset className="card-surcharge-settings">
        <legend>Cálculo para Posnet</legend>
        <label className="field-label">
          Débito
          <span className="percentage-input">
            <input className="field-input" defaultValue={debitSurchargePercent} max="100" min="0" name="debit_surcharge_percent" required step="0.01" type="number" />
            <span>%</span>
          </span>
        </label>
        <label className="field-label">
          Crédito
          <span className="percentage-input">
            <input className="field-input" defaultValue={creditSurchargePercent} max="100" min="0" name="credit_surcharge_percent" required step="0.01" type="number" />
            <span>%</span>
          </span>
        </label>
      </fieldset>
      <p className="form-hint">El porcentaje aumenta únicamente el importe que se cobra en el Posnet. El saldo de Tarjeta registra el valor base de los productos.</p>

      {(state.error || state.message) && <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>}
      <button className="button button-primary" disabled={pending} type="submit"><Save size={17} /> {pending ? "Guardando..." : "Guardar recargos"}</button>
    </form>
  );
}
