"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { storePostLoginDestination } from "@/lib/store/admin";
import { STORE_ORGANIZATION_SLUG, type CartSnapshot } from "@/lib/store/types";
import { buildStoreWhatsAppUrl, type CreatedStoreOrder } from "@/lib/store/order";

export type StoreActionState = {
  error?: string;
  message?: string;
  whatsappUrl?: string;
  orderNumber?: string;
};

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function safeStorePath(value: string) {
  return value.startsWith("/tienda") && !value.startsWith("//") ? value : "/tienda";
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requestOrigin() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const protocol = headerStore.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

function friendlyStoreError(message: string) {
  if (message.includes("Invalid login credentials")) return "El correo o la contraseña no coinciden.";
  if (message.includes("Email not confirmed")) return "Confirmá tu correo antes de ingresar.";
  if (message.includes("already registered")) return "Ya existe una cuenta con ese correo.";
  if (message.includes("Faltan $")) return message;
  if (message.includes("Solo quedan") || message.includes("cantidad mínima") || message.includes("consulta de precio")) return message;
  if (message.includes("ya no está publicado")) return "La disponibilidad de algunos productos cambió. Revisamos tu carrito; volvé a intentarlo.";
  return "No pudimos completar la operación. Intentá nuevamente.";
}

export async function storeLoginAction(
  _state: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");
  const next = safeStorePath(field(formData, "next"));
  if (!email.includes("@")) return { error: "Ingresá un correo válido." };
  if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendlyStoreError(error.message) };

  const { data: organization } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", STORE_ORGANIZATION_SLUG)
    .maybeSingle();
  const { data: membership } = organization && data.user
    ? await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", organization.id)
        .eq("user_id", data.user.id)
        .eq("is_active", true)
        .maybeSingle()
    : { data: null };

  revalidatePath("/tienda", "layout");
  redirect(storePostLoginDestination(membership?.role, next));
}

export async function storeRegisterAction(
  _state: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const email = field(formData, "email").toLowerCase();
  const password = field(formData, "password");
  const firstName = field(formData, "first_name");
  const lastName = field(formData, "last_name");
  const phone = field(formData, "phone");
  const locality = field(formData, "locality");
  const province = field(formData, "province");
  const customerType = field(formData, "customer_type") === "wholesale" ? "wholesale" : "retail";
  const businessName = field(formData, "business_name");

  if (!email.includes("@")) return { error: "Ingresá un correo válido." };
  if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };
  if (firstName.length < 2 || lastName.length < 2) return { error: "Completá tu nombre y apellido." };
  if (phone.length < 6) return { error: "Ingresá un teléfono válido." };
  if (locality.length < 2 || province.length < 2) return { error: "Completá localidad y provincia." };
  if (customerType === "wholesale" && businessName.length < 2) return { error: "Indicá el nombre de tu comercio." };

  const [supabase, origin] = await Promise.all([createServerSupabaseClient(), requestOrigin()]);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=/tienda/cuenta`,
      data: {
        store_registration: true,
        organization_slug: STORE_ORGANIZATION_SLUG,
        first_name: firstName,
        last_name: lastName,
        phone,
        locality,
        province,
        customer_type: customerType,
        business_name: businessName || null,
        cuit: field(formData, "cuit") || null,
        address: field(formData, "address") || null,
        display_name: `${firstName} ${lastName}`,
      },
    },
  });
  if (error) return { error: friendlyStoreError(error.message) };
  if (data.session) {
    revalidatePath("/tienda", "layout");
    redirect("/tienda/cuenta");
  }
  return { message: "Te enviamos un correo para confirmar la cuenta. Después vas a poder ingresar a la tienda." };
}

export async function storePasswordResetAction(
  _state: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const email = field(formData, "email").toLowerCase();
  if (!email.includes("@")) return { error: "Ingresá un correo válido." };
  const [supabase, origin] = await Promise.all([createServerSupabaseClient(), requestOrigin()]);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/actualizar-clave?next=/tienda/ingresar`,
  });
  if (error) return { error: friendlyStoreError(error.message) };
  return { message: "Te enviamos un enlace para elegir una contraseña nueva." };
}

export async function updateStoreProfileAction(
  _state: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { error: "Iniciá sesión nuevamente." };

  const payload = {
    first_name: field(formData, "first_name"),
    last_name: field(formData, "last_name"),
    phone: field(formData, "phone"),
    locality: field(formData, "locality"),
    province: field(formData, "province"),
    business_name: field(formData, "business_name") || null,
    cuit: field(formData, "cuit") || null,
    address: field(formData, "address") || null,
  };
  if (payload.first_name.length < 2 || payload.last_name.length < 2 || payload.phone.length < 6) {
    return { error: "Revisá tus datos personales." };
  }
  const { error } = await supabase.from("store_customer_profiles").update(payload).eq("user_id", data.claims.sub);
  if (error) return { error: friendlyStoreError(error.message) };
  revalidatePath("/tienda/cuenta");
  return { message: "Tus datos se actualizaron correctamente." };
}

export async function requestWholesaleAccountAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("request_wholesale_account");
  if (error) throw new Error(friendlyStoreError(error.message));
  revalidatePath("/tienda/cuenta");
  revalidatePath("/tienda", "layout");
}

export async function createWebOrderAction(
  _state: StoreActionState,
  formData: FormData,
): Promise<StoreActionState> {
  let items: unknown;
  try {
    items = JSON.parse(field(formData, "items"));
  } catch {
    return { error: "El carrito no es válido." };
  }
  const idempotencyKey = field(formData, "idempotency_key");
  if (!uuidPattern.test(idempotencyKey)) return { error: "Actualizá la página y volvé a intentar." };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_web_order_idempotent", {
    p_organization_slug: STORE_ORGANIZATION_SLUG,
    p_items: items as never,
    p_idempotency_key: idempotencyKey,
    p_notes: field(formData, "notes") || undefined,
  });
  if (error) return { error: friendlyStoreError(error.message) };
  const order = data as unknown as CreatedStoreOrder;
  const whatsappUrl = buildStoreWhatsAppUrl(order);
  revalidatePath("/tienda/cuenta");
  return {
    message: whatsappUrl
      ? "Pedido guardado. Abrí WhatsApp para enviarlo a Morita Bebés."
      : "Pedido guardado. Falta configurar el número de WhatsApp del comercio.",
    orderNumber: order.order_number,
    whatsappUrl,
  };
}

export async function revalidateStoreCartAction(productIds: string[]): Promise<{ products: CartSnapshot[]; error?: string }> {
  const uniqueIds = [...new Set(productIds)].filter((id) => uuidPattern.test(id)).slice(0, 100);
  if (!uniqueIds.length) return { products: [] };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_store_cart_snapshot", {
    p_organization_slug: STORE_ORGANIZATION_SLUG,
    p_product_ids: uniqueIds,
  });
  if (error) return { products: [], error: "No pudimos actualizar el carrito. Reintentá en unos segundos." };
  return { products: (data ?? []) as CartSnapshot[] };
}

export async function storeSignOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  revalidatePath("/tienda", "layout");
  redirect("/tienda");
}
