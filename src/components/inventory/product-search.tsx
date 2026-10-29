"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { normalizeProductSearch, type ProductFilters, type ProductSuggestion } from "@/lib/inventory/product-search";

const quantity = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

export function ProductSearch({ filters }: { filters: ProductFilters }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(filters.q);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<{ query: string; products: ProductSuggestion[]; error?: boolean }>({ query: "", products: [] });
  const query = normalizeProductSearch(value);
  const ready = result.query === query;
  const visible = open && query.length >= 2;

  useEffect(() => {
    if (visible && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id, visible]);

  useEffect(() => {
    if (!open || query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, category: filters.category, supplier: filters.supplier, status: filters.status });
        const response = await fetch(`/api/productos/sugerencias?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Search unavailable");
        const data = await response.json() as { products: ProductSuggestion[] };
        if (!controller.signal.aborted) setResult({ query, products: data.products });
      } catch {
        if (!controller.signal.aborted) setResult({ query, products: [], error: true });
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, filters.category, filters.supplier, filters.status]);

  function choose(product: ProductSuggestion) {
    setValue(product.name);
    setOpen(false);
    if (input.current) {
      input.current.value = product.name;
      input.current.form?.requestSubmit();
    }
  }

  return <div className="product-search input-shell input-shell-start" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label className="sr-only" htmlFor={id}>Buscar producto</label>
    <Search aria-hidden="true" size={17} />
    <input aria-activedescendant={visible && ready && active >= 0 ? `${id}-option-${active}` : undefined} aria-autocomplete="list" aria-controls={`${id}-suggestions`} aria-expanded={visible} autoComplete="off" className="field-input" id={id} maxLength={80} name="q" placeholder="Nombre, SKU o código" ref={input} role="combobox" type="search" value={value} onChange={(event) => { setValue(event.target.value); setOpen(true); setActive(-1); }} onFocus={() => setOpen(true)} onKeyDown={(event) => {
      if (event.key === "Escape") { setOpen(false); setActive(-1); return; }
      if (ready && result.products.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault(); setOpen(true);
        setActive((current) => event.key === "ArrowDown" ? (current + 1) % result.products.length : (current <= 0 ? result.products.length : current) - 1);
      }
      if (event.key === "Enter" && visible && ready && active >= 0) { event.preventDefault(); choose(result.products[active]); }
    }} />
    {visible ? <div className="product-suggestions">
      <div aria-label="Sugerencias de productos" id={`${id}-suggestions`} role="listbox">
        {ready ? result.products.map((product, index) => <button aria-selected={active === index} className={active === index ? "is-active" : ""} id={`${id}-option-${index}`} key={product.id} onClick={() => choose(product)} onPointerDown={(event) => event.preventDefault()} role="option" tabIndex={-1} type="button"><strong>{product.name}</strong><small>SKU {product.sku} · Stock {quantity.format(product.stock)}</small></button>) : null}
      </div>
      <p className="product-suggestions-status" role="status">{!ready ? <><LoaderCircle aria-hidden="true" className="animate-spin" size={14} /> Buscando...</> : result.error ? "No pudimos cargar las sugerencias." : result.products.length ? `${result.products.length} coincidencias` : "No hay coincidencias."}</p>
    </div> : null}
  </div>;
}
