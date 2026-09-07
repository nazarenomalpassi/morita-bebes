"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type FormState = {
  error?: string;
  message?: string;
};

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function safePasswordDestination(value: string) {
  if (value === "/tienda/ingresar" || value.startsWith("/tienda/ingresar?")) return value;
  return "/app";
}

function friendlyAuthError(message: string) {
  if (message.includes("Invalid login credentials")) {
    return "El correo o la contraseña no coinciden.";
  }
  if (message.includes("Email not confirmed")) {
    return "Confirmá tu correo antes de ingresar.";
  }
  if (message.includes("already registered")) {
    return "Ya existe una cuenta con ese correo.";
  }
  return "No pudimos completar el acceso. Intentá nuevamente.";
}

async function requestOrigin() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

export async function authenticateAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");

  if (!email || !email.includes("@")) {
    return { error: "Ingresá un correo válido." };
  }

  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendlyAuthError(error.message) };

  const loginAudit = await supabase.rpc("record_login");
  if (loginAudit.error || loginAudit.data < 1) {
    await supabase.auth.signOut();
    return { error: "Tu acceso no está habilitado. Consultá con un administrador." };
  }

  revalidatePath("/", "layout");
  redirect("/app");
}

export async function requestPasswordResetAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = field(formData, "email").toLowerCase();
  if (!email || !email.includes("@")) return { error: "Ingresá un correo válido." };
  const [supabase, origin] = await Promise.all([
    createServerSupabaseClient(),
    requestOrigin(),
  ]);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/actualizar-clave`,
  });
  if (error) return { error: friendlyAuthError(error.message) };
  return { message: "Te enviamos un enlace para crear una contraseña nueva." };
}

export async function updatePasswordAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const password = field(formData, "password");
  const confirmation = field(formData, "password_confirmation");
  const next = safePasswordDestination(field(formData, "next"));
  if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };
  if (password !== confirmation) return { error: "Las contraseñas no coinciden." };
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { error: "El enlace venció. Solicitá uno nuevo." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: friendlyAuthError(error.message) };
  revalidatePath("/", "layout");
  redirect(next);
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

function toSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export async function createOrganizationAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = field(formData, "name");

  if (name.length < 2 || name.length > 80) {
    return { error: "El nombre debe tener entre 2 y 80 caracteres." };
  }

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) redirect("/login");

  const { data: canBootstrap } = await supabase.rpc("can_bootstrap_organization");
  if (!canBootstrap) {
    return { error: "Este comercio ya está configurado. El dueño debe habilitar tu acceso." };
  }

  const baseSlug = toSlug(name) || "morita-bebes";
  let result = await supabase.from("organizations").insert({
    name,
    slug: baseSlug,
    created_by: claims.sub,
  });

  if (result.error?.code === "23505") {
    result = await supabase.from("organizations").insert({
      name,
      slug: `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`,
      created_by: claims.sub,
    });
  }

  if (result.error) {
    return { error: "No pudimos crear el espacio de trabajo." };
  }

  revalidatePath("/app", "layout");
  redirect("/app");
}
