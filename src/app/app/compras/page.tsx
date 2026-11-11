import { Download, PackagePlus, PackageSearch, ShoppingCart, Truck } from "lucide-react";
import Link from "next/link";

import { PurchaseManagement } from "@/components/purchases/purchase-management";
import type {
  PurchaseOrder,
  PurchaseOrderFilter,
} from "@/components/purchases/purchase-types";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { getPurchaseCatalog } from "@/lib/purchases/catalog";
import { ars } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requestedPage } from "@/lib/data/pagination";
import { fetchAllRows } from "@/lib/data/fetch-all-rows";
import { ManagementPagination } from "@/components/forms/management-pagination";

export const dynamic = "force-dynamic";

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ estado?: string; orden?: string; pagina?: string }> }) {
  const params = await searchParams;
  const page = requestedPage(params.pagina);
  const initialOrderFilter: PurchaseOrderFilter = ["open", "all", "draft", "sent", "partial", "received", "cancelled"].includes(params.estado ?? "")
    ? params.estado as PurchaseOrderFilter : "open";
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  let ordersQuery = supabase.from("purchase_orders").select("id, reference, status, ordered_at, expected_at, received_at, estimated_total, notes, created_at, supplier_id, suppliers(business_name), purchase_order_items(id, product_id, quantity_ordered, quantity_received, unit_cost, products(name, sku, unit))", { count: "exact" }).eq("organization_id", organization.id);
  if (initialOrderFilter === "open") ordersQuery = ordersQuery.in("status", ["draft", "sent", "partial"]);
  else if (initialOrderFilter !== "all") ordersQuery = ordersQuery.eq("status", initialOrderFilter);
  if (params.orden && /^[0-9a-f-]{36}$/i.test(params.orden)) ordersQuery = ordersQuery.eq("id", params.orden);
  const [{ products, suppliers }, ordersResult, openOrders] = await Promise.all([
    getPurchaseCatalog(supabase, organization.id),
    ordersQuery.order("created_at", { ascending: false }).order("id").range((page - 1) * 50, page * 50 - 1),
    fetchAllRows((from, to) => supabase.from("purchase_orders").select("id, estimated_total").eq("organization_id", organization.id).in("status", ["draft", "sent", "partial"]).order("id").range(from, to)),
  ]);

  if (ordersResult.error) {
    throw new Error("No se pudo cargar la información de compras.");
  }

  const orders: PurchaseOrder[] = (ordersResult.data ?? []).map((order) => ({
    id: order.id,
    reference: order.reference,
    status: order.status,
    orderedAt: order.ordered_at,
    expectedAt: order.expected_at,
    receivedAt: order.received_at,
    estimatedTotal: Number(order.estimated_total),
    notes: order.notes,
    createdAt: order.created_at,
    supplierId: order.supplier_id,
    supplierName: order.suppliers?.business_name ?? "Proveedor inactivo",
    items: order.purchase_order_items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.products?.name ?? "Producto no disponible",
      sku: item.products?.sku ?? "Sin SKU",
      unit: item.products?.unit ?? "unidad",
      quantityOrdered: Number(item.quantity_ordered),
      quantityReceived: Number(item.quantity_received),
      unitCost: Number(item.unit_cost),
    })),
  }));
  const shortages = products.filter((product) => product.needsRestock);
  const supplierPending = shortages.filter((product) => !product.supplierId).length;
  const openValue = openOrders.reduce((sum, order) => sum + Number(order.estimated_total), 0);
  const canManage = true;

  return (
    <div className="page-container page-container-wide">
      <header className="page-header">
        <div>
          <span className="eyebrow">Abastecimiento y proveedores</span>
          <h1 className="page-title mt-2">Compras y reposición</h1>
          <p className="page-lead">
            Registrá ingresos de mercadería o prepará pedidos a proveedores desde los faltantes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Link className="button button-primary gap-2" href="/app/compras/cargar"><PackagePlus size={17} /> Ingresar mercadería</Link>
        <a className="button button-secondary gap-2" href="/api/compras/faltantes">
          <Download size={17} /> Exportar faltantes
        </a>
        </div>
      </header>

      <section className="stats-grid">
        <article className="stat-card"><span className="stat-icon stat-icon-coral"><PackageSearch size={19} /></span><p>Productos a reponer</p><strong>{shortages.length}</strong></article>
        <article className="stat-card"><span className="stat-icon stat-icon-rose"><Truck size={19} /></span><p>Sin proveedor asignado</p><strong>{supplierPending}</strong></article>
        <article className="stat-card"><span className="stat-icon stat-icon-lavender"><ShoppingCart size={19} /></span><p>Órdenes abiertas</p><strong>{openOrders.length}</strong></article>
        <article className="stat-card"><span className="stat-icon stat-icon-mint"><ShoppingCart size={19} /></span><p>Valor estimado abierto</p><strong className="text-[1.3rem]">{ars.format(openValue)}</strong></article>
      </section>

      {!canManage && (
        <p className="mt-5 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-muted)]">
          Tu perfil tiene acceso de lectura. Las órdenes y recepciones las gestionan dueños y administradores.
        </p>
      )}

      <PurchaseManagement
        key={`${initialOrderFilter}:${page}:${params.orden ?? ""}`}
        canCancel={organization.role !== "staff"}
        canManage={canManage}
        initialOrderFilter={initialOrderFilter}
        selectedOrderId={params.orden}
        orders={orders}
        products={products}
        suppliers={suppliers}
      />
      <ManagementPagination path="/app/compras" params={params} page={page} total={ordersResult.count ?? 0} label="Páginas de compras" />
    </div>
  );
}
