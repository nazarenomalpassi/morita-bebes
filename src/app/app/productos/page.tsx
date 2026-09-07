import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  PackageOpen,
  Plus,
  Search,
  Settings2,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;
const money = new Intl.NumberFormat("es-AR", {
  currency: "ARS",
  maximumFractionDigits: 2,
  style: "currency",
});
const quantity = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeSearch(value: string) {
  return value
    .slice(0, 80)
    .replace(/[^a-zA-Z0-9À-ÿ\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageHref(params: URLSearchParams, page: number) {
  const next = new URLSearchParams(params);
  next.set("page", String(page));
  return `/app/productos?${next.toString()}`;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/app");

  const q = safeSearch(first(params.q));
  const categoryId = first(params.category);
  const supplierId = first(params.supplier);
  const status = first(params.status) || "active";
  const requestedPage = Number.parseInt(first(params.page), 10);
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [categoriesResult, suppliersResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("organization_id", organization.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("suppliers")
      .select("id, business_name")
      .eq("organization_id", organization.id)
      .eq("is_active", true)
      .order("business_name"),
  ]);

  const from = (currentPage - 1) * PAGE_SIZE;
  let productsQuery = supabase
    .from("products")
    .select("id, name, sku, retail_price, current_stock, min_stock, needs_restock, is_active, category_id, default_supplier_id, categories(name), brands(name), suppliers(business_name)", { count: "exact" })
    .eq("organization_id", organization.id);
  if (q) {
    const pattern = `%${q}%`;
    productsQuery = productsQuery.or(`name.ilike.${pattern},sku.ilike.${pattern},barcode.ilike.${pattern}`);
  }
  if (/^[0-9a-f-]{36}$/i.test(categoryId)) productsQuery = productsQuery.eq("category_id", categoryId);
  if (/^[0-9a-f-]{36}$/i.test(supplierId)) productsQuery = productsQuery.eq("default_supplier_id", supplierId);
  if (status === "active") productsQuery = productsQuery.eq("is_active", true);
  if (status === "inactive") productsQuery = productsQuery.eq("is_active", false);
  if (status === "low") productsQuery = productsQuery.eq("is_active", true).eq("needs_restock", true);
  if (status === "unassigned") productsQuery = productsQuery.is("default_supplier_id", null);
  const { count, data: products, error } = await productsQuery.order("name").range(from, from + PAGE_SIZE - 1);

  if (error || categoriesResult.error || suppliersResult.error) {
    throw new Error("No se pudo consultar el inventario.");
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const normalizedParams = new URLSearchParams();
  if (q) normalizedParams.set("q", q);
  if (categoryId) normalizedParams.set("category", categoryId);
  if (supplierId) normalizedParams.set("supplier", supplierId);
  if (status) normalizedParams.set("status", status);

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <span className="eyebrow">Catálogo e inventario</span>
          <h1 className="page-title mt-2">Productos</h1>
          <p className="page-lead">{total} productos coinciden con la búsqueda actual.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="button button-secondary gap-2" href="/app/proveedores"><Truck size={17} /> Proveedores</Link>
          <Link className="button button-secondary gap-2" href="/app/categorias">
            <Settings2 size={17} /> Categorías y marcas
          </Link>
          <Link className="button button-primary gap-2" href="/app/productos/nuevo">
            <Plus size={17} /> Nuevo producto
          </Link>
        </div>
      </header>

      <form className="mt-7 grid gap-3 border-y border-[var(--line)] py-4 md:grid-cols-[minmax(13rem,1fr)_minmax(10rem,0.7fr)_minmax(10rem,0.7fr)_minmax(9rem,0.55fr)_auto]" method="get">
        <label className="input-shell input-shell-start">
          <span className="sr-only">Buscar producto</span>
          <Search aria-hidden="true" size={17} />
          <input className="field-input" defaultValue={q} maxLength={80} name="q" placeholder="Nombre, SKU o código" />
        </label>
        <label>
          <span className="sr-only">Filtrar por categoría</span>
          <select className="field-input" defaultValue={categoryId} name="category">
            <option value="">Todas las categorías</option>
            {categoriesResult.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filtrar por proveedor</span>
          <select className="field-input" defaultValue={supplierId} name="supplier">
            <option value="">Todos los proveedores</option>
            {suppliersResult.data?.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.business_name}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filtrar por estado</span>
          <select className="field-input" defaultValue={status} name="status">
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="low">Para reponer</option>
            <option value="unassigned">Sin proveedor</option>
            <option value="inactive">Inactivos</option>
          </select>
        </label>
        <button className="button button-secondary gap-2" type="submit"><Search size={17} /> Filtrar</button>
      </form>

      {products?.length ? (
        <>
          <div className="data-table-wrap" data-mobile-cards>
            <table className="data-table min-w-[56rem]">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>SKU</th>
                  <th>Proveedor</th>
                  <th>Precio</th>
                  <th>Stock</th>
                  <th>Estado</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr className={product.is_active ? "" : "opacity-60"} key={product.id}>
                    <td data-label="Producto">
                      <strong>{product.name}</strong>
                      <small>{product.brands?.name ?? "Sin marca"} · {product.categories?.name ?? "Sin categoría"}</small>
                    </td>
                    <td className="font-mono text-xs" data-label="SKU">{product.sku}</td>
                    <td data-label="Proveedor">{product.suppliers?.business_name ?? <span className="text-[var(--danger)]">Pendiente</span>}</td>
                    <td data-label="Precio">{money.format(Number(product.retail_price))}</td>
                    <td data-label="Stock">{quantity.format(Number(product.current_stock))} / mín. {quantity.format(Number(product.min_stock))}</td>
                    <td data-label="Estado">
                      {!product.is_active ? (
                        <span className="table-status text-[var(--ink-muted)]"><CircleOff size={15} /> Inactivo</span>
                      ) : product.needs_restock ? (
                        <span className="table-status table-status-alert"><AlertTriangle size={15} /> Reponer</span>
                      ) : (
                        <span className="table-status table-status-ok">En orden</span>
                      )}
                    </td>
                    <td className="text-right" data-label="">
                      <Link className="font-bold text-[var(--plum)] no-underline hover:underline" href={`/app/productos/${product.id}`}>Ver</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-3 text-sm text-[var(--ink-muted)]">
            <span>Página {Math.min(currentPage, totalPages)} de {totalPages}</span>
            <div className="flex gap-2">
              {currentPage > 1 ? <Link aria-label="Página anterior" className="button button-secondary h-10 min-h-10 px-3" href={pageHref(normalizedParams, currentPage - 1)}><ChevronLeft size={17} /></Link> : null}
              {currentPage < totalPages ? <Link aria-label="Página siguiente" className="button button-secondary h-10 min-h-10 px-3" href={pageHref(normalizedParams, currentPage + 1)}><ChevronRight size={17} /></Link> : null}
            </div>
          </nav>
        </>
      ) : (
        <section className="empty-state">
          <span className="empty-state-icon"><PackageOpen size={28} /></span>
          <h2>No encontramos productos</h2>
          <p>{q || categoryId || supplierId || status !== "all" ? "Probá quitar algún filtro o cargá un producto nuevo." : "Creá el primer producto para comenzar a controlar precios y stock."}</p>
          <Link className="button button-primary mt-4 gap-2" href="/app/productos/nuevo"><Plus size={17} /> Nuevo producto</Link>
        </section>
      )}
    </div>
  );
}
