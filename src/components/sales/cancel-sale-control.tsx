"use client";

import { Ban, RotateCcw, X } from "lucide-react";
import { useActionState, useState } from "react";

import {
  cancelSaleAction,
  type CancelSaleActionState,
} from "@/app/app/ventas/actions";

const initialState: CancelSaleActionState = {};

export function CancelSaleControl({ saleId, compact = false }: {
  saleId: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(cancelSaleAction, initialState);

  return (
    <>
      <button
        aria-label="Anular venta"
        className={compact ? "icon-button icon-button-danger" : "button button-danger"}
        onClick={() => setOpen(true)}
        title="Anular venta"
        type="button"
      >
        <Ban aria-hidden="true" size={compact ? 16 : 17} />
        {compact ? null : "Anular venta"}
      </button>

      {open ? (
        <div className="sale-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !pending) setOpen(false);
        }}>
          <section aria-labelledby={`cancel-sale-${saleId}`} aria-modal="true" className="sale-confirmation-dialog sale-cancellation-dialog" role="dialog">
            <div className="sale-confirmation-icon sale-cancellation-icon"><RotateCcw aria-hidden="true" size={22} /></div>
            <button aria-label="Cerrar" className="sale-dialog-close" disabled={pending} onClick={() => setOpen(false)} type="button"><X size={18} /></button>
            <div>
              <p className="eyebrow">Acción auditada</p>
              <h2 id={`cancel-sale-${saleId}`}>¿Anular esta venta?</h2>
              <p>Se devolverá el stock y se registrará la reversión financiera en el período actual. La venta seguirá visible como anulada.</p>
            </div>
            <form action={action} className="sale-cancellation-form">
              <input name="sale_id" type="hidden" value={saleId} />
              <label className="field-label">
                Motivo de anulación
                <textarea
                  autoFocus
                  className="field-textarea"
                  maxLength={500}
                  minLength={3}
                  name="reason"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ej. Venta confirmada accidentalmente"
                  required
                  rows={3}
                  value={reason}
                />
              </label>
              {state.error ? <p aria-live="polite" className="form-error">{state.error}</p> : null}
              <div className="sale-confirmation-actions">
                <button className="button button-secondary" disabled={pending} onClick={() => setOpen(false)} type="button">Volver</button>
                <button className="button button-danger" disabled={pending || reason.trim().length < 3} type="submit">{pending ? "Anulando..." : "Anular y revertir"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
