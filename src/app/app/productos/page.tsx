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

import { ProductPriceCells } from "@/components/inventory/product-price-cells";
import { ProductSearch } from "@/components/inventory/product-search";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { normalizeProductSearch, productPageSize, queryManagementProducts } from "@/lib/inventory/product-search";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ProductBatchTools } from "@/components/inventory/product-batch-tools";
import { readInventoryAttributes } from "@/lib/inventory/attributes";
import { ProductFilterOptions } from "@/components/inventory/product-filter-options";

const quantity = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
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

  const q = normalizeProductSearch(first(params.q));
  const pageSize = productPageSize(first(params.page_size));
  const categoryId = first(params.category);
  const supplierId = first(params.supplier);
  const brandId = first(params.brand);
  const pendingData = first(params.pending);
  const status = first(params.status) || "active";
  const requestedPage = Number.parseInt(first(params.page), 10);
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [categoriesResult, suppliersResult, brandsResult] = await Promise.all([
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
    supabase.from("brands").select("id, name").eq("organization_id", organization.id).eq("is_active", true).order("name"),
  ]);

  const filters = { q, category: categoryId, supplier: supplierId, status, brand: brandId, pending: pendingData };
  const from = (currentPage - 1) * pageSize;
  const { count, data: products, error } = await queryManagementProducts(supabase, organization.id, filters, true).range(from, from + pageSize - 1);

  if (error || categoriesResult.error || suppliersResult.error || brandsResult.error) {
    throw new Error("No se pudo consultar el inventario.");
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const normalizedParams = new URLSearchParams();
  if (q) normalizedParams.set("q", q);
  if (categoryId) normalizedParams.set("category", categoryId);
  if (supplierId) normalizedParams.set("supplier", supplierId);
  if (brandId) normalizedParams.set("brand", brandId);
  if (pendingData) normalizedParams.set("pending", pendingData);
  if (status) normalizedParams.set("status", status);
  normalizedParams.set("page_size", String(pageSize));
  if (currentPage > totalPages) redirect(pageHref(normalizedParams, totalPages));

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

      <form className="product-filters management-product-filters mt-7 border-y border-[var(--line)] py-4" method="get">
        <ProductSearch filters={filters} key={normalizedParams.toString()} />
        <button className="button button-secondary gap-2" type="submit"><Search size={17} /> Filtrar</button>
        <ProductFilterOptions active={Boolean(categoryId || supplierId || brandId || pendingData || status !== "active")}>
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
          <span className="sr-only">Filtrar por marca</span><select className="field-input" defaultValue={brandId} name="brand"><option value="">Todas las marcas</option>{brandsResult.data?.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select>
        </label>
        <label>
          <span className="sr-only">Datos pendientes</span><select className="field-input" defaultValue={pendingData} name="pending"><option value="">Cualquier dato</option><option value="category">Sin categoría</option><option value="brand">Sin marca</option><option value="cost">Costo cero: revisar</option></select>
        </label>
        <label>
          <span className="sr-only">Filtrar por estado</span>
          <select className="field-input" defaultValue={status} name="status">
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="low">Para reponer</option>
            <option value="zero">Sin stock</option>
            <option value="unassigned">Sin proveedor</option>
            <option value="inactive">Inactivos</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Productos por página</span>
          <select className="field-input" defaultValue={pageSize} name="page_size">
            <option value={10}>10 por página</option><option value={20}>20 por página</option><option value={50}>50 por página</option>
          </select>
        </label>
        </ProductFilterOptions>
      </form>

      {products?.length ? (
        <>
          <ProductBatchTools brands={brandsResult.data ?? []} categories={categoriesResult.data ?? []} key={normalizedParams.toString()} products={products} />
          <div className="data-table-wrap" data-mobile-cards>
            <table className="data-table product-price-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Stock</th>
                  <th>Costo</th>
                  <th>Minorista</th>
                  <th>Mayorista</th>
                  <th>Estado</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr className={product.is_active ? "" : "opacity-60"} key={product.id}>
                    <td data-label="Producto">
                      <div className="entity-copy">
                      <strong>{product.name}</strong>
                      <small>SKU {product.sku} · {product.brands?.name ?? "Sin marca"} · {product.categories?.name ?? "Sin categoría"}</small>
                      <small>{product.suppliers?.business_name ?? "Proveedor pendiente"}</small>
                      <span className="catalog-attributes">{Object.values(readInventoryAttributes(product.inventory_attributes)).filter(Boolean).map((value, index) => <span key={index}>{value}</span>)}</span>
                      </div>
                    </td>
                    <td data-label="Stock">{quantity.format(Number(product.current_stock))} / mín. {quantity.format(Number(product.min_stock))}</td>
                    <ProductPriceCells
                      key={product.id}
                      initialPrices={{
                        costPrice: Number(product.cost_price),
                        retailPrice: Number(product.retail_price),
                        wholesalePrice: product.wholesale_price === null ? null : Number(product.wholesale_price),
                      }}
                      productId={product.id}
                      productName={product.name}
                      status={!product.is_active ? (
                        <span className="table-status text-[var(--ink-muted)]"><CircleOff size={15} /> Inactivo</span>
                      ) : product.needs_restock ? (
                        <span className="table-status table-status-alert"><AlertTriangle size={15} /> Reponer</span>
                      ) : (
                        <span className="table-status table-status-ok">En orden</span>
                      )}
                    />
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
