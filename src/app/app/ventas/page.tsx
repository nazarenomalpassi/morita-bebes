import { ArrowLeft, ArrowRight, Eye, ReceiptText } from "lucide-react";
import Link from "next/link";

import { SaleWorkspace } from "@/app/app/ventas/sale-workspace";
import { CancelSaleControl } from "@/components/sales/cancel-sale-control";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { fetchAllRows } from "@/lib/data/fetch-all-rows";
import { isIsoDate, nextIsoDate } from "@/lib/date";
import { ars, dateTime } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const employee = first(params.empleado);
  const employeeFilter = /^[0-9a-f-]{36}$/i.test(employee) ? employee : undefined;
  const search = first(params.buscar).trim().slice(0, 100);
  const from = first(params.desde);
  const to = first(params.hasta);
  const source = first(params.origen);
  const sourceFilter = source === "system" || source === "legacy_import" ? source : undefined;
  const status = first(params.estado);
  const statusFilter = status === "active" || status === "cancelled" ? status : "all";
  const page = Math.max(1, Number.parseInt(first(params.pagina), 10) || 1);
  const pageSize = 100;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;

  const productsPromise = organization.role === "staff"
    ? supabase.rpc("list_operational_products", { p_organization_id: organization.id })
    : fetchAllRows((from, to) => supabase.from("products").select("id, name, sku, barcode, current_stock, retail_price, unit, is_active").eq("organization_id", organization.id).order("name").order("id").range(from, to));

  const [productsResult, customers, paymentMethods, salesResult, membersResult] = await Promise.all([
    productsPromise,
    fetchAllRows((from, to) => supabase.from("customers").select("id, name").eq("organization_id", organization.id).eq("is_active", true).order("name").order("id").range(from, to)),
    fetchAllRows((from, to) => supabase.from("payment_methods").select("id, name, code, debit_surcharge_percent, credit_surcharge_percent").eq("organization_id", organization.id).eq("is_active", true).in("code", ["cash", "transfer", "card"]).order("sort_order").order("id").range(from, to)),
    supabase.rpc("list_operational_sales", {
      p_organization_id: organization.id,
      p_created_by: employeeFilter,
      p_from: isIsoDate(from) ? `${from}T00:00:00-03:00` : undefined,
      p_to: isIsoDate(to) ? `${nextIsoDate(to)}T00:00:00-03:00` : undefined,
      p_source: sourceFilter,
      p_search: search || undefined,
      p_status: statusFilter,
      p_limit: pageSize,
      p_offset: (page - 1) * pageSize,
    }),
    organization.role === "staff" ? Promise.resolve({ data: [], error: null }) : supabase.rpc("list_organization_members", { p_organization_id: organization.id }),
  ]);

  if ((!Array.isArray(productsResult) && productsResult.error) || salesResult.error || membersResult.error) {
    throw new Error("No se pudo cargar la información de ventas.");
  }

  const productRows = Array.isArray(productsResult)
    ? productsResult
    : (productsResult.data ?? []);
  const products = productRows
    .map((product) => ({ ...product, current_stock: Number(product.current_stock), retail_price: Number(product.retail_price) }));
  const sales = salesResult.data ?? [];
  const matchingCount = Number(sales[0]?.matching_count ?? 0);
  const pages = Math.max(1, Math.ceil(matchingCount / pageSize));
  const pageHref = (targetPage: number) => {
    const query = new URLSearchParams();
    if (employee) query.set("empleado", employee);
    if (search) query.set("buscar", search);
    if (isIsoDate(from)) query.set("desde", from);
    if (isIsoDate(to)) query.set("hasta", to);
    if (sourceFilter) query.set("origen", sourceFilter);
    if (statusFilter !== "all") query.set("estado", statusFilter);
    query.set("pagina", String(targetPage));
    return `/app/ventas?${query.toString()}`;
  };

  return (
    <div className="page-container page-container-wide">
      <header className="page-header"><div><span className="eyebrow">Caja y mostrador</span><h1 className="page-title mt-2">Ventas</h1><p className="page-lead">Registrá una venta y descontá el stock en la misma operación.</p></div></header>

      <SaleWorkspace
        canChooseDate={organization.role !== "staff"}
        customers={customers}
        paymentMethods={paymentMethods.map((method) => ({
          ...method,
          debit_surcharge_percent: Number(method.debit_surcharge_percent),
          credit_surcharge_percent: Number(method.credit_surcharge_percent),
        }))}
        products={products}
      />

      <section className="records-section">
        <div className="section-heading-row"><div><span className="eyebrow">Movimientos recientes</span><h2>Últimas ventas</h2></div><ReceiptText size={21} /></div>
        <form className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-8" method="get">
          <label className="field-label xl:col-span-2">Buscar<input className="field-input" defaultValue={search} name="buscar" placeholder="N.º histórico, cliente o pago" /></label>
          <label className="field-label">Desde<input className="field-input" defaultValue={isIsoDate(from) ? from : ""} name="desde" type="date" /></label>
          <label className="field-label">Hasta<input className="field-input" defaultValue={isIsoDate(to) ? to : ""} name="hasta" type="date" /></label>
          <label className="field-label">Origen<select className="field-input" defaultValue={sourceFilter ?? ""} name="origen"><option value="">Todos</option><option value="system">Sistema actual</option><option value="legacy_import">Históricas</option></select></label>
          <label className="field-label">Estado<select className="field-input" defaultValue={statusFilter} name="estado"><option value="all">Todas</option><option value="active">Activas</option><option value="cancelled">Anuladas</option></select></label>
          {organization.role !== "staff" ? <label className="field-label">Realizada por<select className="field-input" defaultValue={employee} name="empleado"><option value="">Todos</option>{(membersResult.data ?? []).map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email || member.user_id}</option>)}</select></label> : null}
          <div className="flex items-end"><button className="button button-secondary w-full" type="submit">Filtrar</button></div>
        </form>
        <p className="mb-3 text-sm text-[var(--ink-muted)]">{matchingCount} ventas coinciden con los filtros.</p>
        <div className="data-table-wrap compact-table-wrap" data-mobile-cards>
          <table className="data-table min-w-[64rem]">
            <thead><tr><th>Fecha</th><th>Venta</th><th>Cliente</th><th>Pago</th><th>Productos</th><th>Realizado por</th><th>Total</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td data-label="Fecha">{dateTime.format(new Date(sale.occurred_at))}</td>
                  <td data-label="Venta"><strong>{sale.source === "legacy_import" ? `Hist. #${sale.legacy_sale_number}` : sale.reference ?? `#${sale.id.slice(0, 8)}`}</strong>{sale.source === "legacy_import" ? <small className="mt-1 block text-[var(--ink-muted)]">Importada del sistema anterior</small> : null}{sale.status === "cancelled" && sale.cancellation_reason ? <small className="mt-1 block text-[var(--ink-muted)]">{sale.cancellation_reason}</small> : null}</td>
                  <td data-label="Cliente">{sale.customer_name ?? "Consumidor final"}</td>
                  <td data-label="Pago">{sale.payment_method_name ?? "Sin indicar"}</td>
                  <td data-label="Productos">{sale.item_detail_status === "missing_from_source" ? <span title="El archivo legado no contiene productos ni cantidades">No provisto</span> : sale.item_count}</td>
                  <td data-label="Realizada por">{sale.source === "legacy_import" ? sale.legacy_seller_name || "Importación histórica" : sale.actor_name || sale.actor_email || "Sistema"}</td>
                  <td data-label="Total"><strong>{ars.format(Number(sale.total))}</strong></td>
                  <td data-label="Estado"><span className={`table-status ${sale.status === "cancelled" ? "table-status-alert" : "table-status-ok"}`}>{sale.status === "cancelled" ? "Anulada" : "Completada"}</span></td>
                  <td data-label=""><div className="sale-row-actions"><Link aria-label="Ver comprobante" className="icon-button" href={`/app/ventas/${sale.id}/comprobante`} title="Ver comprobante"><Eye size={16} /></Link>{sale.status === "completed" ? <CancelSaleControl compact saleId={sale.id} /> : null}</div></td>
                </tr>
              ))}
              {sales.length === 0 ? <tr><td className="table-empty-cell" colSpan={9}>No hay ventas para los filtros seleccionados.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {pages > 1 ? <nav aria-label="Paginación de ventas" className="mt-4 flex items-center justify-between"><span className="text-sm text-[var(--ink-muted)]">Página {Math.min(page, pages)} de {pages}</span><div className="flex gap-2">{page > 1 ? <a className="button button-secondary" href={pageHref(page - 1)}><ArrowLeft size={16} /> Anterior</a> : null}{page < pages ? <a className="button button-secondary" href={pageHref(page + 1)}>Siguiente <ArrowRight size={16} /></a> : null}</div></nav> : null}
      </section>
    </div>
  );
}
