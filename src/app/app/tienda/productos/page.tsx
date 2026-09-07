import {
  ChevronLeft,
  ChevronRight,
  CircleOff,
  ImageIcon,
  Images,
  Search,
  Store,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentOrganization } from "@/lib/data/current-organization";
import { resolveStoreImage } from "@/lib/store/images";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

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

function pageHref(query: string, status: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  params.set("page", String(page));
  return `/app/tienda/productos?${params.toString()}`;
}

export default async function StoreProductMediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/login");

  if (organization.role === "staff") {
    return (
      <div className="page-container permission-state">
        <Store />
        <h1>Acceso restringido</h1>
        <p>La administración del e-commerce está disponible para dueños y administradores.</p>
      </div>
    );
  }

  const query = safeSearch(first(params.q));
  const status = ["all", "published", "draft", "missing"].includes(first(params.status))
    ? first(params.status)
    : "all";
  const requestedPage = Number.parseInt(first(params.page), 10);
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;
  const from = (currentPage - 1) * PAGE_SIZE;

  let productsQuery = supabase
    .from("products")
    .select("id, name, sku, is_active, is_published, store_slug, product_images(id, storage_path, is_primary, sort_order)", { count: "exact" })
    .eq("organization_id", organization.id)
    .eq("is_active", true);

  if (query) {
    const pattern = `%${query}%`;
    productsQuery = productsQuery.or(`name.ilike.${pattern},sku.ilike.${pattern},barcode.ilike.${pattern}`);
  }
  if (status === "published") productsQuery = productsQuery.eq("is_published", true);
  if (status === "draft") productsQuery = productsQuery.eq("is_published", false);

  const { count, data: productRows, error } = status === "missing"
    ? await productsQuery.order("name").limit(1000)
    : await productsQuery.order("name").range(from, from + PAGE_SIZE - 1);

  if (error) throw new Error("No se pudo cargar el catálogo de imágenes.");

  const products = status === "missing"
    ? (productRows ?? []).filter((product) => product.product_images.length === 0)
    : productRows ?? [];
  const total = status === "missing" ? products.length : count ?? 0;
  const totalPages = status === "missing" ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <span className="eyebrow">E-commerce</span>
          <h1 className="page-title mt-2">Fotos de productos</h1>
          <p className="page-lead">{total} productos coinciden con la búsqueda actual.</p>
        </div>
        <Link className="button button-secondary gap-2" href="/app/tienda">
          <Store size={17} /> Configurar tienda
        </Link>
      </header>

      <form className="mt-7 grid gap-3 border-y border-[var(--line)] py-4 md:grid-cols-[minmax(15rem,1fr)_minmax(11rem,0.45fr)_auto]" method="get">
        <label className="input-shell input-shell-start">
          <span className="sr-only">Buscar producto</span>
          <Search aria-hidden="true" size={17} />
          <input className="field-input" defaultValue={query} maxLength={80} name="q" placeholder="Nombre, SKU o código" />
        </label>
        <label>
          <span className="sr-only">Filtrar publicación</span>
          <select className="field-input" defaultValue={status} name="status">
            <option value="all">Todos</option>
            <option value="published">Publicados</option>
            <option value="draft">No publicados</option>
            <option value="missing">Sin imágenes</option>
          </select>
        </label>
        <button className="button button-secondary gap-2" type="submit"><Search size={17} /> Filtrar</button>
      </form>

      {products.length ? (
        <>
          <div className="data-table-wrap" data-mobile-cards>
            <table className="data-table min-w-[46rem]">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Vista previa</th>
                  <th>Imágenes</th>
                  <th>Publicación</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const orderedImages = [...product.product_images].sort((left, right) => {
                    if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
                    return left.sort_order - right.sort_order;
                  });
                  const preview = resolveStoreImage(orderedImages[0]?.storage_path ?? null);
                  return (
                    <tr key={product.id}>
                      <td data-label="Producto"><strong>{product.name}</strong><small>SKU {product.sku}</small></td>
                      <td data-label="Vista previa">
                        <span className="relative inline-grid size-16 place-items-center overflow-hidden rounded-[6px] bg-[var(--surface-soft)]">
                          {preview ? <Image alt="" className="object-cover" fill sizes="64px" src={preview} /> : <ImageIcon aria-hidden="true" size={22} />}
                        </span>
                      </td>
                      <td data-label="Imágenes"><span className="table-status"><Images size={15} /> {orderedImages.length}</span></td>
                      <td data-label="Publicación">
                        {product.is_published
                          ? <span className="table-status table-status-ok">Publicado</span>
                          : <span className="table-status text-[var(--ink-muted)]"><CircleOff size={15} /> No publicado</span>}
                      </td>
                      <td className="text-right" data-label="">
                        <Link className="font-bold text-[var(--plum)] no-underline hover:underline" href={`/app/productos/${product.id}#store-gallery-heading`}>Administrar fotos</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {status !== "missing" ? (
            <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-3 text-sm text-[var(--ink-muted)]">
              <span>Página {Math.min(currentPage, totalPages)} de {totalPages}</span>
              <div className="flex gap-2">
                {currentPage > 1 ? <Link aria-label="Página anterior" className="button button-secondary h-10 min-h-10 px-3" href={pageHref(query, status, currentPage - 1)}><ChevronLeft size={17} /></Link> : null}
                {currentPage < totalPages ? <Link aria-label="Página siguiente" className="button button-secondary h-10 min-h-10 px-3" href={pageHref(query, status, currentPage + 1)}><ChevronRight size={17} /></Link> : null}
              </div>
            </nav>
          ) : null}
        </>
      ) : (
        <section className="empty-state">
          <span className="empty-state-icon"><Images size={28} /></span>
          <h2>No encontramos productos</h2>
          <p>Probá con otra búsqueda o cambiá el filtro de publicación.</p>
        </section>
      )}
    </div>
  );
}
