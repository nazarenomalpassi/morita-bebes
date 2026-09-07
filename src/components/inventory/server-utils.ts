import "server-only";

import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { InventoryActionState } from "./action-state";

export async function requireInventoryContext() {
  const supabase = await createServerSupabaseClient();
  const [{ data }, organization] = await Promise.all([
    supabase.auth.getClaims(),
    getCurrentOrganization(supabase),
  ]);
  const userId = data?.claims?.sub;

  if (!userId || !organization) return null;
  return { organization, supabase, userId };
}

export function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalText(
  formData: FormData,
  name: string,
  maxLength: number,
) {
  const value = textValue(formData, name);
  if (!value) return null;
  return value.slice(0, maxLength);
}

export function numberValue(formData: FormData, name: string) {
  const raw = textValue(formData, name).replace(",", ".");
  if (!raw) return Number.NaN;
  return Number(raw);
}

export function optionalNumberValue(formData: FormData, name: string) {
  const raw = textValue(formData, name).replace(",", ".");
  if (!raw) return null;
  return Number(raw);
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function optionalUuid(formData: FormData, name: string) {
  const value = textValue(formData, name);
  return value && isUuid(value) ? value : null;
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function databaseErrorState(error: { code?: string; message: string }): InventoryActionState {
  console.error("Database operation failed", { code: error.code, message: error.message });

  if (error.code === "23505") {
    return {
      status: "error",
      message: "Ya existe un registro con ese nombre, SKU o código.",
    };
  }

  if (error.code === "23503") {
    return {
      status: "error",
      message: "El registro está en uso o una opción seleccionada ya no existe.",
    };
  }

  if (error.code === "42501") {
    return {
      status: "error",
      message: "No tenés permisos para realizar este cambio. Volvé a iniciar sesión o consultá con un administrador.",
    };
  }

  return {
    status: "error",
    message: "No se pudo guardar. Volvé a intentar o revisá los datos ingresados.",
  };
}

export const unauthenticatedState: InventoryActionState = {
  status: "error",
  message: "No pudimos validar tu sesión o tus permisos. Actualizá la página y volvé a intentar.",
};
