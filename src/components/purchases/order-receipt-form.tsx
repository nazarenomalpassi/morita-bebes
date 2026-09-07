"use client";

import { Check, LoaderCircle, PackageCheck } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import {
  receivePurchaseOrderAction,
  type PurchaseActionState,
} from "@/app/app/compras/actions";
import { ars, quantity } from "@/lib/format";

import type { PurchaseOrder } from "./purchase-types";

const initialState: PurchaseActionState = {};

function OrderReceiptEditor({
  order,
  state,
  formAction,
  pending,
}: {
  order: PurchaseOrder;
  state: PurchaseActionState;
  formAction: (payload: FormData) => void;
  pending: boolean;
}) {
  const [received, setReceived] = useState<Record<string, number>>({});
  const [costs, setCosts] = useState<Record<string, number>>(() =>
    Object.fromEntries(order.items.map((item) => [item.id, item.unitCost])),
  );

  const receiptItems = useMemo(
    () =>
      order.items.map((item) => ({
        purchase_order_item_id: item.id,
        quantity: Math.max(0, received[item.id] ?? 0),
        unit_cost: Math.max(0, costs[item.id] ?? item.unitCost),
      })),
    [costs, order.items, received],
  );
  const units = receiptItems.reduce((sum, item) => sum + item.quantity, 0);
  const total = receiptItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_cost,
    0,
  );

  return (
    <form action={formAction} className="mt-5 border-t border-[var(--line)] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="eyebrow">Ingreso de mercadería</span>
          <h3 className="mt-1 text-base font-bold">Registrar recepción</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ink-muted)]">
            Cargá solo lo que llegó. La orden quedará parcial hasta completar todas las cantidades.
          </p>
        </div>
        <span className="tag">{quantity.format(units)} unidades</span>
      </div>

      <div className="data-table-wrap mt-4" data-mobile-cards>
        <table className="data-table min-w-[44rem]">
          <thead className="bg-[#f4f2f6] text-left text-[0.7rem] uppercase text-[var(--ink-muted)]">
            <tr>
              <th className="px-3 py-2.5">Producto</th>
              <th className="px-3 py-2.5">Pendiente</th>
              <th className="px-3 py-2.5">Recibir ahora</th>
              <th className="px-3 py-2.5">Costo unitario</th>
              <th className="px-3 py-2.5 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => {
              const remaining = Math.max(
                0,
                item.quantityOrdered - item.quantityReceived,
              );
              const currentQuantity = received[item.id] ?? 0;
              const currentCost = costs[item.id] ?? item.unitCost;
              return (
                <tr className="border-t border-[var(--line)]" key={item.id}>
                  <td data-label="Producto">
                    <strong className="block">{item.productName}</strong>
                    <small className="mt-0.5 block text-[var(--ink-muted)]">{item.sku}</small>
                  </td>
                  <td className="font-semibold" data-label="Pendiente">
                    {quantity.format(remaining)} {item.unit}
                  </td>
                  <td data-label="Recibir ahora">
                    <label>
                      <span className="sr-only">Cantidad recibida de {item.productName}</span>
                      <input
                        className="field-input w-28"
                        disabled={remaining === 0}
                        inputMode="decimal"
                        max={remaining}
                        min="0"
                        onChange={(event) =>
                          setReceived((current) => ({
                            ...current,
                            [item.id]: Math.min(
                              remaining,
                              Math.max(0, Number(event.target.value)),
                            ),
                          }))
                        }
                        step="0.001"
                        type="number"
                        value={currentQuantity}
                      />
                    </label>
                  </td>
                  <td data-label="Costo unitario">
                    <label>
                      <span className="sr-only">Costo unitario de {item.productName}</span>
                      <input
                        className="field-input w-36"
                        inputMode="decimal"
                        min="0"
                        onChange={(event) =>
                          setCosts((current) => ({
                            ...current,
                            [item.id]: Math.max(0, Number(event.target.value)),
                          }))
                        }
                        step="0.01"
                        type="number"
                        value={currentCost}
                      />
                    </label>
                  </td>
                  <td className="text-right font-bold" data-label="Subtotal">
                    {ars.format(currentQuantity * currentCost)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <input name="purchase_order_id" type="hidden" value={order.id} />
      <input name="items" type="hidden" value={JSON.stringify(receiptItems)} />

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(14rem,1fr)_auto] md:items-end">
        <label className="field-label">
          Observación de la recepción
          <input
            className="field-input mt-1"
            maxLength={500}
            name="notes"
            placeholder="Ej.: faltaron dos bultos"
          />
        </label>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-[var(--ink-muted)]">
            Total recibido <strong className="text-[var(--ink)]">{ars.format(total)}</strong>
          </span>
          <button
            className="button button-primary gap-2"
            disabled={pending || units <= 0}
            type="submit"
          >
            {pending ? <LoaderCircle className="animate-spin" size={17} /> : <PackageCheck size={17} />}
            {pending ? "Registrando..." : "Confirmar ingreso"}
          </button>
        </div>
      </div>

      {(state.error || state.message) && (
        <p
          aria-live="polite"
          className={`mt-3 ${state.error ? "form-error" : "form-success"}`}
        >
          {state.error ? state.error : <><Check className="mr-1 inline" size={15} />{state.message}</>}
        </p>
      )}
    </form>
  );
}

export function OrderReceiptForm({ order }: { order: PurchaseOrder }) {
  const [state, formAction, pending] = useActionState(
    receivePurchaseOrderAction,
    initialState,
  );

  return (
    <OrderReceiptEditor
      formAction={formAction}
      key={state.receiptId ?? order.id}
      order={order}
      pending={pending}
      state={state}
    />
  );
}
