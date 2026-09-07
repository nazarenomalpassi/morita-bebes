"use server";

import { revalidatePath } from "next/cache";

import type { InventoryActionState } from "@/components/inventory/action-state";
import {
  databaseErrorState,
  isUuid,
  optionalText,
  requireInventoryContext,
  slugify,
  textValue,
  unauthenticatedState,
} from "@/components/inventory/server-utils";

function refreshCatalog() {
  revalidatePath("/app/categorias");
  revalidatePath("/app/productos");
}

function categoryInput(formData: FormData) {
  const name = textValue(formData, "name");
  const slug = slugify(name);
  const errors: Record<string, string> = {};
  if (name.length < 2 || name.length > 100) errors.name = "Ingresá un nombre de entre 2 y 100 caracteres.";
  if (!slug) errors.name = "El nombre debe contener letras o números.";
  return {
    data: {
      description: optionalText(formData, "description", 1000),
      name,
      slug,
    },
    errors,
  };
}

function brandInput(formData: FormData) {
  const name = textValue(formData, "name");
  return name.length >= 2 && name.length <= 100
    ? { name }
    : null;
}

export async function createCategoryAction(
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;
  const input = categoryInput(formData);
  if (Object.keys(input.errors).length) {
    return { status: "error", message: "Revisá los campos indicados.", fieldErrors: input.errors };
  }
  const { data: lastCategory, error: orderError } = await context.supabase
    .from("categories")
    .select("sort_order")
    .eq("organization_id", context.organization.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) return databaseErrorState(orderError);
  const nextSortOrder = Math.min(9999, (Number(lastCategory?.sort_order ?? 0) || 0) + 10);
  const { error } = await context.supabase.from("categories").insert({
    ...input.data,
    organization_id: context.organization.id,
    sort_order: nextSortOrder,
  });
  if (error) return databaseErrorState(error);
  refreshCatalog();
  return { status: "success", message: "Categoría creada." };
}

export async function updateCategoryAction(
  categoryId: string,
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  if (!isUuid(categoryId)) return { status: "error", message: "Categoría inválida." };
  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;
  const input = categoryInput(formData);
  if (Object.keys(input.errors).length) {
    return { status: "error", message: "Revisá los campos indicados.", fieldErrors: input.errors };
  }
  const { data, error } = await context.supabase
    .from("categories")
    .update(input.data)
    .eq("id", categoryId)
    .eq("organization_id", context.organization.id)
    .select("id")
    .maybeSingle();
  if (error) return databaseErrorState(error);
  if (!data) return { status: "error", message: "La categoría no existe o no tenés acceso." };
  refreshCatalog();
  return { status: "success", message: "Categoría actualizada." };
}

export async function toggleCategoryAction(categoryId: string) {
  if (!isUuid(categoryId)) return;
  const context = await requireInventoryContext();
  if (!context) return;
  const { data } = await context.supabase
    .from("categories")
    .select("is_active")
    .eq("id", categoryId)
    .eq("organization_id", context.organization.id)
    .maybeSingle();
  if (!data) return;
  const { error } = await context.supabase
    .from("categories")
    .update({ is_active: !data.is_active })
    .eq("id", categoryId)
    .eq("organization_id", context.organization.id);
  if (error) throw new Error(databaseErrorState(error).message);
  refreshCatalog();
}

export async function createBrandAction(
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;
  const input = brandInput(formData);
  if (!input) {
    return {
      status: "error",
      message: "Revisá los campos indicados.",
      fieldErrors: { name: "Ingresá un nombre de entre 2 y 100 caracteres." },
    };
  }
  const { error } = await context.supabase.from("brands").insert({
    ...input,
    organization_id: context.organization.id,
  });
  if (error) return databaseErrorState(error);
  refreshCatalog();
  return { status: "success", message: "Marca creada." };
}

export async function updateBrandAction(
  brandId: string,
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  if (!isUuid(brandId)) return { status: "error", message: "Marca inválida." };
  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;
  const input = brandInput(formData);
  if (!input) {
    return {
      status: "error",
      message: "Revisá los campos indicados.",
      fieldErrors: { name: "Ingresá un nombre de entre 2 y 100 caracteres." },
    };
  }
  const { data, error } = await context.supabase
    .from("brands")
    .update(input)
    .eq("id", brandId)
    .eq("organization_id", context.organization.id)
    .select("id")
    .maybeSingle();
  if (error) return databaseErrorState(error);
  if (!data) return { status: "error", message: "La marca no existe o no tenés acceso." };
  refreshCatalog();
  return { status: "success", message: "Marca actualizada." };
}

export async function toggleBrandAction(brandId: string) {
  if (!isUuid(brandId)) return;
  const context = await requireInventoryContext();
  if (!context) return;
  const { data } = await context.supabase
    .from("brands")
    .select("is_active")
    .eq("id", brandId)
    .eq("organization_id", context.organization.id)
    .maybeSingle();
  if (!data) return;
  const { error } = await context.supabase
    .from("brands")
    .update({ is_active: !data.is_active })
    .eq("id", brandId)
    .eq("organization_id", context.organization.id);
  if (error) throw new Error(databaseErrorState(error).message);
  refreshCatalog();
}
