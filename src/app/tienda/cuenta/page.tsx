import type { Metadata } from "next";
import { Building2, LogOut, PackageCheck, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requestWholesaleAccountAction, storeSignOutAction } from "@/app/tienda/actions";
import { StoreProfileForm } from "@/components/store/store-profile-form";
import { ars, dateTime, quantity } from "@/lib/format";
import { getStoreContext } from "@/lib/store/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false, follow: false } };

const statuses: Record<string, string> = {
  pending: "Pendiente", contacted: "Contactado", confirmed: "Confirmado", preparing: "Preparando",
  ready: "Listo", completed: "Entregado", cancelled: "Cancelado",
};
const wholesaleStatuses: Record<string, { label: string; copy: string }> = {
  not_requested: { label: "Cuenta minorista", copy: "Podés solicitar acceso mayorista sin crear otra cuenta." },
  pending: { label: "Mayorista pendiente", copy: "Morita revisará tu solicitud. Mientras tanto seguís viendo precios minoristas." },
  approved: { label: "Mayorista aprobada", copy: "Ya estás viendo precios mayoristas y mínimos por producto." },
  rejected: { label: "Solicitud no aprobada", copy: "Podés comunicarte con Morita para revisar los datos de tu comercio." },
  suspended: { label: "Acceso mayorista suspendido", copy: "Contactá a Morita para conocer el estado de tu cuenta." },
};

export default async function StoreAccountPage() {
  const context = await getStoreContext();
  if (!context.profile) {
    if (context.managementRole) redirect("/app/tienda");
    redirect("/tienda/ingresar?next=/tienda/cuenta");
  }
  const supabase = await createServerSupabaseClient();
  const { data: orders } = await supabase.from("web_orders").select("*, web_order_items(*)").eq("customer_user_id", context.profile.user_id).order("created_at", { ascending: false }).limit(30);
  const wholesale = wholesaleStatuses[context.profile.wholesale_status];
  return (
    <div className="store-page store-account-page">
      <header className="store-account-header">
        <div><span>Mi cuenta</span><h1>Hola, {context.profile.first_name}</h1><p>Administrá tus datos y seguí el estado de tus pedidos.</p></div>
        <form action={storeSignOutAction}><button className="store-text-button" type="submit"><LogOut /> Cerrar sesión</button></form>
      </header>
      <div className="store-account-grid">
        <aside className="store-account-side">
          <div className="store-account-avatar"><UserRound /></div><strong>{context.profile.first_name} {context.profile.last_name}</strong><span>{context.profile.email}</span>
          <div className={`store-wholesale-status status-${context.profile.wholesale_status}`}><Building2 /><div><strong>{wholesale.label}</strong><p>{wholesale.copy}</p></div></div>
          {context.profile.wholesale_status === "not_requested" || context.profile.wholesale_status === "rejected" ? <form action={requestWholesaleAccountAction}><button className="store-secondary-button" type="submit">Solicitar cuenta mayorista</button></form> : null}
          {context.profile.wholesale_status === "approved" ? <Link className="store-secondary-button" href="/tienda/productos">Ver catálogo mayorista</Link> : null}
        </aside>
        <section className="store-account-content">
          <details open><summary><UserRound /> Mis datos</summary><StoreProfileForm profile={context.profile} /></details>
          <details open><summary><PackageCheck /> Mis pedidos</summary><div className="store-order-list">
            {orders?.length ? orders.map((order) => <details className="store-order-card" key={order.id}>
              <summary><div><strong>{order.order_number}</strong><span>{dateTime.format(new Date(order.created_at))}</span></div><span className={`store-order-status status-${order.status}`}>{statuses[order.status] ?? order.status}</span><strong>{ars.format(Number(order.total))}</strong></summary>
              <div className="store-order-detail">
                {order.web_order_items.map((item) => <div key={item.id}><span>{item.product_name}<small>{quantity.format(Number(item.quantity))} × {ars.format(Number(item.unit_price))}</small></span><strong>{ars.format(Number(item.line_total))}</strong></div>)}
                <div className="store-order-total"><span>Total</span><strong>{ars.format(Number(order.total))}</strong></div>{order.notes ? <p><strong>Nota:</strong> {order.notes}</p> : null}<small><ShieldCheck /> El stock se descuenta cuando Morita confirma el pedido.</small>
              </div>
            </details>) : <div className="store-account-empty"><PackageCheck /><p>Todavía no realizaste pedidos.</p><Link href="/tienda/productos">Explorar productos</Link></div>}
          </div></details>
        </section>
      </div>
    </div>
  );
}
