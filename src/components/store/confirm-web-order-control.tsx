"use client";

import { CheckCircle2, CreditCard, ShieldCheck } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import {
  confirmWebOrderSaleAction,
  type ConfirmWebOrderState,
} from "@/app/app/tienda/actions";

type PaymentMethod = {
  id: string;
  code: string;
  name: string;
  debit_surcharge_percent: number;
  credit_surcharge_percent: number;
};

const initialState: ConfirmWebOrderState = {};
const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

export function ConfirmWebOrderControl({
  orderId,
  orderNumber,
  paymentMethods,
  total,
}: {
  orderId: string;
  orderNumber: string;
  paymentMethods: PaymentMethod[];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [cardType, setCardType] = useState<"debit" | "credit" | "">("");
  const [state, action, pending] = useActionState(confirmWebOrderSaleAction, initialState);
  const selectedMethod = useMemo(
    () => paymentMethods.find((method) => method.id === paymentMethodId),
    [paymentMethodId, paymentMethods],
  );
  const cardPercentage = selectedMethod?.code === "card"
    ? cardType === "debit"
      ? Number(selectedMethod.debit_surcharge_percent)
      : cardType === "credit"
        ? Number(selectedMethod.credit_surcharge_percent)
        : 0
    : 0;
  const surcharge = Math.round(total * cardPercentage) / 100;
  const chargeTotal = total + surcharge;
  const valid = Boolean(selectedMethod) && (selectedMethod?.code !== "card" || Boolean(cardType));

  return (
    <>
      <button className="button button-primary" onClick={() => setOpen(true)} type="button">
        <CheckCircle2 aria-hidden="true" /> Confirmar venta y cobrar
      </button>
      {open ? (
        <div className="sale-dialog-backdrop" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !pending) setOpen(false);
        }}>
          <section
            aria-labelledby={`confirm-web-order-${orderId}`}
            aria-modal="true"
            className="sale-confirmation-dialog web-order-payment-dialog"
            role="dialog"
          >
            <div className="sale-confirmation-icon"><ShieldCheck aria-hidden="true" size={22} /></div>
            <p className="eyebrow">Pedido {orderNumber}</p>
            <h2 id={`confirm-web-order-${orderId}`}>Confirmar venta y cobro</h2>
            <p>Recién al confirmar se descontará el stock y se registrará el ingreso en caja.</p>

            <form action={action} className="web-order-payment-form">
              <input name="order_id" type="hidden" value={orderId} />
              <label className="field-label">
                Medio de pago
                <select
                  name="payment_method_id"
                  onChange={(event) => {
                    setPaymentMethodId(event.target.value);
                    setCardType("");
                  }}
                  required
                  value={paymentMethodId}
                >
                  <option value="">Seleccionar</option>
                  {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                </select>
              </label>

              {selectedMethod?.code === "card" ? (
                <fieldset className="web-order-card-type">
                  <legend>Tipo de tarjeta</legend>
                  <label><input checked={cardType === "debit"} name="card_type" onChange={() => setCardType("debit")} type="radio" value="debit" /> Débito</label>
                  <label><input checked={cardType === "credit"} name="card_type" onChange={() => setCardType("credit")} type="radio" value="credit" /> Crédito</label>
                </fieldset>
              ) : <input name="card_type" type="hidden" value="" />}

              <dl className="sale-confirmation-summary">
                <div><dt>Pedido</dt><dd>{ars.format(total)}</dd></div>
                {surcharge > 0 ? <div><dt>Recargo de tarjeta ({cardPercentage}%)</dt><dd>{ars.format(surcharge)}</dd></div> : null}
                <div className="sale-confirmation-total"><dt>Total a cobrar</dt><dd>{ars.format(chargeTotal)}</dd></div>
              </dl>

              {selectedMethod?.code === "card" ? (
                <p className="web-order-payment-note"><CreditCard aria-hidden="true" /> El recargo indica cuánto cargar en el posnet; la caja registra el valor real de los productos.</p>
              ) : null}
              {state.error ? <p className="form-message error" role="alert">{state.error}</p> : null}
              {state.message ? <p className="form-message success" role="status">{state.message}</p> : null}

              <div className="sale-confirmation-actions">
                <button className="button button-secondary" disabled={pending} onClick={() => setOpen(false)} type="button">Volver</button>
                <button className="button button-primary" disabled={!valid || pending} type="submit">
                  {pending ? "Registrando..." : "Confirmar venta"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
