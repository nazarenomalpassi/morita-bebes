"use client";

import { Check, LoaderCircle, PackageCheck, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { loadReceivedPurchaseOrderAction, type PurchaseActionState } from "@/app/app/compras/actions";
import { ars, quantity } from "@/lib/format";
import { formatPriceInput } from "@/lib/inventory/prices";
import { filterPurchaseProducts, parseDirectPurchaseFields, type DirectPurchaseFields, type DirectPurchaseItem } from "@/lib/purchases/direct-entry";
import { useSubmissionState } from "@/lib/ui/use-submission-state";
import type { PurchaseProduct, PurchaseSupplier } from "./purchase-types";
import "./direct-purchase-entry.css";

const subscribe = () => () => {};
type Props = { products: PurchaseProduct[]; suppliers: PurchaseSupplier[]; today: string };
type Line = { product: PurchaseProduct; fields: DirectPurchaseFields };

function DirectPurchaseEditor({ products, suppliers, today, onNew }: Props & { onNew: () => void }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const requestId = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [documentDate, setDocumentDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [state, action, pending] = useSubmissionState<PurchaseActionState, FormData>(async (previous, formData) => {
    requestId.current ??= crypto.randomUUID();
    formData.set("request_id", requestId.current);
    try {
      return await loadReceivedPurchaseOrderAction(previous, formData);
    } catch {
      return { error: "No pudimos confirmar la carga. Conservamos el detalle; revisá tu conexión y volvé a intentar." };
    }
  }, {});
  const results = useMemo(() => filterPurchaseProducts(products, search).slice(0, 8), [products, search]);
  const parsedLines = lines.map((line) => ({ ...line, parsed: parseDirectPurchaseFields(line.fields) }));
  const valid = lines.length > 0 && parsedLines.every((line) => line.parsed.valid);
  const total = parsedLines.reduce((sum, line) => sum + (line.parsed.quantity ?? 0) * (line.parsed.cost ?? 0), 0);
  const totalOutOfRange = total > 999_999_999_999.99;
  const units = parsedLines.reduce((sum, line) => sum + (line.parsed.quantity ?? 0), 0);
  const items: DirectPurchaseItem[] = valid ? parsedLines.map(({ product, parsed }) => ({
    product_id: product.id, quantity: parsed.quantity!, unit_cost: parsed.cost!,
    retail_price: parsed.retail!, wholesale_price: parsed.wholesale,
    original_cost_price: product.costPrice, original_retail_price: product.retailPrice, original_wholesale_price: product.wholesalePrice,
  })) : [];

  useEffect(() => {
    if (!lines.length || state.orderId) return;
    const confirmLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [lines.length, state.orderId]);

  function addProduct(product: PurchaseProduct) {
    if (pending || lines.length >= 500 || lines.some((line) => line.product.id === product.id)) return;
    setLines((current) => [...current, { product, fields: {
      quantity: "1", cost: formatPriceInput(product.costPrice), retail: formatPriceInput(product.retailPrice), wholesale: formatPriceInput(product.wholesalePrice),
    } }]);
    setSearch("");
    searchRef.current?.focus();
  }

  function changeField(productId: string, field: keyof DirectPurchaseFields, value: string) {
    setLines((current) => current.map((line) => line.product.id === productId
      ? { ...line, fields: { ...line.fields, [field]: value } } : line));
  }

  if (state.orderId) return <section className="direct-purchase-success">
    <span className="entity-avatar"><PackageCheck size={24} aria-hidden="true" /></span>
    <div role="status"><h2>Orden cargada y recibida</h2><p>{state.message}</p></div>
    <dl><div><dt>Productos</dt><dd>{lines.length}</dd></div><div><dt>Unidades ingresadas</dt><dd>{quantity.format(units)}</dd></div><div><dt>Total de compra</dt><dd>{ars.format(total)}</dd></div></dl>
    <div className="direct-purchase-actions"><Link className="button button-secondary" href={`/app/compras?estado=received&orden=${state.orderId}`}>Ver orden recibida</Link><Link className="button button-secondary" href="/app/productos">Ver inventario</Link><button className="button button-primary" onClick={onNew} type="button"><Plus size={17} aria-hidden="true" /> Cargar otra orden</button></div>
  </section>;

  return <form action={action} className="direct-purchase-form" onKeyDown={(event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  }}>
    <fieldset className="direct-purchase-fields" disabled={pending || !ready}>
      <div className="direct-purchase-meta">
        <label className="field-label">Proveedor<select className="field-input" name="supplier_id" onChange={(event) => setSupplierId(event.target.value)} required value={supplierId}><option value="">Seleccionar proveedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label className="field-label">Remito / referencia<input className="field-input" maxLength={80} name="reference" onChange={(event) => setReference(event.target.value)} placeholder="Opcional" value={reference} /></label>
        <label className="field-label">Fecha del comprobante<input className="field-input" max={today} name="document_date" onChange={(event) => setDocumentDate(event.target.value)} required type="date" value={documentDate} /></label>
      </div>
      {!suppliers.length ? <p className="form-error">No hay proveedores activos. <Link className="text-link" href="/app/proveedores/nuevo">Agregar proveedor</Link></p> : null}
      <section className="direct-purchase-search" aria-label="Buscar artículos recibidos">
        <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Buscar artículo</span><input
          autoComplete="off" maxLength={100} onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); document.querySelector<HTMLButtonElement>(".direct-purchase-results button:not(:disabled)")?.focus(); }
            if (event.key === "Enter" && results.length === 1) { event.preventDefault(); addProduct(results[0]); }
            if (event.key === "Escape") setSearch("");
          }} placeholder="Nombre, SKU o código" ref={searchRef} type="search" value={search}
        /></label>
        {search.trim() ? <div aria-label="Resultados de productos" className="direct-purchase-results" role="group">
          {results.map((product) => {
            const added = lines.some((line) => line.product.id === product.id);
            return <button aria-label={`Agregar ${product.name}`} disabled={added || lines.length >= 500} key={product.id} onClick={() => addProduct(product)} type="button">
              <span><strong>{product.name}</strong><small>{product.sku} · Stock {quantity.format(product.currentStock)} {product.unit}</small></span>
              <span className="direct-purchase-search-price">{ars.format(product.costPrice)}{added ? <Check size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}</span>
            </button>;
          })}
          {!results.length ? <p className="inline-empty" role="status">No encontramos productos activos.</p> : null}
        </div> : null}
      </section>
      <section className="direct-purchase-detail" aria-label="Artículos recibidos">
        <div className="section-heading-row"><h2>Detalle de la orden</h2><span className="tag">{lines.length} {lines.length === 1 ? "producto" : "productos"}</span></div>
        {!lines.length ? <div className="empty-state direct-purchase-empty"><PackagePlus size={28} aria-hidden="true" /><p>Sin artículos cargados</p></div> : null}
        <div className="direct-purchase-lines">
          {parsedLines.map(({ product, fields, parsed }) => <article className="direct-purchase-line" data-product-id={product.id} key={product.id}>
            <div className="direct-purchase-line-head"><div><h3>{product.name}</h3><small>{product.sku} · Stock actual {quantity.format(product.currentStock)} {product.unit}</small></div><button aria-label={`Quitar ${product.name}`} className="icon-button icon-button-danger" onClick={() => setLines((current) => current.filter((line) => line.product.id !== product.id))} title="Quitar artículo" type="button"><Trash2 size={17} aria-hidden="true" /></button></div>
            <div className="direct-purchase-line-fields">
              {([
                ["quantity", "Cantidad recibida"], ["cost", "Costo unitario ($)"], ["retail", "Precio minorista ($)"], ["wholesale", "Precio mayorista ($)"],
              ] as const).map(([field, label]) => <label className="field-label" key={field}>
                <span>{label}</span>
                <input aria-label={`${label} de ${product.name}`} aria-describedby={parsed.errors[field] ? `${product.id}-${field}-error` : undefined} aria-invalid={Boolean(parsed.errors[field])}
                  autoComplete="off" className="field-input" inputMode="decimal" maxLength={20}
                  onBlur={() => {
                    if (field === "quantity") return;
                    const amount = field === "cost" ? parsed.cost : field === "retail" ? parsed.retail : parsed.wholesale;
                    if (amount !== null) changeField(product.id, field, formatPriceInput(amount));
                  }}
                  onChange={(event) => changeField(product.id, field, event.target.value)} onFocus={(event) => event.currentTarget.select()}
                  placeholder={field === "wholesale" ? "Sin cargar" : "0"} required={field !== "wholesale"} type="text" value={fields[field]}
                />
                {parsed.errors[field] ? <small className="form-error" id={`${product.id}-${field}-error`}>{parsed.errors[field]}</small> : null}
              </label>)}
            </div>
            <div className="direct-purchase-line-total"><span>Stock estimado luego del ingreso: <strong>{quantity.format(product.currentStock + (parsed.quantity ?? 0))} {product.unit}</strong></span><span>Subtotal <strong>{ars.format((parsed.quantity ?? 0) * (parsed.cost ?? 0))}</strong></span></div>
          </article>)}
        </div>
      </section>
      <label className="field-label">Observación<textarea className="field-textarea" maxLength={500} name="notes" onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} /></label>
    </fieldset>
    <input name="items" type="hidden" value={JSON.stringify(items)} />
    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state.currentPrices?.length ? <button className="button button-secondary" disabled={pending} onClick={() => {
      if (!window.confirm("Se conservarán los artículos y cantidades, pero los precios de la carga se reemplazarán por los actuales. ¿Continuar?")) return;
      const latest = new Map(state.currentPrices?.map((product) => [product.id, product]));
      setLines((current) => current.map((line) => {
        const product = latest.get(line.product.id);
        return product ? { product: { ...line.product, ...product }, fields: { ...line.fields, cost: formatPriceInput(product.costPrice), retail: formatPriceInput(product.retailPrice), wholesale: formatPriceInput(product.wholesalePrice) } } : line;
      }));
    }} type="button">Recargar precios actuales</button> : null}
    {totalOutOfRange ? <p className="form-error">El total de compra supera el máximo permitido.</p> : null}
    <footer className="direct-purchase-footer">
      <div><small>Total de compra · {lines.length} {lines.length === 1 ? "producto" : "productos"}</small><strong>{ars.format(total)}</strong></div>
      <button className="button button-primary" disabled={!ready || pending || !supplierId || !valid || totalOutOfRange || documentDate > today || !documentDate} type="submit">{pending ? <LoaderCircle className="animate-spin" size={18} aria-hidden="true" /> : <PackageCheck size={18} aria-hidden="true" />}{pending ? "Registrando ingreso..." : "Guardar e ingresar stock"}</button>
    </footer>
  </form>;
}

export function DirectPurchaseEntry(props: Props) {
  const [version, setVersion] = useState(0);
  return <DirectPurchaseEditor {...props} key={version} onNew={() => setVersion((current) => current + 1)} />;
}
