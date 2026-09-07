"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import { friendlyDatabaseError, textField, type ActionState } from "@/lib/actions/form-state";

const commissionAgentSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  first_name: z.string().trim().min(2).max(80),
  last_name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(40),
  route_description: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(1000),
});

export async function saveCommissionAgentAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = commissionAgentSchema.safeParse({
    id: textField(formData, "id"),
    first_name: textField(formData, "first_name"),
    last_name: textField(formData, "last_name"),
    phone: textField(formData, "phone"),
    route_description: textField(formData, "route_description"),
    notes: textField(formData, "notes"),
  });

  if (!parsed.success) {
    return { error: "Completá nombre, apellido, teléfono y recorrido." };
  }

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.rpc("upsert_commission_agent", {
    p_organization_id: organization.id,
    p_id: parsed.data.id || undefined,
    p_first_name: parsed.data.first_name,
    p_last_name: parsed.data.last_name,
    p_phone: parsed.data.phone,
    p_route_description: parsed.data.route_description,
    p_notes: parsed.data.notes || undefined,
  });

  if (error) return { error: friendlyDatabaseError(error) };
  revalidatePath("/app/comisionistas");
  return { message: parsed.data.id ? "Comisionista actualizado." : "Comisionista agregado." };
}

export async function toggleCommissionAgentAction(formData: FormData) {
  const id = textField(formData, "id");
  const nextStatus = textField(formData, "active") === "true";
  if (!z.uuid().safeParse(id).success) return;

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.rpc("set_commission_agent_active", {
    p_organization_id: organization.id,
    p_id: id,
    p_is_active: nextStatus,
  });

  if (error) throw new Error(friendlyDatabaseError(error));
  revalidatePath("/app/comisionistas");
}
