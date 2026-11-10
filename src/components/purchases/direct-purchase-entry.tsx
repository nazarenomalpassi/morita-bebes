"use client";

import { Check, LoaderCircle, PackageCheck, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { loadInventoryEntryAction, type PurchaseActionState } from "@/app/app/compras/actions";
import { ars, quantity } from "@/lib/format";
import { formatPriceInput } from "@/lib/inventory/prices";
import { entryIdentifierConflict, entryNewProductSchema, entryProductUnits, filterPurchaseProducts, inventoryEntryItemsSchema, parseDirectPurchaseFields, type DirectPurchaseFields, type EntryNewProductFields, type InventoryEntryItem } from "@/lib/purchases/direct-entry";
import { normalizeProductIdentifier, productIdentifierWarning } from "@/lib/product-identifiers";
import { useSubmissionState } from "@/lib/ui/use-submission-state";
import type { PurchaseProduct } from "./purchase-types";
import "./direct-purchase-entry.css";

const subscribe = () => () => {};
type Props = { products: PurchaseProduct[] };
type Line = { product: PurchaseProduct; fields: DirectPurchaseFields; newProduct?: EntryNewProductFields };

function NewProductFields({ value, onChange }: { value: EntryNewProductFields; onChange: (value: EntryNewProductFields) => void }) {
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);
  const warning = productIdentifierWarning(value.barcode) ?? productIdentifierWarning(value.sku);
  return <div className="direct-purchase-new-fields">
    <label className="field-label">Nombre del nuevo producto<input className="field-input" maxLength={180} minLength={2} onChange={(event) => onChange({ ...value, name: event.target.value })} ref={nameRef} required value={value.name} /></label>
    <label className="field-label">SKU / código interno<input autoComplete="off" className="field-input" maxLength={80} onBlur={() => onChange({ ...value, sku: normalizeProductIdentifier(value.sku) })} onChange={(event) => onChange({ ...value, sku: event.target.value })} required type="text" value={value.sku} /></label>
    <label className="field-label">Código de barras<input autoComplete="off" className="field-input" maxLength={80} onBlur={() => onChange({ ...value, barcode: normalizeProductIdentifier(value.barcode) })} onChange={(event) => onChange({ ...value, barcode: event.target.value })} type="text" value={value.barcode} /></label>
    <label className="field-label">Unidad de medida<select className="field-input" onChange={(event) => onChange({ ...value, unit: event.target.value as EntryNewProductFields["unit"] })} value={value.unit}>{entryProductUnits.map((unit) => <option key={unit} value={unit}>{unit.charAt(0).toUpperCase() + unit.slice(1)}</option>)}</select></label>
    {warning ? <p className="form-error direct-purchase-code-warning">{warning}</p> : null}
  </div>;
}

function DirectPurchaseEditor({ products, onNew }: Props & { onNew: () => void }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const requestId = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [state, action, pending] = useSubmissionState<PurchaseActionState, FormData>(async (previous, formData) => {
    requestId.current ??= crypto.randomUUID();
    formData.set("request_id", requestId.current);
    try {
      return await loadInventoryEntryAction(previous, formData);
    } catch {
      return { error: "No pudimos confirmar la carga. Conservamos el detalle; revisá tu conexión y volvé a intentar." };
    }
  }, {});
  const results = useMemo(() => filterPurchaseProducts(products, search).slice(0, 8), [products, search]);
  const parsedLines = lines.map((line) => ({ ...line, parsed: parseDirectPurchaseFields(line.fields),
    newParsed: line.newProduct ? entryNewProductSchema.safeParse(line.newProduct) : null,
    conflict: line.newProduct ? entryIdentifierConflict(line.newProduct, [...products, ...lines.filter((other) => other.newProduct && other.product.id !== line.product.id).map((other) => other.product)]) : null,
  }));
  const valid = lines.length > 0 && parsedLines.every((line) => line.parsed.valid && !line.conflict && (!line.newParsed || line.newParsed.success));
  const total = parsedLines.reduce((sum, line) => sum + (line.parsed.quantity ?? 0) * (line.parsed.cost ?? 0), 0);
  const totalOutOfRange = total > 999_999_999_999.99;
  const units = parsedLines.reduce((sum, line) => sum + (line.parsed.quantity ?? 0), 0);
  const items: InventoryEntryItem[] = valid ? parsedLines.map(({ product, parsed, newParsed }) => ({
    product_id: product.id, quantity: parsed.quantity!, unit_cost: parsed.cost!,
    retail_price: parsed.retail!, wholesale_price: parsed.wholesale,
    original_cost_price: product.costPrice, original_retail_price: product.retailPrice, original_wholesale_price: product.wholesalePrice,
    ...(newParsed?.success ? { new_product: newParsed.data } : {}),
  })) : [];
  const canSave = valid && !totalOutOfRange && inventoryEntryItemsSchema.safeParse(items).success;

  useEffect(() => {
    if (!lines.length || state.entryId) return;
    const confirmLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [lines.length, state.entryId]);

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

  function addNewProduct() {
    if (pending || lines.length >= 500) return;
    const product: PurchaseProduct = { id: crypto.randomUUID(), name: "Nuevo producto", sku: "", barcode: null, unit: "unidad", currentStock: 0, costPrice: 0, retailPrice: 0, wholesalePrice: null, minStock: 0, targetStock: null, needsRestock: false, supplierId: null, supplierName: null };
    setLines((current) => [...current, { product, newProduct: { name: "", sku: "", barcode: "", unit: "unidad" }, fields: { quantity: "1", cost: "0", retail: "0", wholesale: "" } }]);
    setSearch("");
  }

  if (state.entryId) return <section className="direct-purchase-success">
    <span className="entity-avatar"><PackageCheck size={24} aria-hidden="true" /></span>
    <div role="status"><h2>Ingreso de mercadería registrado</h2><p>{state.message}</p></div>
    <dl><div><dt>Productos</dt><dd>{lines.length}</dd></div><div><dt>Productos nuevos</dt><dd>{lines.filter((line) => line.newProduct).length}</dd></div><div><dt>Unidades ingresadas</dt><dd>{quantity.format(units)}</dd></div><div><dt>Valor a costo</dt><dd>{ars.format(total)}</dd></div></dl>
    <div className="direct-purchase-actions"><Link className="button button-primary" href="/app/productos">Ver inventario</Link><button className="button button-secondary" onClick={onNew} type="button"><Plus size={17} aria-hidden="true" /> Cargar otro ingreso</button></div>
  </section>;

  return <form action={action} className="direct-purchase-form" onKeyDown={(event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  }}>
    <fieldset className="direct-purchase-fields" disabled={pending || !ready}>
      <section className="direct-purchase-search" aria-label="Buscar artículos recibidos">
        <div className="direct-purchase-search-tools">
        <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">Buscar artículo</span><input
          autoComplete="off" maxLength={100} onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); document.querySelector<HTMLButtonElement>(".direct-purchase-results button:not(:disabled)")?.focus(); }
            if (event.key === "Enter" && results.length === 1) { event.preventDefault(); addProduct(results[0]); }
            if (event.key === "Escape") setSearch("");
          }} placeholder="Nombre, SKU o código" ref={searchRef} type="search" value={search}
        /></label>
        <button className="button button-secondary" disabled={lines.length >= 500} onClick={addNewProduct} type="button"><Plus size={17} aria-hidden="true" /> Cargar nuevo producto</button>
        </div>
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
        <div className="section-heading-row"><h2>Mercadería a ingresar</h2><span className="tag">{lines.length} {lines.length === 1 ? "producto" : "productos"}</span></div>
        {!lines.length ? <div className="empty-state direct-purchase-empty"><PackagePlus size={28} aria-hidden="true" /><p>Sin artículos cargados</p></div> : null}
        <div className="direct-purchase-lines">
          {parsedLines.map(({ product, fields, parsed, newProduct, conflict }) => <article className="direct-purchase-line" data-new-product={Boolean(newProduct)} data-product-id={product.id} key={product.id}>
            <div className="direct-purchase-line-head"><div><h3>{product.name}</h3><small>{product.sku} · Stock actual {quantity.format(product.currentStock)} {product.unit}</small></div><button aria-label={`Quitar ${product.name}`} className="icon-button icon-button-danger" onClick={() => setLines((current) => current.filter((line) => line.product.id !== product.id))} title="Quitar artículo" type="button"><Trash2 size={17} aria-hidden="true" /></button></div>
            {newProduct ? <><span className="tag direct-purchase-new-tag">Nuevo producto</span><NewProductFields value={newProduct} onChange={(value) => setLines((current) => current.map((line) => line.product.id === product.id ? { ...line, newProduct: value, product: { ...line.product, name: value.name.trim() || "Nuevo producto", sku: normalizeProductIdentifier(value.sku), barcode: normalizeProductIdentifier(value.barcode) || null, unit: value.unit } } : line))} /></> : null}
            {conflict ? <p className="form-error">Este código ya pertenece a {conflict}. Buscá ese producto o ingresá otro código.</p> : null}
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
    {totalOutOfRange ? <p className="form-error">El valor de la mercadería supera el máximo permitido.</p> : null}
    <footer className="direct-purchase-footer">
      <div><small>Valor a costo · {lines.length} {lines.length === 1 ? "producto" : "productos"}</small><strong>{ars.format(total)}</strong></div>
      <button className="button button-primary" disabled={!ready || pending || !canSave} type="submit">{pending ? <LoaderCircle className="animate-spin" size={18} aria-hidden="true" /> : <PackageCheck size={18} aria-hidden="true" />}{pending ? "Registrando ingreso..." : "Guardar e ingresar stock"}</button>
    </footer>
  </form>;
}

export function DirectPurchaseEntry(props: Props) {
  const [version, setVersion] = useState(0);
  return <DirectPurchaseEditor {...props} key={version} onNew={() => setVersion((current) => current + 1)} />;
}
