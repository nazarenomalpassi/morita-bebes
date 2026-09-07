"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import { friendlyDatabaseError, textField, type ActionState } from "@/lib/actions/form-state";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const roleSchema = z.enum(["owner", "admin", "staff"]);

async function requestOrigin() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

export async function addMemberAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = textField(formData, "email").toLowerCase();
  const displayName = textField(formData, "display_name");
  const role = roleSchema.safeParse(textField(formData, "role"));
  if (!z.email().safeParse(email).success || !role.success || displayName.length < 2 || displayName.length > 120) {
    return { error: "Revisá el nombre, el correo y el perfil asignado." };
  }

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  if (organization.role === "admin" && role.data === "owner") {
    return { error: "Solo el administrador principal puede asignar ese perfil." };
  }

  let admin;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    return { error: "La invitación segura todavía no está configurada en el servidor." };
  }

  const origin = await requestOrigin();
  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
    redirectTo: `${origin}/actualizar-clave`,
  });

  if (invite.error && !invite.error.message.toLowerCase().includes("already")) {
    return { error: "No pudimos enviar la invitación. Revisá el correo e intentá nuevamente." };
  }

  if (invite.data.user) {
    await admin.auth.admin.updateUserById(invite.data.user.id, {
      user_metadata: { display_name: displayName },
    });
  }

  const { error } = await supabase.rpc("add_organization_member_by_email", {
    p_organization_id: organization.id,
    p_email: email,
    p_role: role.data,
  });
  if (error) return { error: friendlyDatabaseError(error) };

  revalidatePath("/app/usuarios");
  return { message: "Invitación enviada y acceso preparado." };
}

export async function updateMemberAction(formData: FormData) {
  const userId = textField(formData, "user_id");
  const role = roleSchema.safeParse(textField(formData, "role"));
  const currentActive = textField(formData, "current_active") === "true";
  const active = textField(formData, "intent") === "toggle" ? !currentActive : currentActive;
  if (!z.uuid().safeParse(userId).success || !role.success) return;

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  if (organization.role === "admin" && role.data === "owner") return;

  const { error } = await supabase.rpc("update_organization_member", {
    p_organization_id: organization.id,
    p_user_id: userId,
    p_role: role.data,
    p_is_active: active,
  });
  if (error) throw new Error(friendlyDatabaseError(error));
  revalidatePath("/app/usuarios");
}

export async function resetMemberPasswordAction(formData: FormData) {
  const email = textField(formData, "email").toLowerCase();
  if (!z.email().safeParse(email).success) return;

  const { supabase } = await requireActionContext(["owner", "admin"]);
  const origin = await requestOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/actualizar-clave`,
  });
  if (error) throw new Error("No se pudo enviar el correo de recuperación.");
  revalidatePath("/app/usuarios");
}
