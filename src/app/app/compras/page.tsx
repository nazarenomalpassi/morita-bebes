import { Download, PackageSearch, ShoppingCart, Truck } from "lucide-react";

import { PurchaseManagement } from "@/components/purchases/purchase-management";
import type {
  PurchaseOrder,
  PurchaseProduct,
} from "@/components/purchases/purchase-types";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { fetchAllRows } from "@/lib/data/fetch-all-rows";
import { ars } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  const [productRows, suppliers, ordersResult] = await Promise.all([
    fetchAllRows((from, to) => supabase
      .from("products")
      .select("id, name, sku, barcode, current_stock, min_stock, target_stock, cost_price, unit, needs_restock, default_supplier_id, suppliers(business_name)")
      .eq("organization_id", organization.id)
      .eq("is_active", true)
      .order("name")
      .order("id")
      .range(from, to)),
    fetchAllRows((from, to) => supabase
      .from("suppliers")
      .select("id, business_name")
      .eq("organization_id", organization.id)
      .eq("is_active", true)
      .order("business_name")
      .order("id")
      .range(from, to)),
    supabase
      .from("purchase_orders")
      .select("id, reference, status, ordered_at, expected_at, received_at, estimated_total, notes, created_at, supplier_id, suppliers(business_name), purchase_order_items(id, product_id, quantity_ordered, quantity_received, unit_cost, products(name, sku, unit))")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: false })
      .limit(150),
  ]);

  if (ordersResult.error) {
    throw new Error("No se pudo cargar la información de compras.");
  }

  const products: PurchaseProduct[] = productRows.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    currentStock: Number(product.current_stock),
    minStock: Number(product.min_stock),
    targetStock: product.target_stock === null ? null : Number(product.target_stock),
    costPrice: Number(product.cost_price),
    unit: product.unit,
    needsRestock: Boolean(product.needs_restock),
    supplierId: product.default_supplier_id,
    supplierName: product.suppliers?.business_name ?? null,
  }));
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
  const openOrders = orders.filter((order) => ["draft", "sent", "partial"].includes(order.status));
  const openValue = openOrders.reduce((sum, order) => sum + order.estimatedTotal, 0);
  const canManage = true;

  return (
    <div className="page-container page-container-wide">
      <header className="page-header">
        <div>
          <span className="eyebrow">Abastecimiento y proveedores</span>
          <h1 className="page-title mt-2">Compras y reposición</h1>
          <p className="page-lead">
            Prepará pedidos desde los faltantes y registrá cada entrega para actualizar el stock.
          </p>
        </div>
        <a className="button button-secondary gap-2" href="/api/compras/faltantes">
          <Download size={17} /> Exportar faltantes
        </a>
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
        canCancel={organization.role !== "staff"}
        canManage={canManage}
        orders={orders}
        products={products}
        suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.business_name }))}
      />
    </div>
  );
}
