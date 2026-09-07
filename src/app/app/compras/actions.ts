"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import {
  friendlyDatabaseError,
  optionalText,
  textField,
  type ActionState,
} from "@/lib/actions/form-state";

export type PurchaseActionState = ActionState & { orderId?: string; receiptId?: string };

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
