import { AlertTriangle, ArrowRight, Banknote, Boxes, ChevronDown, Clock3, ClipboardList, PackageCheck, ShoppingBag } from "lucide-react";
import Link from "next/link";

import { OnboardingForm } from "./onboarding-form";

import { SensitiveAmount } from "@/components/finance/sensitive-balances";
import { getCurrentCashPeriod } from "@/lib/cash/period";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { fetchAllRows } from "@/lib/data/fetch-all-rows";
import { ars, dateTime, quantity } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);

  if (!organization) {
    const { data: canBootstrap } = await supabase.rpc("can_bootstrap_organization");
    if (!canBootstrap) return <section className="onboarding-section permission-state"><Clock3 size={30} /><h1>Acceso pendiente</h1><p>Un administrador debe habilitar este correo para ingresar.</p></section>;
    return <section className="onboarding-section"><span className="eyebrow">Configuración inicial</span><h1 className="page-title mt-3">Crear el espacio de Morita Bebes</h1><p className="page-lead">Se cargarán las categorías, medios de pago y ajustes iniciales del comercio.</p><OnboardingForm /></section>;
  }

  const cashPeriod = getCurrentCashPeriod();
  const sales = await fetchAllRows((from, to) => supabase.from("sales").select("id, total").eq("organization_id", organization.id).eq("status", "completed").gte("occurred_at", cashPeriod.startsAt.toISOString()).lt("occurred_at", cashPeriod.closesAt.toISOString()).order("occurred_at").order("id").range(from, to));
  const recentSalesResult = await supabase.rpc("list_operational_sales", { p_organization_id: organization.id, p_limit: 5 });
  if (recentSalesResult.error) throw new Error("No se pudo cargar el resumen operativo.");
  const recentSales = recentSalesResult.data ?? [];

  let productCount = 0;
  let lowStockCount = 0;
  let openOrdersCount = 0;
  let lowProducts: Array<{ id: string; name: string; current_stock: number; min_stock: number; supplier: string | null }> = [];

  const [products, lowStock, purchaseOrders, lowResult] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).eq("is_active", true),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).eq("is_active", true).eq("needs_restock", true),
    supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).in("status", ["draft", "sent", "partial"]),
    supabase.from("products").select("id, name, current_stock, min_stock, suppliers(business_name)").eq("organization_id", organization.id).eq("is_active", true).eq("needs_restock", true).order("current_stock").limit(6),
  ]);
  if ([products, lowStock, purchaseOrders, lowResult].some((result) => result.error)) throw new Error("No se pudo cargar el resumen operativo.");
  productCount = products.count ?? 0;
  lowStockCount = lowStock.count ?? 0;
  openOrdersCount = purchaseOrders.count ?? 0;
  lowProducts = (lowResult.data ?? []).map((product) => ({ id: product.id, name: product.name, current_stock: Number(product.current_stock), min_stock: Number(product.min_stock), supplier: product.suppliers?.business_name ?? null }));

  const dailyRevenue = sales.reduce((total, sale) => total + Number(sale.total), 0);
  const stats = [
    { label: "Productos activos", value: String(productCount), icon: PackageCheck, tone: "lavender", sensitive: false },
    { label: "Stock por reponer", value: String(lowStockCount), icon: AlertTriangle, tone: "coral", sensitive: false },
    { label: "Órdenes abiertas", value: String(openOrdersCount), icon: ClipboardList, tone: "mint", sensitive: false },
    { label: "Ventas del día", value: ars.format(dailyRevenue), icon: Banknote, tone: "rose", sensitive: true },
  ];

  return (
    <div className="page-container">
      <header className="page-header"><div><span className="eyebrow">Panel operativo</span><h1 className="page-title mt-2">{organization.name}</h1><p className="page-lead">Estado general del comercio.</p></div><span className="role-badge">{organization.role === "staff" ? "Empleado" : "Administrador"}</span></header>
      <section className="stats-grid" aria-label="Indicadores principales">{stats.map(({ label, value, icon: Icon, tone, sensitive }) => <article className="stat-card" key={label}><span className={`stat-icon stat-icon-${tone}`}><Icon size={21} /></span><p>{label}</p><strong>{sensitive ? <SensitiveAmount>{value}</SensitiveAmount> : value}</strong></article>)}</section>
      <section className="dashboard-grid">
        <details className="dashboard-panel restock-disclosure">
          <summary>
            <div><span className="eyebrow">Caja</span><h2>Ventas recientes</h2><p>{recentSales.length === 0 ? "Todavía no hay ventas registradas" : `${recentSales.length} ${recentSales.length === 1 ? "venta reciente" : "ventas recientes"}`}</p></div>
            <span className="restock-disclosure-action">Ver detalle <ChevronDown size={18} /></span>
          </summary>
          <div className="restock-disclosure-content">
            <Link className="text-link" href="/app/ventas">Ver todas <ArrowRight size={15} /></Link>
            <div className="compact-list">{recentSales.map((sale) => <div className="compact-list-row" key={sale.id}><span className="entity-avatar"><ShoppingBag size={17} /></span><div><strong>{sale.customer_name ?? "Consumidor final"}</strong><small>{dateTime.format(new Date(sale.occurred_at))} · {sale.payment_method_name ?? "Sin indicar"}</small></div><strong>{ars.format(Number(sale.total))}</strong></div>)}{recentSales.length === 0 ? <p className="inline-empty">Todavía no hay ventas registradas.</p> : null}</div>
          </div>
        </details>
        <details className="dashboard-panel restock-disclosure">
          <summary>
            <div><span className="eyebrow">Inventario</span><h2>Reposición prioritaria</h2><p>{lowStockCount === 0 ? "No hay productos para reponer" : `${lowStockCount} ${lowStockCount === 1 ? "producto requiere" : "productos requieren"} reposición`}</p></div>
            <span className="restock-disclosure-action">Ver detalle <ChevronDown size={18} /></span>
          </summary>
          <div className="restock-disclosure-content">
            <Link className="text-link" href="/app/compras">Preparar compra <ArrowRight size={15} /></Link>
            <div className="compact-list">{lowProducts.map((product) => <div className="compact-list-row" key={product.id}><span className="entity-avatar entity-avatar-alert"><AlertTriangle size={17} /></span><div><strong>{product.name}</strong><small>{product.supplier ? `${product.supplier} · ` : ""}Mínimo {quantity.format(product.min_stock)}</small></div><strong>{quantity.format(product.current_stock)}</strong></div>)}{lowProducts.length === 0 ? <p className="inline-empty">El stock está por encima de los mínimos configurados.</p> : null}</div>
          </div>
        </details>
      </section>
      <section className="operations-section"><div className="section-heading"><div><span className="eyebrow">Accesos rápidos</span><h2>Operación diaria</h2></div></div><div className="operation-list"><Link className="operation-row" href="/app/ventas"><span className="operation-icon operation-icon-lavender"><ShoppingBag size={20} /></span><span><strong>Nueva venta</strong><small>Cobro y descuento automático de stock</small></span><ArrowRight size={19} /></Link><Link className="operation-row" href="/app/productos"><span className="operation-icon operation-icon-mint"><Boxes size={20} /></span><span><strong>Productos</strong><small>Catálogo, precio de venta y stock disponible</small></span><ArrowRight size={19} /></Link><Link className="operation-row" href="/app/compras"><span className="operation-icon operation-icon-rose"><ClipboardList size={20} /></span><span><strong>Compras y proveedores</strong><small>Faltantes, órdenes y recepción de mercadería</small></span><ArrowRight size={19} /></Link></div></section>
    </div>
  );
}
