"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { InventoryActionState } from "@/components/inventory/action-state";
import {
  databaseErrorState,
  isUuid,
  optionalText,
  requireInventoryContext,
  textValue,
  unauthenticatedState,
} from "@/components/inventory/server-utils";

type SupplierInput = {
  address: string | null;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  notes: string | null;
  phone: string | null;
  whatsapp: string | null;
};

function parseSupplier(formData: FormData): {
  data?: SupplierInput;
  errors?: Record<string, string>;
} {
  const businessName = textValue(formData, "business_name");
  const email = optionalText(formData, "email", 254)?.toLowerCase() ?? null;
  const phone = optionalText(formData, "phone", 50);
  const whatsapp = optionalText(formData, "whatsapp", 50);
  const errors: Record<string, string> = {};
  if (businessName.length < 2 || businessName.length > 160) {
    errors.business_name = "Ingresá una razón social de entre 2 y 160 caracteres.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Ingresá un correo válido.";
  }
  if (phone && phone.length < 6) errors.phone = "El teléfono parece incompleto.";
  if (whatsapp && whatsapp.length < 6) errors.whatsapp = "El WhatsApp parece incompleto.";
  if (Object.keys(errors).length) return { errors };
  return {
    data: {
      address: optionalText(formData, "address", 500),
      business_name: businessName,
      contact_name: optionalText(formData, "contact_name", 160),
      email,
      notes: optionalText(formData, "notes", 2000),
      phone,
      whatsapp,
    },
  };
}

function refreshSuppliers() {
  revalidatePath("/app/proveedores");
  revalidatePath("/app/productos");
}

export async function createSupplierAction(
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;
  const input = parseSupplier(formData);
  if (!input.data) {
    return { status: "error", message: "Revisá los campos indicados.", fieldErrors: input.errors };
  }
  const { error } = await context.supabase.from("suppliers").insert({
    ...input.data,
    organization_id: context.organization.id,
  });
  if (error) return databaseErrorState(error);
  refreshSuppliers();
  redirect("/app/proveedores");
}

export async function updateSupplierAction(
  supplierId: string,
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  if (!isUuid(supplierId)) return { status: "error", message: "Proveedor inválido." };
  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;
  const input = parseSupplier(formData);
  if (!input.data) {
    return { status: "error", message: "Revisá los campos indicados.", fieldErrors: input.errors };
  }
  const { data, error } = await context.supabase
    .from("suppliers")
    .update(input.data)
    .eq("id", supplierId)
    .eq("organization_id", context.organization.id)
    .select("id")
    .maybeSingle();
  if (error) return databaseErrorState(error);
  if (!data) return { status: "error", message: "El proveedor no existe o no tenés acceso." };
  refreshSuppliers();
  return { status: "success", message: "Proveedor actualizado correctamente." };
}

export async function toggleSupplierStatusAction(supplierId: string) {
  if (!isUuid(supplierId)) return;
  const context = await requireInventoryContext();
  if (!context) return;
  const { data } = await context.supabase
    .from("suppliers")
    .select("is_active")
    .eq("id", supplierId)
    .eq("organization_id", context.organization.id)
    .maybeSingle();
  if (!data) return;
  const { error } = await context.supabase
    .from("suppliers")
    .update({ is_active: !data.is_active })
    .eq("id", supplierId)
    .eq("organization_id", context.organization.id);
  if (error) throw new Error(databaseErrorState(error).message);
  refreshSuppliers();
}
