"use client";

import { ChevronDown, CircleOff, Pencil, Plus, Power, PowerOff } from "lucide-react";
import { useActionState } from "react";

import {
  createBrandAction,
  createCategoryAction,
  toggleBrandAction,
  toggleCategoryAction,
  updateBrandAction,
  updateCategoryAction,
} from "@/app/app/categorias/actions";

import { initialInventoryActionState } from "./action-state";
import { ActionFeedback, FieldError } from "./action-feedback";
import { SubmitButton } from "./submit-button";

type Category = {
  description: string | null;
  id: string;
  is_active: boolean;
  name: string;
};
type Brand = { id: string; is_active: boolean; name: string };

function NewCategoryForm() {
  const [state, action] = useActionState(createCategoryAction, initialInventoryActionState);
  return (
    <form action={action} className="grid gap-3 border-b border-[var(--line)] pb-5 sm:grid-cols-[minmax(10rem,1fr)_auto]">
      <div>
        <label className="field-label mb-1.5" htmlFor="new-category-name">Nueva categoría</label>
        <input className="field-input" id="new-category-name" maxLength={100} name="name" placeholder="Ej.: Cochecitos" required />
        <FieldError name="name" state={state} />
      </div>
      <div className="self-end"><SubmitButton><Plus size={17} /> Crear</SubmitButton></div>
      <div className="sm:col-span-2"><ActionFeedback state={state} /></div>
    </form>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const action = updateCategoryAction.bind(null, category.id);
  const toggleAction = toggleCategoryAction.bind(null, category.id);
  const [state, formAction] = useActionState(action, initialInventoryActionState);
  return (
    <details className="group border-b border-[var(--line)] last:border-0">
      <summary className="grid min-h-16 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0"><strong className="block truncate text-sm">{category.name}</strong>{category.description ? <small className="text-xs text-[var(--ink-muted)]">{category.description}</small> : null}</span>
        {!category.is_active ? <span className="table-status text-[var(--ink-muted)]"><CircleOff size={14} /> Inactiva</span> : null}
        <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--plum)]"><Pencil size={15} /> Editar <ChevronDown className="transition-transform group-open:rotate-180" size={15} /></span>
      </summary>
      <form action={formAction} className="mb-4 grid gap-3 rounded-[8px] bg-[var(--surface-soft)] p-4">
        <label><span className="field-label mb-1.5">Nombre</span><input className="field-input" defaultValue={category.name} maxLength={100} name="name" required /><FieldError name="name" state={state} /></label>
        <label><span className="field-label mb-1.5">Descripción</span><textarea className="field-textarea min-h-20" defaultValue={category.description ?? ""} maxLength={1000} name="description" /></label>
        <div><ActionFeedback state={state} /></div>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="button button-secondary gap-2" formAction={toggleAction} type="submit">{category.is_active ? <PowerOff size={17} /> : <Power size={17} />}{category.is_active ? "Desactivar" : "Reactivar"}</button>
          <SubmitButton>Guardar cambios</SubmitButton>
        </div>
      </form>
    </details>
  );
}

function NewBrandForm() {
  const [state, action] = useActionState(createBrandAction, initialInventoryActionState);
  return (
    <form action={action} className="grid gap-3 border-b border-[var(--line)] pb-5 sm:grid-cols-[minmax(10rem,1fr)_auto]">
      <div><label className="field-label mb-1.5" htmlFor="new-brand-name">Nueva marca</label><input className="field-input" id="new-brand-name" maxLength={100} name="name" placeholder="Ej.: Pampers" required /><FieldError name="name" state={state} /></div>
      <div className="self-end"><SubmitButton><Plus size={17} /> Crear</SubmitButton></div>
      <div className="sm:col-span-2"><ActionFeedback state={state} /></div>
    </form>
  );
}

function BrandRow({ brand }: { brand: Brand }) {
  const action = updateBrandAction.bind(null, brand.id);
  const toggleAction = toggleBrandAction.bind(null, brand.id);
  const [state, formAction] = useActionState(action, initialInventoryActionState);
  return (
    <details className="group border-b border-[var(--line)] last:border-0">
      <summary className="grid min-h-16 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
        <strong className="truncate text-sm">{brand.name}</strong>
        {!brand.is_active ? <span className="table-status text-[var(--ink-muted)]"><CircleOff size={14} /> Inactiva</span> : null}
        <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--plum)]"><Pencil size={15} /> Editar <ChevronDown className="transition-transform group-open:rotate-180" size={15} /></span>
      </summary>
      <form action={formAction} className="mb-4 grid gap-3 rounded-[8px] bg-[var(--surface-soft)] p-4 sm:grid-cols-[minmax(10rem,1fr)_auto]">
        <label><span className="field-label mb-1.5">Nombre</span><input className="field-input" defaultValue={brand.name} maxLength={100} name="name" required /><FieldError name="name" state={state} /></label>
        <div className="flex flex-wrap items-end justify-end gap-2"><button className="button button-secondary gap-2" formAction={toggleAction} type="submit">{brand.is_active ? <PowerOff size={17} /> : <Power size={17} />}{brand.is_active ? "Desactivar" : "Reactivar"}</button><SubmitButton>Guardar</SubmitButton></div>
        <div className="sm:col-span-2"><ActionFeedback state={state} /></div>
      </form>
    </details>
  );
}

export function CategoryManager({ categories }: { categories: Category[] }) {
  return <><NewCategoryForm /><div className="mt-3">{categories.length ? categories.map((category) => <CategoryRow category={category} key={category.id} />) : <p className="py-10 text-center text-sm text-[var(--ink-muted)]">No hay categorías para mostrar.</p>}</div></>;
}

export function BrandManager({ brands }: { brands: Brand[] }) {
  return <><NewBrandForm /><div className="mt-3">{brands.length ? brands.map((brand) => <BrandRow brand={brand} key={brand.id} />) : <p className="py-10 text-center text-sm text-[var(--ink-muted)]">No hay marcas para mostrar.</p>}</div></>;
}
