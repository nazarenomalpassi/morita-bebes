"use client";

import { ArrowDownToLine } from "lucide-react";
import { useActionState } from "react";

import type { InventoryActionState } from "./action-state";
import { initialInventoryActionState } from "./action-state";
import { ActionFeedback, FieldError } from "./action-feedback";
import { SubmitButton } from "./submit-button";

type StockAction = (
  state: InventoryActionState,
  formData: FormData,
) => Promise<InventoryActionState>;

export function StockMovementForm({ action }: { action: StockAction }) {
  const [state, formAction] = useActionState(action, initialInventoryActionState);

  return (
    <form action={formAction} className="space-y-4">
      <ActionFeedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label mb-1.5">Movimiento *</span>
          <select className="field-input" defaultValue="entry" name="operation" required>
            <option value="entry">Entrada de mercadería</option>
            <option value="exit">Salida manual / pérdida</option>
            <option value="adjustment">Ajuste por diferencia</option>
          </select>
          <FieldError name="operation" state={state} />
        </label>
        <label className="block">
          <span className="field-label mb-1.5">Cantidad *</span>
          <input className="field-input" inputMode="decimal" name="quantity" required step="0.001" type="number" />
          <FieldError name="quantity" state={state} />
          <span className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">En un ajuste podés usar un valor positivo o negativo.</span>
        </label>
        <label className="block">
          <span className="field-label mb-1.5">Costo unitario</span>
          <input className="field-input" inputMode="decimal" min="0" name="unit_cost" step="0.01" type="number" />
          <FieldError name="unit_cost" state={state} />
        </label>
        <label className="block">
          <span className="field-label mb-1.5">Motivo / referencia</span>
          <input className="field-input" maxLength={500} name="notes" placeholder="Ej.: conteo de depósito" />
        </label>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Registrando...">
          <ArrowDownToLine size={17} /> Registrar movimiento
        </SubmitButton>
      </div>
    </form>
  );
}
