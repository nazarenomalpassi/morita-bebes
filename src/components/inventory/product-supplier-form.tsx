"use client";

import { Link2, Truck } from "lucide-react";
import { useActionState } from "react";

import type { InventoryActionState } from "./action-state";
import { initialInventoryActionState } from "./action-state";
import { ActionFeedback, FieldError } from "./action-feedback";
import { SubmitButton } from "./submit-button";

type SupplierOption = {
  business_name: string;
  id: string;
};

type ProductSupplierAction = (
  state: InventoryActionState,
  formData: FormData,
) => Promise<InventoryActionState>;

export function ProductSupplierForm({
  action,
  currentSupplierId,
  suppliers,
}: {
  action: ProductSupplierAction;
  currentSupplierId: string | null;
  suppliers: SupplierOption[];
}) {
  const [state, formAction] = useActionState(action, initialInventoryActionState);

  return (
    <div className="mt-4 rounded-[8px] border border-[var(--line)] bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-soft)] text-[var(--plum)]">
          <Truck aria-hidden="true" size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold">Proveedor principal</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            Se usa para agrupar este artículo en los pedidos de reposición.
          </p>
        </div>
      </div>

      <form action={formAction} className="mt-4 space-y-3">
        <label className="block min-w-0">
          <span className="field-label mb-1.5">Seleccionar proveedor</span>
          <select
            className="field-input"
            defaultValue={currentSupplierId ?? ""}
            name="default_supplier_id"
          >
            <option value="">Sin proveedor asignado</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.business_name}
              </option>
            ))}
          </select>
          <FieldError name="default_supplier_id" state={state} />
        </label>

        <SubmitButton className="w-full justify-center" pendingLabel="Guardando proveedor...">
          <Link2 aria-hidden="true" size={17} />
          Guardar proveedor
        </SubmitButton>

        <ActionFeedback state={state} />
      </form>
    </div>
  );
}
