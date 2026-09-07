"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import type { InventoryActionState } from "./action-state";
import { initialInventoryActionState } from "./action-state";
import { ActionFeedback, FieldError } from "./action-feedback";
import { BarcodeInput } from "./barcode-input";
import { SubmitButton } from "./submit-button";

type Option = { id: string; is_active?: boolean; name: string };
type SupplierOption = { business_name: string; id: string; is_active?: boolean };

export type ProductFormValue = {
  barcode: string | null;
  brand_id: string | null;
  category_id: string | null;
  commercial_description: string | null;
  cost_price: number;
  default_supplier_id: string | null;
  description: string | null;
  image_path: string | null;
  is_featured: boolean;
  is_published: boolean;
  hide_when_out_of_stock: boolean;
  current_stock: number;
  min_stock: number;
  target_stock: number | null;
  name: string;
  retail_price: number;
  sku: string;
  seo_description: string | null;
  seo_title: string | null;
  store_slug: string;
  unit: string;
  wholesale_min_quantity: number;
  wholesale_price: number | null;
};

type ProductAction = (
  state: InventoryActionState,
  formData: FormData,
) => Promise<InventoryActionState>;

function Field({
  children,
  label,
  name,
  state,
}: {
  children: React.ReactNode;
  label: string;
  name: string;
  state: InventoryActionState;
}) {
  return (
    <label className="block min-w-0">
      <span className="field-label mb-1.5">{label}</span>
      {children}
      <FieldError name={name} state={state} />
    </label>
  );
}

export function ProductForm({
  action,
  brands,
  categories,
  product,
  suppliers,
}: {
  action: ProductAction;
  brands: Option[];
  categories: Option[];
  product?: ProductFormValue;
  suppliers: SupplierOption[];
}) {
  const [state, formAction] = useActionState(action, initialInventoryActionState);
  const editing = Boolean(product);

  return (
    <form action={formAction} className="mt-8 space-y-9">
      <ActionFeedback state={state} />

      <section aria-labelledby="product-basic-heading">
        <div className="border-b border-[var(--line)] pb-3">
          <h2 className="text-base font-bold" id="product-basic-heading">Identificación</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Los datos usados para encontrar el producto en ventas e inventario.</p>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Nombre del producto *" name="name" state={state}>
            <input className="field-input" defaultValue={product?.name} maxLength={180} name="name" required />
          </Field>
          <Field label="SKU / código interno *" name="sku" state={state}>
            <input autoCapitalize="characters" className="field-input" defaultValue={product?.sku} maxLength={80} name="sku" required />
          </Field>
          <Field label="Código de barras" name="barcode" state={state}>
            <BarcodeInput defaultValue={product?.barcode} />
          </Field>
          <Field label="Unidad de medida *" name="unit" state={state}>
            <select className="field-input" defaultValue={product?.unit ?? "unidad"} name="unit" required>
              <option value="unidad">Unidad</option>
              <option value="paquete">Paquete</option>
              <option value="caja">Caja</option>
              <option value="bolsa">Bolsa</option>
              <option value="kit">Kit</option>
              <option value="par">Par</option>
              <option value="litro">Litro</option>
              <option value="kilogramo">Kilogramo</option>
            </select>
          </Field>
          <Field label="Descripción" name="description" state={state}>
            <textarea className="field-textarea min-h-28" defaultValue={product?.description ?? ""} maxLength={2000} name="description" />
          </Field>
          <Field label="Imagen (URL o ruta)" name="image_path" state={state}>
            <input className="field-input" defaultValue={product?.image_path ?? ""} maxLength={500} name="image_path" placeholder="Se puede completar más adelante" />
          </Field>
        </div>
      </section>

      <section aria-labelledby="product-store-heading">
        <div className="border-b border-[var(--line)] pb-3">
          <h2 className="text-base font-bold" id="product-store-heading">Publicación en tienda online</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Controlá cómo se presenta el producto sin duplicarlo ni afectar el inventario.</p>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Descripción comercial" name="commercial_description" state={state}>
            <textarea className="field-textarea min-h-28" defaultValue={product?.commercial_description ?? ""} maxLength={4000} name="commercial_description" placeholder="Descripción clara para el cliente" />
          </Field>
          <div className="grid content-start gap-3">
            <label className="toggle-row"><input defaultChecked={product?.is_published ?? false} name="is_published" type="checkbox" /><span><strong>Publicado en tienda</strong><small>Visible en el catálogo público.</small></span></label>
            <label className="toggle-row"><input defaultChecked={product?.is_featured ?? false} name="is_featured" type="checkbox" /><span><strong>Producto destacado</strong><small>Prioriza su aparición en el Home y catálogo.</small></span></label>
            <label className="toggle-row"><input defaultChecked={product?.hide_when_out_of_stock ?? false} name="hide_when_out_of_stock" type="checkbox" /><span><strong>Ocultar si no tiene stock</strong><small>Si se desmarca, seguirá visible como “Sin stock”.</small></span></label>
          </div>
          <Field label="URL amigable" name="store_slug" state={state}>
            <input className="field-input" defaultValue={product?.store_slug ?? ""} maxLength={220} name="store_slug" placeholder="Se genera automáticamente" />
          </Field>
          <Field label="Título SEO" name="seo_title" state={state}>
            <input className="field-input" defaultValue={product?.seo_title ?? ""} maxLength={70} name="seo_title" placeholder="Opcional" />
          </Field>
          <label className="block min-w-0 md:col-span-2">
            <span className="field-label mb-1.5">Descripción SEO</span>
            <textarea className="field-textarea" defaultValue={product?.seo_description ?? ""} maxLength={180} name="seo_description" placeholder="Resumen para buscadores, hasta 180 caracteres" />
          </label>
        </div>
      </section>

      <section aria-labelledby="product-classification-heading">
        <div className="border-b border-[var(--line)] pb-3">
          <h2 className="text-base font-bold" id="product-classification-heading">Clasificación y compra</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">El proveedor predeterminado habilita luego los pedidos automáticos por faltantes.</p>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Categoría" name="category_id" state={state}>
            <select className="field-input" defaultValue={product?.category_id ?? ""} name="category_id">
              <option value="">Sin categoría</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.is_active === false ? " (inactiva)" : ""}</option>)}
            </select>
          </Field>
          <Field label="Marca" name="brand_id" state={state}>
            <select className="field-input" defaultValue={product?.brand_id ?? ""} name="brand_id">
              <option value="">Sin marca</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}{brand.is_active === false ? " (inactiva)" : ""}</option>)}
            </select>
          </Field>
          <Field label="Proveedor predeterminado" name="default_supplier_id" state={state}>
            <select className="field-input" defaultValue={product?.default_supplier_id ?? ""} name="default_supplier_id">
              <option value="">Pendiente de completar</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.business_name}{supplier.is_active === false ? " (inactivo)" : ""}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section aria-labelledby="product-price-heading">
        <div className="border-b border-[var(--line)] pb-3">
          <h2 className="text-base font-bold" id="product-price-heading">Precios y stock</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Importes en pesos argentinos. El stock se modifica mediante movimientos para conservar el historial.</p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Costo *" name="cost_price" state={state}>
            <input className="field-input" defaultValue={product?.cost_price ?? 0} inputMode="decimal" min="0" name="cost_price" required step="0.01" type="number" />
          </Field>
          <Field label="Precio minorista *" name="retail_price" state={state}>
            <input className="field-input" defaultValue={product?.retail_price ?? 0} inputMode="decimal" min="0" name="retail_price" required step="0.01" type="number" />
          </Field>
          <Field label="Precio mayorista" name="wholesale_price" state={state}>
            <input className="field-input" defaultValue={product?.wholesale_price ?? ""} inputMode="decimal" min="0" name="wholesale_price" step="0.01" type="number" />
          </Field>
          <Field label="Cantidad mínima mayorista *" name="wholesale_min_quantity" state={state}>
            <input className="field-input" defaultValue={product?.wholesale_min_quantity ?? 1} inputMode="decimal" min="0.001" name="wholesale_min_quantity" required step="0.001" type="number" />
          </Field>
          {editing ? (
            <Field label="Stock actual *" name="current_stock" state={state}>
              <input className="field-input" defaultValue={product?.current_stock ?? 0} inputMode="decimal" min="0" name="current_stock" required step="0.001" type="number" />
              <small className="mt-1.5 block text-xs leading-5 text-[var(--ink-muted)]">Ingresá la cantidad total disponible. La diferencia quedará registrada en el historial.</small>
            </Field>
          ) : null}
          <Field label="Stock mínimo *" name="min_stock" state={state}>
            <input className="field-input" defaultValue={product?.min_stock ?? 0} inputMode="decimal" min="0" name="min_stock" required step="0.001" type="number" />
          </Field>
          <Field label="Stock objetivo" name="target_stock" state={state}>
            <input className="field-input" defaultValue={product?.target_stock ?? ""} inputMode="decimal" min="0" name="target_stock" placeholder="Opcional" step="0.001" type="number" />
          </Field>
          {!editing ? (
            <Field label="Stock inicial" name="initial_stock" state={state}>
              <input className="field-input" defaultValue={0} inputMode="decimal" min="0" name="initial_stock" step="0.001" type="number" />
            </Field>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--line)] pt-5">
        <SubmitButton pendingLabel={editing ? "Actualizando..." : "Creando producto..."}>
          <Save size={17} /> {editing ? "Guardar cambios" : "Crear producto"}
        </SubmitButton>
      </div>
    </form>
  );
}
