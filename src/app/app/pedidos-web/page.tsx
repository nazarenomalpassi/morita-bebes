import {
  Box,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MessageCircle,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import { transitionWebOrderAction } from "@/app/app/tienda/actions";
import { ConfirmWebOrderControl } from "@/components/store/confirm-web-order-control";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { ars, dateTime, quantity } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const labels: Record<string, string> = {
  pending: "Pendiente",
  contacted: "Contactado",
  confirmed: "Venta confirmada",
  preparing: "Preparando",
  ready: "Listo",
  completed: "Entregado",
  cancelled: "Cancelado",
};

const nextStates: Record<string, Array<{ status: string; label: string }>> = {
  pending: [
    { status: "contacted", label: "Marcar contactado" },
    { status: "cancelled", label: "Cancelar" },
  ],
  contacted: [{ status: "cancelled", label: "Cancelar" }],
  confirmed: [
    { status: "preparing", label: "Pasar a preparación" },
    { status: "cancelled", label: "Cancelar venta y reponer" },
  ],
  preparing: [
    { status: "ready", label: "Marcar listo" },
    { status: "cancelled", label: "Cancelar venta y reponer" },
  ],
  ready: [
    { status: "completed", label: "Marcar entregado" },
    { status: "cancelled", label: "Cancelar venta y reponer" },
  ],
};

export default async function WebOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  if (organization.role === "staff") {
    return (
      <div className="page-container permission-state">
        <ShoppingBag />
        <h1>Acceso restringido</h1>
        <p>Los pedidos web están disponibles para dueños y administradores.</p>
      </div>
    );
  }

  const selected = (await searchParams).estado ?? "open";
  let orderQuery = supabase
    .from("web_orders")
    .select("*, web_order_items(*)")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(100);
  orderQuery = selected === "open"
    ? orderQuery.in("status", ["pending", "contacted", "confirmed", "preparing", "ready"])
    : selected === "all"
      ? orderQuery
      : orderQuery.eq("status", selected as never);

  const [{ data: orders, error }, { data: paymentMethods, error: paymentMethodsError }] = await Promise.all([
    orderQuery,
    supabase
      .from("payment_methods")
      .select("id, code, name, is_active, sort_order, debit_surcharge_percent, credit_surcharge_percent")
      .eq("organization_id", organization.id)
      .in("code", ["cash", "transfer", "card"])
      .order("sort_order"),
  ]);
  if (error) throw new Error("No se pudieron cargar los pedidos web.");
  if (paymentMethodsError) throw new Error("No se pudieron cargar los medios de pago.");

  const activePaymentMethods = (paymentMethods ?? []).filter((method) => method.is_active);
  const paymentMethodsById = new Map((paymentMethods ?? []).map((method) => [method.id, method]));

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <span className="eyebrow">E-commerce</span>
          <h1 className="page-title mt-2">Pedidos web</h1>
          <p className="page-lead">El pedido no afecta el inventario. Stock y caja se actualizan juntos recién cuando confirmás la venta y su medio de pago.</p>
        </div>
        <a className="button button-secondary" href="/tienda" rel="noreferrer" target="_blank">Abrir tienda</a>
      </header>

      <nav className="store-admin-tabs">
        <a className={selected === "open" ? "is-active" : ""} href="/app/pedidos-web?estado=open">Abiertos</a>
        <a className={selected === "completed" ? "is-active" : ""} href="/app/pedidos-web?estado=completed">Entregados</a>
        <a className={selected === "cancelled" ? "is-active" : ""} href="/app/pedidos-web?estado=cancelled">Cancelados</a>
        <a className={selected === "all" ? "is-active" : ""} href="/app/pedidos-web?estado=all">Todos</a>
      </nav>

      <section className="web-order-admin-list">
        {orders?.length ? orders.map((order) => {
          const paymentMethod = order.payment_method_id
            ? paymentMethodsById.get(order.payment_method_id)
            : null;
          const paymentLabel = paymentMethod
            ? `${paymentMethod.name}${order.payment_card_type === "debit" ? " de débito" : order.payment_card_type === "credit" ? " de crédito" : ""}`
            : null;
          const surcharge = Number(order.payment_surcharge_amount ?? 0);
          const chargedTotal = Number(order.total) + surcharge;
          const canConfirm = order.status === "pending" || order.status === "contacted";

          return (
            <details className="web-order-admin-card" key={order.id}>
              <summary>
                <span className="summary-strip-icon"><ShoppingBag /></span>
                <div>
                  <strong>{order.order_number}</strong>
                  <small>{order.customer_name} · {order.customer_type === "wholesale" ? "Mayorista" : "Minorista"}</small>
                </div>
                <span className={`web-order-admin-status status-${order.status}`}>{labels[order.status]}</span>
                <strong>{ars.format(Number(order.total))}</strong>
                <small>{dateTime.format(new Date(order.created_at))}</small>
              </summary>

              <div className="web-order-admin-detail">
                <div className="web-order-customer">
                  <span><strong>Cliente</strong>{order.customer_name}</span>
                  <span><strong>Teléfono</strong><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></span>
                  <span><strong>Ubicación</strong>{order.customer_locality}, {order.customer_province}</span>
                  {order.customer_business_name ? <span><strong>Comercio</strong>{order.customer_business_name}</span> : null}
                </div>

                <div className="web-order-items">
                  {order.web_order_items.map((item) => (
                    <div key={item.id}>
                      <span><Box /> <span>{item.product_name}<small>{quantity.format(Number(item.quantity))} × {ars.format(Number(item.unit_price))}</small></span></span>
                      <strong>{ars.format(Number(item.line_total))}</strong>
                    </div>
                  ))}
                </div>

                {order.notes ? <p className="web-order-note"><strong>Nota del cliente:</strong> {order.notes}</p> : null}
                {order.sale_id ? (
                  <div className="web-order-sale-summary">
                    <span><strong>Venta registrada</strong>{paymentLabel ?? "Medio de pago registrado"}</span>
                    <span><strong>Total cobrado</strong>{ars.format(chargedTotal)}</span>
                    <Link className="button button-secondary" href={`/app/ventas/${order.sale_id}/comprobante`}><ExternalLink /> Ver comprobante</Link>
                  </div>
                ) : (
                  <p className="web-order-stock-note"><strong>Stock sin afectar.</strong> Este pedido todavía no fue confirmado como venta.</p>
                )}

                <div className="web-order-admin-actions">
                  <a className="button button-secondary" href={`https://wa.me/${order.customer_phone.replace(/\D/g, "")}`} rel="noreferrer" target="_blank"><MessageCircle /> WhatsApp</a>
                  {canConfirm ? (
                    <ConfirmWebOrderControl
                      orderId={order.id}
                      orderNumber={order.order_number}
                      paymentMethods={activePaymentMethods}
                      total={Number(order.total)}
                    />
                  ) : null}
                  {nextStates[order.status]?.map((state) => (
                    <form action={transitionWebOrderAction} key={state.status}>
                      <input name="order_id" type="hidden" value={order.id} />
                      <input name="status" type="hidden" value={state.status} />
                      <button className={`button ${state.status === "completed" ? "button-primary" : state.status === "cancelled" ? "button-danger" : "button-secondary"}`} type="submit">
                        {state.status === "cancelled" ? <XCircle /> : state.status === "completed" ? <CheckCircle2 /> : <Clock3 />}
                        {state.label}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            </details>
          );
        }) : (
          <div className="empty-state">
            <ShoppingBag />
            <h2>No hay pedidos en esta vista</h2>
            <p>Los nuevos pedidos aparecerán acá sin descontar stock hasta que confirmes su venta.</p>
          </div>
        )}
      </section>
    </div>
  );
}
