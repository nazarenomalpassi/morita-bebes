"use client";

import { Check, Eye, RefreshCw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { classifyProductsAction, updateBatchPricesAction } from "@/app/app/productos/actions";
import { ars } from "@/lib/format";
import { calculateBatchPrices, priceChangesSchema, productPriceWarnings, type PriceChange } from "@/lib/inventory/batch-prices";
import type { ProductPrices } from "@/lib/inventory/prices";
import { useSubmissionState } from "@/lib/ui/use-submission-state";
import { initialInventoryActionState, type InventoryActionState } from "./action-state";

type Product = { id: string; name: string; sku: string; cost_price: number; retail_price: number; wholesale_price: number | null; categories: { name: string } | null; brands: { name: string } | null };
type Option = { id: string; name: string };
const priceLabels = { costPrice: "Costo", retailPrice: "Minorista", wholesalePrice: "Mayorista" } as const;
export function ProductBatchTools({ products, categories, brands }: { products: Product[]; categories: Option[]; brands: Option[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"prices" | "classification">("prices");
  const [selected, setSelected] = useState<string[]>([]);
  const [fields, setFields] = useState<(keyof ProductPrices)[]>(["retailPrice"]);
  const [percent, setPercent] = useState("");
  const [rounding, setRounding] = useState(0);
  const [category, setCategory] = useState("keep"), [brand, setBrand] = useState("keep");
  const [preview, setPreview] = useState<PriceChange[] | null>(null);
  const [classificationPreview, setClassificationPreview] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [state, action, pending] = useSubmissionState(async (previous: InventoryActionState, data: FormData) => {
    try {
      const result = await (mode === "prices" ? updateBatchPricesAction : classifyProductsAction)(previous, data);
      if (result.status === "success") { setPreview(null); setClassificationPreview(false); setSelected([]); }
      return result;
    } catch { return { status: "error" as const, message: "No pudimos confirmar la operación. Revisá los valores actuales antes de reintentar." }; }
  }, initialInventoryActionState);
  const rows = products.filter((product) => selected.includes(product.id));
  const warnings = preview?.filter((item) => productPriceWarnings({ costPrice: item.original_cost_price, retailPrice: item.original_retail_price, wholesalePrice: item.original_wholesale_price }, { costPrice: item.cost_price, retailPrice: item.retail_price, wholesalePrice: item.wholesale_price }).length).length ?? 0;
  function invalidate() { setPreview(null); setClassificationPreview(false); setAcknowledged(false); setError(""); }
  function buildPreview() {
    if (!rows.length) { setError("Seleccioná al menos un producto de esta página."); return; }
    if (mode === "classification") {
      if (category === "keep" && brand === "keep") { setError("Elegí una categoría o marca a modificar."); return; }
      setClassificationPreview(true); return;
    }
    const percentage = Number(percent.replace(",", "."));
    if (!/^-?\d+(?:[,.]\d{1,2})?$/.test(percent) || !Number.isFinite(percentage) || percentage < -100 || percentage > 1000 || !fields.length) { setError("Ingresá una variación entre -100% y 1000% y seleccioná qué precios cambiar."); return; }
    const changes = rows.map((product) => {
      const next = calculateBatchPrices({ costPrice: Number(product.cost_price), retailPrice: Number(product.retail_price), wholesalePrice: product.wholesale_price === null ? null : Number(product.wholesale_price) }, fields, percentage, rounding);
      return { product_id: product.id, cost_price: next.costPrice, retail_price: next.retailPrice, wholesale_price: next.wholesalePrice, original_cost_price: Number(product.cost_price), original_retail_price: Number(product.retail_price), original_wholesale_price: product.wholesale_price === null ? null : Number(product.wholesale_price) };
    });
    if (!priceChangesSchema.safeParse(changes).success) { setError("La variación genera importes fuera del rango permitido."); return; }
    setPreview(changes); setError("");
  }
  return <details className="catalog-maintenance"><summary>Actualizar precios o clasificación por tandas</summary><form onSubmit={(event) => { if (!(mode === "prices" ? preview : classificationPreview)) event.preventDefault(); }} onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }} action={action}>
    <fieldset disabled={pending}>
      <div aria-label="Tipo de actualización" className="segmented-control mt-4" role="radiogroup">{([ ["prices", "Precios"], ["classification", "Clasificación"] ] as const).map(([value, label]) => <label className={mode === value ? "is-selected" : ""} key={value}><input checked={mode === value} name="catalog-update-mode" onChange={() => { invalidate(); setMode(value); }} type="radio" value={value} />{label}</label>)}</div>
      <div className="form-grid"><label className="check-field form-span-2"><input checked={selected.length === products.length && products.length > 0} onChange={(event) => { invalidate(); setSelected(event.target.checked ? products.map((product) => product.id) : []); }} type="checkbox" />Seleccionar esta página ({products.length} productos)</label>
        {products.map((product) => <label className="check-field" key={product.id}><input checked={selected.includes(product.id)} onChange={(event) => { invalidate(); setSelected((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id)); }} type="checkbox" /><span>{product.name}<small className="block text-[var(--ink-muted)]">{product.sku}</small></span></label>)}
      </div>
      {mode === "prices" ? <div className="form-grid"><label className="field-label">Variación (%)<input autoComplete="off" className="field-input" inputMode="decimal" maxLength={10} onChange={(event) => { invalidate(); setPercent(event.target.value); }} placeholder="Ej. 10" type="text" value={percent} /></label><label className="field-label">Redondeo<select className="field-input" onChange={(event) => { invalidate(); setRounding(Number(event.target.value)); }} value={rounding}><option value={0}>Conservar centavos</option><option value={1}>Al peso</option><option value={10}>A $10</option><option value={100}>A $100</option></select></label><fieldset className="form-span-2"><legend className="field-label">Precios a modificar</legend><div className="catalog-batch-actions">{Object.entries(priceLabels).map(([key, label]) => <label className="check-field" key={key}><input checked={fields.includes(key as keyof ProductPrices)} onChange={(event) => { invalidate(); setFields((current) => event.target.checked ? [...current, key as keyof ProductPrices] : current.filter((field) => field !== key)); }} type="checkbox" />{label}</label>)}</div></fieldset></div> : <div className="form-grid"><label className="field-label">Categoría<select className="field-input" onChange={(event) => { invalidate(); setCategory(event.target.value); }} value={category}><option value="keep">No cambiar</option><option value="">Sin categoría</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field-label">Marca<select className="field-input" onChange={(event) => { invalidate(); setBrand(event.target.value); }} value={brand}><option value="keep">No cambiar</option><option value="">Sin marca</option>{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>}
      <div className="catalog-batch-actions"><span>{selected.length} seleccionados</span><button className="button button-secondary" onClick={buildPreview} type="button"><Eye size={16} /> Ver cambios antes de guardar</button></div>
      <input name="product_ids" type="hidden" value={JSON.stringify(selected)} /><input name="changes" type="hidden" value={JSON.stringify(preview)} /><input name="category_id" type="hidden" value={category} /><input name="brand_id" type="hidden" value={brand} />
      {preview ? <div className="data-table-wrap" data-mobile-cards><table className="data-table"><thead><tr><th>Producto</th><th>Costo anterior → nuevo</th><th>Minorista anterior → nuevo</th><th>Mayorista anterior → nuevo</th></tr></thead><tbody>{preview.map((item) => <tr key={item.product_id}><td data-label="Producto">{products.find((product) => product.id === item.product_id)?.name}</td><td data-label="Costo">{ars.format(item.original_cost_price)} → {ars.format(item.cost_price)}</td><td data-label="Minorista">{ars.format(item.original_retail_price)} → {ars.format(item.retail_price)}</td><td data-label="Mayorista">{item.original_wholesale_price === null ? "Sin cargar" : ars.format(item.original_wholesale_price)} → {item.wholesale_price === null ? "Sin cargar" : ars.format(item.wholesale_price)}</td></tr>)}</tbody></table></div> : null}
      {classificationPreview ? <div className="form-info"><strong>{rows.length} productos seleccionados</strong><p>Categoría: {category === "keep" ? "Sin cambios" : categories.find((item) => item.id === category)?.name ?? "Sin categoría"}</p><p>Marca: {brand === "keep" ? "Sin cambios" : brands.find((item) => item.id === brand)?.name ?? "Sin marca"}</p></div> : null}
      {warnings > 0 ? <div className="form-info" role="status"><p>{warnings} productos presentan variaciones de 50% o más, costo cero o precios menores al costo.</p><label className="check-field"><input checked={acknowledged} name="acknowledge_price_warning" onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" />Revisé los importes de la vista previa</label></div> : null}
      {error || state.message ? <p className={error || state.status === "error" ? "form-error" : "form-success"} role="status">{error || state.message}</p> : null}
      {state.status === "error" ? <button className="button button-secondary" onClick={() => { invalidate(); router.refresh(); }} type="button"><RefreshCw size={16} /> Recargar lista</button> : null}
      {preview || classificationPreview ? <div className="catalog-batch-actions"><label className="field-label">Motivo (opcional)<input className="field-input" maxLength={500} name="reason" /></label><button className="button button-primary" disabled={pending || Boolean(warnings && !acknowledged)} type="submit"><Save size={17} />{pending ? "Guardando..." : `Confirmar cambios en ${rows.length} productos`}</button><button className="button button-ghost" onClick={invalidate} type="button"><Check size={16} /> Volver a revisar</button></div> : null}
    </fieldset>
  </form></details>;
}
