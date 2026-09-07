import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CircleOff,
  ImagePlus,
  Pencil,
  Power,
  PowerOff,
  Truck,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ProductSupplierForm } from "@/components/inventory/product-supplier-form";
import { StockMovementForm } from "@/components/inventory/stock-movement-form";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveStoreImage } from "@/lib/store/images";
import type { Database } from "@/types/database";

import {
  createStockMovementAction,
  toggleProductStatusAction,
  updateProductSupplierAction,
} from "../actions";
import { deleteProductImageAction, reorderProductImageAction, setPrimaryProductImageAction, uploadProductImageAction } from "../../tienda/actions";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("es-AR", { currency: "ARS", maximumFractionDigits: 2, style: "currency" });
const quantity = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });
const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });
const kindLabels: Record<Database["public"]["Enums"]["inventory_movement_kind"], string> = {
  adjustment: "Ajuste",
  initial: "Stock inicial",
  loss: "Salida / pérdida",
  purchase: "Entrada",
  return_in: "Devolución recibida",
  return_out: "Devolución entregada",
  sale: "Venta",
};

export default async function ProductDetailPage({ params }: PageProps<"/app/productos/[id]">) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/app");

  const [product, movements, suppliers, images] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, sku, barcode, description, cost_price, retail_price, wholesale_price, wholesale_min_quantity, current_stock, min_stock, target_stock, needs_restock, unit, is_active, is_published, store_slug, default_supplier_id, categories(name), brands(name), suppliers(id, business_name)")
      .eq("id", id)
      .eq("organization_id", organization.id)
      .maybeSingle(),
    supabase
      .from("inventory_movements")
      .select("id, kind, quantity_delta, unit_cost, notes, occurred_at")
      .eq("organization_id", organization.id)
      .eq("product_id", id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase
      .from("suppliers")
      .select("id, business_name")
      .eq("organization_id", organization.id)
      .eq("is_active", true)
      .order("business_name"),
    supabase.from("product_images").select("id, storage_path, alt_text, sort_order, is_primary").eq("organization_id", organization.id).eq("product_id", id).order("sort_order"),
  ]);
  if (product.error || movements.error || suppliers.error || images.error) {
    throw new Error("No se pudo cargar el producto.");
  }
  if (!product.data) notFound();
  const productData = product.data;

  const movementAction = createStockMovementAction.bind(null, id);
  const supplierAction = updateProductSupplierAction.bind(null, id);
  const toggleAction = toggleProductStatusAction.bind(null, id);

  return (
    <div className="page-container">
      <Link className="inline-flex items-center gap-2 text-sm font-bold text-[var(--plum)] no-underline hover:underline" href="/app/productos">
        <ArrowLeft size={17} /> Volver a productos
      </Link>
      <header className="page-header mt-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">{product.data.categories?.name ?? "Sin categoría"}</span>
            {!product.data.is_active ? <span className="table-status text-[var(--ink-muted)]"><CircleOff size={14} /> Inactivo</span> : null}
          </div>
          <h1 className="page-title mt-2">{product.data.name}</h1>
          <p className="page-lead">SKU {product.data.sku}{product.data.brands?.name ? ` · ${product.data.brands.name}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
            <form action={toggleAction}>
              <button className="button button-secondary gap-2" type="submit">
                {product.data.is_active ? <PowerOff size={17} /> : <Power size={17} />}
                {product.data.is_active ? "Dar de baja" : "Reactivar"}
              </button>
            </form>
            <Link className="button button-primary gap-2" href={`/app/productos/${id}/editar`}><Pencil size={17} /> Editar</Link>
        </div>
      </header>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Resumen del producto">
        <div className="stat-card"><span className="text-xs font-bold text-[var(--ink-muted)]">Stock actual</span><strong>{quantity.format(Number(product.data.current_stock))} <small className="text-sm font-medium">{product.data.unit}</small></strong></div>
        <div className="stat-card"><span className="text-xs font-bold text-[var(--ink-muted)]">Stock mínimo</span><strong>{quantity.format(Number(product.data.min_stock))}</strong></div>
        <div className="stat-card"><span className="text-xs font-bold text-[var(--ink-muted)]">Stock objetivo</span><strong>{product.data.target_stock === null ? "Pendiente" : quantity.format(Number(product.data.target_stock))}</strong></div>
        <div className="stat-card"><span className="text-xs font-bold text-[var(--ink-muted)]">Precio minorista</span><strong>{money.format(Number(product.data.retail_price))}</strong></div>
        <div className="stat-card"><span className="text-xs font-bold text-[var(--ink-muted)]">Costo</span><strong>{money.format(Number(product.data.cost_price))}</strong></div>
      </section>

      {product.data.needs_restock && product.data.is_active ? (
        <div className="mt-4 flex items-start gap-3 rounded-[8px] border border-[#e9c7ca] bg-[#f9e8e8] px-4 py-3 text-sm text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <p>
            <strong>Este producto necesita reposición.</strong>{" "}
            {product.data.suppliers ? <>El proveedor asignado es <Link className="font-bold underline" href={`/app/proveedores/${product.data.suppliers.id}/editar`}>{product.data.suppliers.business_name}</Link>.</> : <>Asignale un proveedor para incluirlo luego en pedidos automáticos.</>}
          </p>
        </div>
      ) : null}

      <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.35fr)]">
        <section aria-labelledby="product-data-heading">
          <div className="border-b border-[var(--line)] pb-3">
            <h2 className="text-base font-bold" id="product-data-heading">Datos comerciales</h2>
          </div>
          <ProductSupplierForm
            action={supplierAction}
            currentSupplierId={product.data.default_supplier_id}
            suppliers={suppliers.data ?? []}
          />
          <dl className="divide-y divide-[var(--line)] text-sm">
            <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--ink-muted)]">Código de barras</dt><dd className="text-right font-semibold">{product.data.barcode ?? "Sin cargar"}</dd></div>
            <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--ink-muted)]">Precio mayorista</dt><dd className="text-right font-semibold">{product.data.wholesale_price === null ? "Sin cargar" : money.format(Number(product.data.wholesale_price))}</dd></div>
            <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--ink-muted)]">Mínimo mayorista</dt><dd className="text-right font-semibold">{quantity.format(Number(product.data.wholesale_min_quantity))}</dd></div>
          </dl>
          {product.data.description ? <p className="mt-4 text-sm leading-6 text-[var(--ink-muted)]">{product.data.description}</p> : null}
        </section>

        <section aria-labelledby="movement-heading">
            <div className="border-b border-[var(--line)] pb-3">
              <h2 className="text-base font-bold" id="movement-heading">Registrar movimiento</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Cada cambio queda asentado en el historial y actualiza el stock.</p>
            </div>
            <div className="mt-4"><StockMovementForm action={movementAction} /></div>
        </section>
      </div>

      {organization.role !== "staff" ? <section className="product-store-gallery" aria-labelledby="store-gallery-heading">
        <div className="section-heading-row"><div><span className="eyebrow">Tienda online</span><h2 id="store-gallery-heading">Galería del producto</h2><p>Subí imágenes, elegí la portada y administrá la publicación desde el mismo producto.</p></div>{product.data.is_published ? <a className="button button-secondary" href={`/tienda/productos/${product.data.store_slug}`} rel="noreferrer" target="_blank">Ver publicación</a> : <span className="table-status">No publicado</span>}</div>
        <div className="product-store-gallery-grid">
          {images.data?.map((image) => <article className={image.is_primary ? "is-primary" : ""} key={image.id}><div><Image alt={image.alt_text ?? productData.name} fill sizes="220px" src={resolveStoreImage(image.storage_path)!} />{image.is_primary ? <span>Portada</span> : null}</div><div>{!image.is_primary ? <form action={setPrimaryProductImageAction}><input name="product_id" type="hidden" value={id} /><input name="image_id" type="hidden" value={image.id} /><button className="button button-secondary" type="submit">Usar como portada</button></form> : <strong>Imagen principal</strong>}<form action={reorderProductImageAction}><input name="product_id" type="hidden" value={id} /><input name="image_id" type="hidden" value={image.id} /><button aria-label="Mover antes" className="icon-button" name="direction" title="Mover antes" type="submit" value="-1"><ArrowUp /></button><button aria-label="Mover después" className="icon-button" name="direction" title="Mover después" type="submit" value="1"><ArrowDown /></button></form><form action={deleteProductImageAction}><input name="product_id" type="hidden" value={id} /><input name="image_id" type="hidden" value={image.id} /><button aria-label="Eliminar imagen" className="icon-button danger-icon" type="submit"><Trash2 /></button></form></div></article>)}
          <form action={uploadProductImageAction} className="product-store-upload"><ImagePlus /><strong>Agregar imagen</strong><input name="product_id" type="hidden" value={id} /><label className="field-label">Archivo<input accept="image/avif,image/jpeg,image/png,image/webp" className="field-input" name="image" required type="file" /></label><label className="field-label">Texto alternativo<input className="field-input" defaultValue={product.data.name} name="alt_text" /></label><button className="button button-primary" type="submit">Subir imagen</button></form>
        </div>
      </section> : null}

      <section className="mt-12" aria-labelledby="history-heading">
        <div className="border-b border-[var(--line)] pb-3">
          <h2 className="text-base font-bold" id="history-heading">Historial de inventario</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Últimos 100 movimientos.</p>
        </div>
        {movements.data?.length ? (
          <div className="data-table-wrap mt-4" data-mobile-cards>
            <table className="data-table min-w-[46rem]">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Costo unitario</th><th>Detalle</th></tr></thead>
              <tbody>
                {movements.data.map((movement) => {
                  const delta = Number(movement.quantity_delta);
                  return (
                    <tr key={movement.id}>
                      <td data-label="Fecha">{dateTime.format(new Date(movement.occurred_at))}</td>
                      <td data-label="Tipo">{kindLabels[movement.kind]}</td>
                      <td data-label="Cantidad"><span className={`inline-flex items-center gap-1 font-bold ${delta > 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{delta > 0 ? <ArrowUp size={15} /> : <ArrowDown size={15} />}{delta > 0 ? "+" : ""}{quantity.format(delta)}</span></td>
                      <td data-label="Costo unitario">{movement.unit_cost === null ? "—" : money.format(Number(movement.unit_cost))}</td>
                      <td data-label="Detalle">{movement.notes ?? "Sin detalle"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 flex min-h-36 items-center justify-center gap-3 rounded-[8px] border border-dashed border-[var(--line)] bg-white/60 px-4 text-sm text-[var(--ink-muted)]"><Truck size={20} /> Todavía no hay movimientos registrados.</div>
        )}
      </section>
    </div>
  );
}
