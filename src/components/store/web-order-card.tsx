"use client";

import { Box, CheckCircle2, Clock3, ExternalLink, MessageCircle, ShoppingBag, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { transitionWebOrderAction } from "@/app/app/tienda/actions";
import { ConfirmWebOrderControl } from "@/components/store/confirm-web-order-control";
import { ars, dateTime, quantity } from "@/lib/format";
import type { Database } from "@/types/database";

type Order = Database["public"]["Tables"]["web_orders"]["Row"];
type Item = Database["public"]["Tables"]["web_order_items"]["Row"];
type Method = Pick<Database["public"]["Tables"]["payment_methods"]["Row"], "id" | "code" | "name" | "is_active" | "debit_surcharge_percent" | "credit_surcharge_percent">;
type Status = Order["status"];
const labels: Record<Status, string> = {
  pending: "Pendiente", contacted: "Contactado", confirmed: "Venta confirmada", preparing: "Preparando",
  ready: "Listo", completed: "Entregado", cancelled: "Cancelado",
};
const nextStates: Partial<Record<Status, Array<{ status: Status; label: string }>>> = {
  pending: [{ status: "contacted", label: "Marcar contactado" }, { status: "cancelled", label: "Cancelar" }],
  contacted: [{ status: "cancelled", label: "Cancelar" }],
  confirmed: [{ status: "preparing", label: "Pasar a preparación" }, { status: "cancelled", label: "Cancelar venta y reponer" }],
  preparing: [{ status: "ready", label: "Marcar listo" }, { status: "cancelled", label: "Cancelar venta y reponer" }],
  ready: [{ status: "completed", label: "Marcar entregado" }, { status: "cancelled", label: "Cancelar venta y reponer" }],
};

export function WebOrderCard({ order, paymentMethods }: { order: Order & { web_order_items: Item[] }; paymentMethods: Method[] }) {
  const [updatedOrder, setUpdatedOrder] = useState<Order | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Use the confirmed database snapshot immediately; accept newer server data
  // without letting a stale route refresh undo the visible confirmation.
  const current = updatedOrder && Date.parse(updatedOrder.updated_at) >= Date.parse(order.updated_at) ? updatedOrder : order;
  const method = paymentMethods.find((item) => item.id === current.payment_method_id);
  const paymentLabel = method ? `${method.name}${current.payment_card_type === "debit" ? " de débito" : current.payment_card_type === "credit" ? " de crédito" : ""}` : null;
  const chargedTotal = Number(current.total) + Number(current.payment_surcharge_amount ?? 0);
  const canConfirm = current.status === "pending" || current.status === "contacted";

  async function transition(status: Status) {
    if (pending) return;
    if (status === "cancelled" && !window.confirm(current.sale_id ? "Anular la venta y reponer su stock?" : "Cancelar este pedido?")) return;
    setPending(true);
    setError("");
    const formData = new FormData();
    formData.set("order_id", current.id);
    formData.set("status", status);
    try { setUpdatedOrder(await transitionWebOrderAction(formData)); }
    catch { setError("No pudimos confirmar el cambio de estado. Volve a abrir el pedido para verificarlo antes de reintentar."); }
    finally { setPending(false); }
  }

  return (
    <details className="web-order-admin-card">
      <summary>
        <span className="summary-strip-icon"><ShoppingBag aria-hidden="true" /></span>
        <div><strong>{current.order_number}</strong><small>{current.customer_name} · {current.customer_type === "wholesale" ? "Mayorista" : "Minorista"}</small></div>
        <span className={`web-order-admin-status status-${current.status}`}>{labels[current.status]}</span>
        <strong>{ars.format(Number(current.total))}</strong><small>{dateTime.format(new Date(current.created_at))}</small>
      </summary>
      <div className="web-order-admin-detail">
        <div className="web-order-customer">
          <span><strong>Cliente</strong>{current.customer_name}</span>
          <span><strong>Teléfono</strong><a href={`tel:${current.customer_phone}`}>{current.customer_phone}</a></span>
          <span><strong>Ubicación</strong>{current.customer_locality}, {current.customer_province}</span>
          {current.customer_business_name ? <span><strong>Comercio</strong>{current.customer_business_name}</span> : null}
        </div>
        <div className="web-order-items">
          {order.web_order_items.map((item) => (
            <div key={item.id}>
              <span><Box aria-hidden="true" /><span>{item.product_name}<small>{quantity.format(Number(item.quantity))} × {ars.format(Number(item.unit_price))}</small></span></span>
              <strong>{ars.format(Number(item.line_total))}</strong>
            </div>
          ))}
        </div>
        {current.notes ? <p className="web-order-note"><strong>Nota del cliente:</strong> {current.notes}</p> : null}
        {current.sale_id ? (
          <div className="web-order-sale-summary">
            <span><strong>Venta registrada</strong>{paymentLabel ?? "Medio de pago registrado"}</span>
            <span><strong>Total cobrado</strong>{ars.format(chargedTotal)}</span>
            <Link className="button button-secondary" href={`/app/ventas/${current.sale_id}/comprobante`} prefetch={false}><ExternalLink aria-hidden="true" /> Ver comprobante</Link>
          </div>
        ) : <p className="web-order-stock-note"><strong>Stock sin afectar.</strong> Este pedido todavía no fue confirmado como venta.</p>}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="web-order-admin-actions">
          <a className="button button-secondary" href={`https://wa.me/${current.customer_phone.replace(/\D/g, "")}`} rel="noreferrer" target="_blank"><MessageCircle aria-hidden="true" /> WhatsApp</a>
          {canConfirm && !pending ? <ConfirmWebOrderControl orderId={current.id} orderNumber={current.order_number} paymentMethods={paymentMethods.filter((item) => item.is_active)} total={Number(current.total)} onConfirmed={setUpdatedOrder} /> : null}
          {nextStates[current.status]?.map((next) => (
            <button className={`button ${next.status === "completed" ? "button-primary" : next.status === "cancelled" ? "button-danger" : "button-secondary"}`} disabled={pending} key={next.status} onClick={() => void transition(next.status)} type="button">
              {next.status === "cancelled" ? <XCircle aria-hidden="true" /> : next.status === "completed" ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}{pending ? "Guardando..." : next.label}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}
