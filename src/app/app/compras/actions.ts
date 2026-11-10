"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import { inventoryEntryItemsSchema } from "@/lib/purchases/direct-entry";
import type { PurchaseProduct } from "@/components/purchases/purchase-types";
import {
  friendlyDatabaseError,
  optionalText,
  textField,
  type ActionState,
} from "@/lib/actions/form-state";

export type PurchaseActionState = ActionState & {
  orderId?: string;
  receiptId?: string;
  entryId?: string;
  currentPrices?: Pick<PurchaseProduct, "id" | "costPrice" | "retailPrice" | "wholesalePrice" | "currentStock">[];
};

export async function loadInventoryEntryAction(
  _previousState: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  let rawItems: unknown;
  try { rawItems = JSON.parse(textField(formData, "items")); } catch { return { error: "El detalle de la carga no es válido." }; }
  const parsed = z.object({
    items: inventoryEntryItemsSchema,
    requestId: z.uuid(),
    notes: z.string().trim().max(500),
  }).safeParse({
    items: rawItems,
    requestId: textField(formData, "request_id"),
    notes: textField(formData, "notes"),
  });
  if (!parsed.success) return { error: "Revisá cantidades, precios y datos de los productos nuevos. No se permiten códigos repetidos ni notación científica." };
  const { organization, supabase } = await requireActionContext();
  const { data, error } = await supabase.rpc("load_inventory_entry", {
    p_organization_id: organization.id,
    p_request_id: parsed.data.requestId,
    p_items: parsed.data.items,
    p_notes: parsed.data.notes || undefined,
  });
  if (error?.message.includes("price changed while editing")) {
    const currentPrices: NonNullable<PurchaseActionState["currentPrices"]> = [];
    const productIds = parsed.data.items.filter((item) => !item.new_product).map((item) => item.product_id);
    // Keep long orders below URL limits when reading the latest catalog prices.
    for (let start = 0; start < productIds.length; start += 100) {
      const { data: latest, error: latestError } = await supabase.from("products").select("id, cost_price, retail_price, wholesale_price, current_stock")
        .eq("organization_id", organization.id).in("id", productIds.slice(start, start + 100));
      if (latestError) return { error: "Cambió un precio y no pudimos consultar sus valores actuales. No se guardó ningún cambio; conservamos tu carga para volver a intentar." };
      currentPrices.push(...(latest ?? []).map((product) => ({ id: product.id, costPrice: Number(product.cost_price), retailPrice: Number(product.retail_price), wholesalePrice: product.wholesale_price === null ? null : Number(product.wholesale_price), currentStock: Number(product.current_stock) })));
    }
    return {
      error: `Cambió un precio de ${error.details || "uno de los productos"} mientras cargabas la orden. Revisá sus precios actuales antes de confirmar. No se guardó ningún cambio.`,
      currentPrices,
    };
  }
  if (error?.message.includes("already completed with different data")) return { error: "Esta carga ya se guardó. Actualizá la vista para verla antes de iniciar otra; no se duplicó el ingreso." };
  if (error?.message.includes("product is missing or inactive")) return { error: "Un producto de la carga fue dado de baja o ya no está disponible. Revisá el detalle antes de guardar." };
  if (error?.code === "23505") return { error: "El SKU o código de barras de un producto nuevo ya está registrado. Buscalo en el inventario o corregí su código. No se guardó ningún cambio." };
  if (error?.code === "23514" || error?.code === "22023") return { error: "Revisá los nombres, códigos, unidades, cantidades y precios de la carga. No se guardó ningún cambio." };
  if (error) return { error: friendlyDatabaseError(error) };
  for (const item of parsed.data.items) {
    revalidatePath(`/app/productos/${item.product_id}`);
    revalidatePath(`/app/productos/${item.product_id}/editar`);
  }
  revalidatePath("/app");
  revalidatePath("/app/compras");
  revalidatePath("/app/productos");
  revalidatePath("/app/ventas");
  revalidatePath("/tienda", "layout");
  return { message: "El stock y los precios editados quedaron actualizados. Los productos nuevos ya están en el inventario.", entryId: data };
}

const orderItemSchema = z.object({
  product_id: z.uuid(),
  quantity_ordered: z.number().positive().max(1_000_000),
  unit_cost: z.number().nonnegative().max(999_999_999),
});

export async function createPurchaseOrderAction(
  _previousState: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  let rawItems: unknown;
  try { rawItems = JSON.parse(textField(formData, "items")); } catch { return { error: "El detalle de la orden no es válido." }; }
  const parsed = z.array(orderItemSchema).min(1).max(500).safeParse(rawItems);
  const supplierId = textField(formData, "supplier_id");
  if (!parsed.success || !z.uuid().safeParse(supplierId).success) return { error: "Seleccioná un proveedor y al menos un producto." };

  const orderedAt = textField(formData, "ordered_at");
  const expectedAt = textField(formData, "expected_at");
  if (!z.iso.date().safeParse(orderedAt).success || (expectedAt && !z.iso.date().safeParse(expectedAt).success)) return { error: "Revisá las fechas de la orden." };

  const { organization, supabase } = await requireActionContext();
  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_organization_id: organization.id,
    p_supplier_id: supplierId,
    p_items: parsed.data,
    p_reference: optionalText(formData, "reference") ?? undefined,
    p_ordered_at: orderedAt,
    p_expected_at: expectedAt || undefined,
    p_notes: optionalText(formData, "notes") ?? undefined,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  revalidatePath("/app");
  revalidatePath("/app/compras");
  return { message: "Orden de compra creada.", orderId: data };
}

const receiptItemSchema = z.object({
  purchase_order_item_id: z.uuid(),
  quantity: z.number().nonnegative().max(1_000_000),
  unit_cost: z.number().nonnegative().max(999_999_999),
});

export async function receivePurchaseOrderAction(
  _previousState: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  let rawItems: unknown;
  try { rawItems = JSON.parse(textField(formData, "items")); } catch { return { error: "El detalle de recepción no es válido." }; }
  const parsed = z.array(receiptItemSchema).min(1).max(500).safeParse(rawItems);
  const orderId = textField(formData, "purchase_order_id");
  if (!parsed.success || !z.uuid().safeParse(orderId).success || !parsed.data.some((item) => item.quantity > 0)) return { error: "Ingresá al menos una cantidad recibida." };

  const { supabase } = await requireActionContext();
  const { data, error } = await supabase.rpc("receive_purchase_order", {
    p_purchase_order_id: orderId,
    p_items: parsed.data.filter((item) => item.quantity > 0),
    p_notes: optionalText(formData, "notes") ?? undefined,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  revalidatePath("/app");
  revalidatePath("/app/compras");
  revalidatePath("/app/productos");
  return { message: "Recepción registrada y stock actualizado.", receiptId: data };
}

export async function updatePurchaseOrderStatusAction(formData: FormData) {
  const orderId = textField(formData, "purchase_order_id");
  const status = textField(formData, "status");
  if (!z.uuid().safeParse(orderId).success || !["sent", "cancelled"].includes(status)) return;
  const context = status === "cancelled"
    ? await requireActionContext(["owner", "admin"])
    : await requireActionContext();
  const { organization, supabase } = context;
  const { data, error } = await supabase
    .from("purchase_orders")
    .update({ status: status as "sent" | "cancelled" })
    .eq("id", orderId)
    .eq("organization_id", organization.id)
    .in("status", ["draft", "sent", "partial"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(friendlyDatabaseError(error));
  if (!data) throw new Error("La orden cambió de estado y ya no admite esta acción.");
  revalidatePath("/app");
  revalidatePath("/app/compras");
}
