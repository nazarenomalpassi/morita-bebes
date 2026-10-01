import { ShoppingBag } from "lucide-react";
import { WebOrderCard } from "@/components/store/web-order-card";
import { getCurrentOrganization } from "@/lib/data/current-organization";
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

  const requested = (await searchParams).estado;
  const selected = requested && ["open", "all", ...Object.keys(labels)].includes(requested) ? requested : "open";
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
        {orders?.length ? orders.map((order) => (
          <WebOrderCard key={order.id} order={order} paymentMethods={paymentMethods ?? []} />
        )) : (
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
