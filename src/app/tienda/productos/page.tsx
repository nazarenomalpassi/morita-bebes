import type { Metadata } from "next";
import { Search } from "lucide-react";
import Link from "next/link";

import { CatalogFilters } from "@/components/store/catalog-filters";
import { ProductCard } from "@/components/store/product-card";
import { getStoreContext, listStoreProducts } from "@/lib/store/queries";

export const metadata: Metadata = { title: "Productos", description: "Explorá el catálogo de Morita Bebés con stock y precios actualizados." };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const value = (input: string | string[] | undefined) => typeof input === "string" ? input : "";

export default async function StoreProductsPage({ searchParams }: Props) {
  const query = await searchParams;
  const search = value(query.buscar);
  const category = value(query.categoria);
  const brand = value(query.marca);
  const availability = value(query.disponibilidad) || "all";
  const sort = value(query.orden) || "featured";
  const page = Math.max(1, Number(value(query.pagina)) || 1);
  const [{ categories, brands, accountType }, products] = await Promise.all([
    getStoreContext(),
    listStoreProducts({ search, category, brandId: brand, availability, sort, limit: 24, offset: (page - 1) * 24 }),
  ]);
  const total = Number(products[0]?.total_count ?? 0);
  const pages = Math.ceil(total / 24);

  return (
    <div className="store-catalog-page store-page">
      <header className="store-page-heading store-catalog-heading"><div><span>Catálogo</span><h1>Productos</h1></div><p>{accountType === "wholesale" ? "Precios mayoristas aprobados y stock actualizado." : "Precios minoristas y stock sincronizado con el local."}</p></header>
      <CatalogFilters availability={availability} brand={brand} brands={brands} categories={categories} category={category} search={search} sort={sort} />
      <div className="store-catalog-meta"><p><strong>{total}</strong> productos encontrados</p>{search || category || brand || availability !== "all" || sort !== "featured" ? <Link href="/tienda/productos">Limpiar filtros</Link> : null}</div>
      {products.length ? <div className="store-product-grid">{products.map((product, index) => <ProductCard index={index} key={product.id} product={product} />)}</div> : <div className="store-empty-state"><Search aria-hidden="true" /><h2>No encontramos productos</h2><p>Probá con otro término o quitá algunos filtros.</p><Link className="store-secondary-button" href="/tienda/productos">Ver todo el catálogo</Link></div>}
      {pages > 1 ? <nav aria-label="Paginación" className="store-pagination">{page > 1 ? <Link href={{ query: { ...query, pagina: page - 1 } }}>Anterior</Link> : <span /> }<span>Página {page} de {pages}</span>{page < pages ? <Link href={{ query: { ...query, pagina: page + 1 } }}>Siguiente</Link> : <span />}</nav> : null}
    </div>
  );
}
