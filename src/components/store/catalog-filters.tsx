import { Filter, Search, SlidersHorizontal } from "lucide-react";

import type { StoreBrand, StoreCategory } from "@/lib/store/types";

type Props = {
  availability: string;
  brand: string;
  brands: StoreBrand[];
  categories: StoreCategory[];
  category: string;
  search: string;
  sort: string;
};

function FilterFields({ availability, brand, brands, categories, category, sort }: Omit<Props, "search">) {
  return (
    <>
      <select aria-label="Categoría" defaultValue={category} name="categoria"><option value="">Todas las categorías</option>{categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select>
      <select aria-label="Marca" defaultValue={brand} name="marca"><option value="">Todas las marcas</option>{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select aria-label="Disponibilidad" defaultValue={availability} name="disponibilidad"><option value="all">Toda disponibilidad</option><option value="in_stock">Con stock</option></select>
      <select aria-label="Orden" defaultValue={sort} name="orden"><option value="featured">Destacados</option><option value="newest">Más nuevos</option><option value="price_asc">Menor precio</option><option value="price_desc">Mayor precio</option><option value="name">Nombre</option></select>
    </>
  );
}

export function CatalogFilters(props: Props) {
  const activeCount = [props.category, props.brand, props.availability !== "all", props.sort !== "featured"].filter(Boolean).length;

  return (
    <>
      <form action="/tienda/productos" className="store-catalog-toolbar store-catalog-toolbar-desktop">
        <label className="store-search-input"><Search aria-hidden="true" /><input defaultValue={props.search} name="buscar" placeholder="Buscar productos, marcas o categorías" /></label>
        <FilterFields {...props} />
        <button className="store-filter-button" type="submit"><Filter aria-hidden="true" /> Aplicar</button>
      </form>

      <form action="/tienda/productos" className="store-catalog-toolbar-mobile">
        <div className="store-catalog-mobile-search">
          <label className="store-search-input"><Search aria-hidden="true" /><input defaultValue={props.search} name="buscar" placeholder="Buscar productos" /></label>
          <button aria-label="Buscar" className="store-filter-icon-button" type="submit"><Search aria-hidden="true" /></button>
        </div>
        <details>
          <summary><SlidersHorizontal aria-hidden="true" /><span>Filtros y orden</span>{activeCount ? <strong>{activeCount}</strong> : null}</summary>
          <div className="store-catalog-mobile-fields">
            <FilterFields {...props} />
            <button className="store-filter-button" type="submit"><Filter aria-hidden="true" /> Aplicar filtros</button>
          </div>
        </details>
      </form>
    </>
  );
}
