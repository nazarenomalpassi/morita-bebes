"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import {
  friendlyDatabaseError,
  textField,
  type ActionState,
} from "@/lib/actions/form-state";

const customerSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(60),
  whatsapp: z.string().trim().max(60),
  email: z.union([z.email().max(254), z.literal("")]),
  address: z.string().trim().max(240),
  notes: z.string().trim().max(1000),
  is_wholesale: z.boolean(),
});

export async function saveCustomerAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = customerSchema.safeParse({
    id: textField(formData, "id"),
    name: textField(formData, "name"),
    phone: textField(formData, "phone"),
    whatsapp: textField(formData, "whatsapp"),
    email: textField(formData, "email").toLowerCase(),
    address: textField(formData, "address"),
    notes: textField(formData, "notes"),
    is_wholesale: formData.get("is_wholesale") === "on",
  });

  if (!parsed.success) {
    return { error: "Revisá el nombre, correo y datos de contacto." };
  }

  const { organization, supabase } = await requireActionContext();
  const payload = {
    name: parsed.data.name,
    phone: parsed.data.phone || null,
    whatsapp: parsed.data.whatsapp || null,
    email: parsed.data.email || null,
    address: parsed.data.address || null,
    notes: parsed.data.notes || null,
    is_wholesale: parsed.data.is_wholesale,
  };

  const result = parsed.data.id
    ? await supabase
        .from("customers")
        .update(payload)
        .eq("id", parsed.data.id)
        .eq("organization_id", organization.id)
    : await supabase.from("customers").insert({
        ...payload,
        organization_id: organization.id,
      });

  if (result.error) return { error: friendlyDatabaseError(result.error) };

  revalidatePath("/app/clientes");
  revalidatePath("/app/ventas");
  return { message: parsed.data.id ? "Cliente actualizado." : "Cliente creado." };
}

export async function toggleCustomerAction(formData: FormData) {
  const id = textField(formData, "id");
  const nextStatus = textField(formData, "active") === "true";
  if (!z.uuid().safeParse(id).success) return;

  const { organization, supabase } = await requireActionContext();
  const { error } = await supabase
    .from("customers")
    .update({ is_active: nextStatus })
    .eq("id", id)
    .eq("organization_id", organization.id);

  if (error) throw new Error(friendlyDatabaseError(error));
  revalidatePath("/app/clientes");
  revalidatePath("/app/ventas");
}
