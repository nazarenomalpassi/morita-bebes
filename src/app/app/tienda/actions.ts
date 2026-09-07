"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActionContext } from "@/lib/actions/context";
import { friendlyDatabaseError, textField, type ActionState } from "@/lib/actions/form-state";
import type { Database } from "@/types/database";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(formData: FormData, key: string) {
  const value = textField(formData, key);
  if (!uuidPattern.test(value)) throw new Error("Identificador inválido.");
  return value;
}

function bool(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function safeHref(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/tienda/productos";
}

function fileExtension(file: File) {
  const byType: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
  return byType[file.type] ?? "bin";
}

async function uploadStoreFile(file: File, folder: string) {
  if (!file.size || file.size > 6 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 6 MB.");
  if (!file.type.startsWith("image/")) throw new Error("Seleccioná un archivo de imagen válido.");
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const path = `${organization.id}/${folder}/${crypto.randomUUID()}.${fileExtension(file)}`;
  const { error } = await supabase.storage.from("store-media").upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (error) throw new Error("No pudimos subir la imagen.");
  return { organization, path, supabase };
}

export async function transitionWebOrderAction(formData: FormData) {
  const { supabase } = await requireActionContext(["owner", "admin"]);
  const orderId = uuid(formData, "order_id");
  const requested = textField(formData, "status") as Database["public"]["Enums"]["web_order_status"];
  const allowed: Database["public"]["Enums"]["web_order_status"][] = ["contacted", "preparing", "ready", "completed", "cancelled"];
  if (!allowed.includes(requested)) throw new Error("Estado de pedido inválido.");
  const { error } = await supabase.rpc("transition_web_order", { p_order_id: orderId, p_status: requested });
  if (error) throw new Error(error.message.includes("stock") ? error.message : "No se pudo cambiar el estado del pedido.");
  revalidatePath("/app/pedidos-web");
  revalidatePath("/app/productos");
  revalidatePath("/tienda", "layout");
}

export type ConfirmWebOrderState = ActionState & { saleId?: string };

export async function confirmWebOrderSaleAction(
  _previousState: ConfirmWebOrderState,
  formData: FormData,
): Promise<ConfirmWebOrderState> {
  try {
    const { supabase } = await requireActionContext(["owner", "admin"]);
    const orderId = uuid(formData, "order_id");
    const paymentMethodId = uuid(formData, "payment_method_id");
    const rawCardType = textField(formData, "card_type");
    const cardType = rawCardType === "debit" || rawCardType === "credit" ? rawCardType : null;
    const { data, error } = await supabase.rpc("confirm_web_order_sale", {
      p_order_id: orderId,
      p_payment_method_id: paymentMethodId,
      p_card_type: cardType,
    });
    if (error) throw error;
    const result = data as { sale_id?: string } | null;
    revalidatePath("/app/pedidos-web");
    revalidatePath("/app/ventas");
    revalidatePath("/app/productos");
    revalidatePath("/app/caja");
    revalidatePath("/app");
    revalidatePath("/tienda", "layout");
    return { message: "Venta confirmada. El stock y la caja ya fueron actualizados.", saleId: result?.sale_id };
  } catch (error) {
    const databaseError = error as { code?: string; message: string };
    if (databaseError.message?.includes("Stock insuficiente")) return { error: databaseError.message };
    if (databaseError.message?.includes("medio de pago") || databaseError.message?.includes("tarjeta")) {
      return { error: databaseError.message };
    }
    return { error: friendlyDatabaseError(databaseError) };
  }
}

export async function reviewWholesaleAccountAction(formData: FormData) {
  const { organization, supabase, userId } = await requireActionContext(["owner", "admin"]);
  const userIdTarget = uuid(formData, "user_id");
  const status = textField(formData, "status") as Database["public"]["Enums"]["wholesale_account_status"];
  if (!["approved", "rejected", "suspended"].includes(status)) throw new Error("Estado mayorista inválido.");
  const { error } = await supabase.from("store_customer_profiles").update({ customer_type: status === "approved" ? "wholesale" : "retail", wholesale_status: status, wholesale_review_notes: textField(formData, "notes") || null, reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq("user_id", userIdTarget).eq("organization_id", organization.id);
  if (error) throw new Error("No se pudo actualizar la cuenta mayorista.");
  revalidatePath("/app/mayoristas");
}

export async function saveStorefrontSettingsAction(formData: FormData) {
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const retailMinimum = Number(textField(formData, "minimum_retail_amount").replace(",", "."));
  const wholesaleMinimum = Number(textField(formData, "minimum_wholesale_amount").replace(",", "."));
  if (!Number.isFinite(retailMinimum) || retailMinimum < 0 || !Number.isFinite(wholesaleMinimum) || wholesaleMinimum < 0) throw new Error("Revisá los mínimos de compra.");
  const { error } = await supabase.from("site_settings").update({
    store_online: bool(formData, "store_online"),
    homepage_title: textField(formData, "homepage_title").slice(0, 120),
    homepage_message: textField(formData, "homepage_message").slice(0, 500) || null,
    store_description: textField(formData, "store_description").slice(0, 1000) || null,
    shipping_message: textField(formData, "shipping_message").slice(0, 500) || null,
    whatsapp: textField(formData, "whatsapp") || null,
    minimum_retail_amount: retailMinimum,
    minimum_wholesale_amount: wholesaleMinimum,
  }).eq("organization_id", organization.id);
  if (error) throw new Error("No se pudo guardar la configuración de la tienda.");
  revalidatePath("/app/tienda");
  revalidatePath("/tienda", "layout");
}

export async function createStoreBannerAction(formData: FormData) {
  const file = formData.get("image");
  if (!(file instanceof File)) throw new Error("Seleccioná una imagen.");
  const { organization, path, supabase } = await uploadStoreFile(file, "banners");
  const { error } = await supabase.from("store_banners").insert({ organization_id: organization.id, title: textField(formData, "title"), subtitle: textField(formData, "subtitle") || null, image_path: path, cta_label: textField(formData, "cta_label") || null, cta_href: safeHref(textField(formData, "cta_href")), is_active: bool(formData, "is_active"), sort_order: Number(textField(formData, "sort_order")) || 0 });
  if (error) { await supabase.storage.from("store-media").remove([path]); throw new Error("No se pudo crear el banner."); }
  revalidatePath("/app/tienda");
  revalidatePath("/tienda", "layout");
}

export async function updateStoreBannerAction(formData: FormData) {
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const bannerId = uuid(formData, "banner_id");
  const { error } = await supabase.from("store_banners").update({ title: textField(formData, "title"), subtitle: textField(formData, "subtitle") || null, cta_label: textField(formData, "cta_label") || null, cta_href: safeHref(textField(formData, "cta_href")), is_active: bool(formData, "is_active"), sort_order: Number(textField(formData, "sort_order")) || 0 }).eq("id", bannerId).eq("organization_id", organization.id);
  if (error) throw new Error("No se pudo actualizar el banner.");
  revalidatePath("/app/tienda"); revalidatePath("/tienda", "layout");
}

export async function deleteStoreBannerAction(formData: FormData) {
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const bannerId = uuid(formData, "banner_id");
  const { data } = await supabase.from("store_banners").select("image_path").eq("id", bannerId).eq("organization_id", organization.id).maybeSingle();
  const { error } = await supabase.from("store_banners").delete().eq("id", bannerId).eq("organization_id", organization.id);
  if (error) throw new Error("No se pudo eliminar el banner.");
  if (data?.image_path?.startsWith(`${organization.id}/`)) await supabase.storage.from("store-media").remove([data.image_path]);
  revalidatePath("/app/tienda"); revalidatePath("/tienda", "layout");
}

export async function uploadProductImageAction(formData: FormData) {
  const productId = uuid(formData, "product_id");
  const file = formData.get("image");
  if (!(file instanceof File)) throw new Error("Seleccioná una imagen.");
  const { organization, path, supabase } = await uploadStoreFile(file, `products/${productId}`);
  const { count } = await supabase.from("product_images").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("organization_id", organization.id);
  const { error } = await supabase.from("product_images").insert({ organization_id: organization.id, product_id: productId, storage_path: path, alt_text: textField(formData, "alt_text") || null, sort_order: count ?? 0, is_primary: !count });
  if (error) { await supabase.storage.from("store-media").remove([path]); throw new Error("No se pudo guardar la imagen."); }
  revalidatePath(`/app/productos/${productId}`); revalidatePath("/tienda", "layout");
}

export async function setPrimaryProductImageAction(formData: FormData) {
  const { supabase } = await requireActionContext(["owner", "admin"]);
  const productId = uuid(formData, "product_id"); const imageId = uuid(formData, "image_id");
  const { error } = await supabase.rpc("set_primary_product_image", { p_product_id: productId, p_image_id: imageId });
  if (error) throw new Error("No se pudo cambiar la portada.");
  revalidatePath(`/app/productos/${productId}`); revalidatePath("/tienda", "layout");
}

export async function reorderProductImageAction(formData: FormData) {
  const { supabase } = await requireActionContext(["owner", "admin"]);
  const productId = uuid(formData, "product_id"); const imageId = uuid(formData, "image_id");
  const direction = Number(textField(formData, "direction"));
  if (![1, -1].includes(direction)) throw new Error("Dirección inválida.");
  const { error } = await supabase.rpc("reorder_product_image", { p_image_id: imageId, p_direction: direction });
  if (error) throw new Error("No se pudo reordenar la imagen.");
  revalidatePath(`/app/productos/${productId}`); revalidatePath("/tienda", "layout");
}

export async function deleteProductImageAction(formData: FormData) {
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const productId = uuid(formData, "product_id"); const imageId = uuid(formData, "image_id");
  const { data } = await supabase.from("product_images").select("storage_path, is_primary").eq("id", imageId).eq("organization_id", organization.id).maybeSingle();
  const { error } = await supabase.from("product_images").delete().eq("id", imageId).eq("organization_id", organization.id);
  if (error) throw new Error("No se pudo eliminar la imagen.");
  if (data?.storage_path) await supabase.storage.from("store-media").remove([data.storage_path]);
  if (data?.is_primary) {
    const { data: nextImage } = await supabase.from("product_images").select("id").eq("product_id", productId).eq("organization_id", organization.id).order("sort_order").limit(1).maybeSingle();
    if (nextImage) await supabase.rpc("set_primary_product_image", { p_product_id: productId, p_image_id: nextImage.id });
  }
  revalidatePath(`/app/productos/${productId}`); revalidatePath("/tienda", "layout");
}

export async function uploadCategoryImageAction(formData: FormData) {
  const categoryId = uuid(formData, "category_id"); const file = formData.get("image");
  if (!(file instanceof File)) throw new Error("Seleccioná una imagen.");
  const { organization, path, supabase } = await uploadStoreFile(file, `categories/${categoryId}`);
  const { error } = await supabase.from("categories").update({ image_path: path, is_featured_online: bool(formData, "is_featured_online") }).eq("id", categoryId).eq("organization_id", organization.id);
  if (error) { await supabase.storage.from("store-media").remove([path]); throw new Error("No se pudo actualizar la categoría."); }
  revalidatePath("/app/tienda"); revalidatePath("/tienda", "layout");
  redirect("/app/tienda#categorias");
}
