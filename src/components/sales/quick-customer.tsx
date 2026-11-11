"use client";

import { Plus, Save, X } from "lucide-react";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { saveCustomerAction } from "@/app/app/clientes/actions";

const subscribe = () => () => {};
export function QuickCustomer({ onCreated }: { onCreated: (customer: { id: string; name: string }) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return <><button aria-label="Crear cliente sin salir de la venta" className="button button-ghost" onClick={() => { setError(""); dialog.current?.showModal(); }} type="button"><Plus size={15} aria-hidden="true" /> Nuevo cliente</button>{mounted ? createPortal(<dialog aria-labelledby="quick-customer-title" className="product-price-dialog" onCancel={(event) => { if (pending) event.preventDefault(); }} ref={dialog}>
    <div className="product-price-dialog-heading"><h2 id="quick-customer-title">Nuevo cliente</h2><button aria-label="Cerrar cliente" className="icon-button" disabled={pending} onClick={() => dialog.current?.close()} type="button"><X size={18} /></button></div>
    <form className="entity-form" onSubmit={(event) => {
      event.preventDefault(); event.stopPropagation();
      const data = new FormData(event.currentTarget);
      start(async () => {
        try {
          const result = await saveCustomerAction({}, data);
          if (result.customer && !result.error) { onCreated(result.customer); dialog.current?.close(); }
          else setError(result.error ?? "No se pudo crear el cliente.");
        } catch { setError("No se pudo confirmar el guardado. Revisá si el cliente ya se creó antes de reintentar."); }
      });
    }}><fieldset className="form-grid" disabled={pending}><label className="field-label form-span-2">Nombre y apellido o razón social<input autoFocus className="field-input" maxLength={160} minLength={2} name="name" required /></label><label className="field-label">Teléfono<input className="field-input" maxLength={60} name="phone" type="tel" /></label><label className="field-label">Correo<input className="field-input" maxLength={254} name="email" type="email" /></label></fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="product-price-dialog-actions"><button className="button button-secondary" disabled={pending} onClick={() => dialog.current?.close()} type="button">Cancelar</button><button className="button button-primary" disabled={pending} type="submit"><Save size={16} /> {pending ? "Guardando..." : "Guardar y seleccionar"}</button></div></form>
  </dialog>, document.body) : null}</>;
}
