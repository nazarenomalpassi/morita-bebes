"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import {
  friendlyDatabaseError,
  optionalText,
  optionalUuid,
  textField,
  type ActionState,
} from "@/lib/actions/form-state";
import { argentinaLocalDateTimeToIso } from "@/lib/date";

export type SaleActionState = ActionState & { saleId?: string };
export type CancelSaleActionState = ActionState & { cancelled?: boolean };

const saleItemSchema = z.object({
  product_id: z.uuid(),
  quantity: z.number().positive().max(100_000),
});

const saleSchema = z.object({
  items: z.array(saleItemSchema).min(1).max(250),
  payments: z.array(z.object({
    payment_method_id: z.uuid(),
    amount: z.number().positive().max(999_999_999),
    card_type: z.enum(["debit", "credit"]).optional(),
  })),
  discount: z.number().min(0).max(100),
  manual_surcharge: z.number().min(0).max(999_999_999),
  idempotency_key: z.uuid(),
});

export async function createSaleAction(
  _previousState: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  let decodedItems: unknown;
  let decodedPayments: unknown;
  try {
    decodedItems = JSON.parse(textField(formData, "items"));
    decodedPayments = JSON.parse(textField(formData, "payments"));
  } catch {
    return { error: "El detalle de la venta no es válido." };
  }

  const parsed = saleSchema.safeParse({
    items: decodedItems,
    payments: decodedPayments,
    discount: Number(textField(formData, "discount") || "0"),
    manual_surcharge: Number(textField(formData, "manual_surcharge") || "0"),
    idempotency_key: textField(formData, "idempotency_key"),
  });

  if (!parsed.success) {
    return { error: "Revisá los productos, cantidades, el descuento porcentual y el recargo." };
  }

  const { organization, supabase } = await requireActionContext();
  let occurredAtIso: string | undefined;
  if (organization.role !== "staff") {
    const occurredAt = textField(formData, "occurred_at");
    if (occurredAt) {
      const parsedDate = argentinaLocalDateTimeToIso(occurredAt);
      if (!parsedDate) return { error: "La fecha y hora de la venta no es válida." };
      occurredAtIso = parsedDate;
    }
  }
  const { data, error } = await supabase.rpc("create_idempotent_sale_with_payments", {
    p_organization_id: organization.id,
    p_items: parsed.data.items,
    p_payments: parsed.data.payments,
    p_customer_id: optionalUuid(formData, "customer_id") ?? undefined,
    p_discount: parsed.data.discount,
    p_manual_surcharge: parsed.data.manual_surcharge,
    p_idempotency_key: parsed.data.idempotency_key,
    p_notes: optionalText(formData, "notes") ?? undefined,
    p_reference: optionalText(formData, "reference") ?? undefined,
    ...(occurredAtIso ? { p_occurred_at: occurredAtIso } : {}),
  });

  if (error) {
    if (error.message.includes("stock")) {
      return { error: "No hay stock suficiente para completar uno de los productos." };
    }
    return { error: friendlyDatabaseError(error) };
  }

  revalidatePath("/app");
  revalidatePath("/app/ventas");
  revalidatePath("/app/productos");
  revalidatePath("/app/caja");
  return { message: "Venta registrada y stock actualizado.", saleId: data };
}

export async function cancelSaleAction(
  _previousState: CancelSaleActionState,
  formData: FormData,
): Promise<CancelSaleActionState> {
  const saleId = textField(formData, "sale_id");
  const reason = textField(formData, "reason").trim();
  if (!z.uuid().safeParse(saleId).success || reason.length < 3) {
    return { error: "Ingresá un motivo de anulación de al menos 3 caracteres." };
  }

  const { supabase } = await requireActionContext();
  const { error } = await supabase.rpc("cancel_sale", {
    p_sale_id: saleId,
    p_reason: reason.slice(0, 500),
  });

  if (error) return { error: friendlyDatabaseError(error) };

  revalidatePath("/app");
  revalidatePath("/app/ventas");
  revalidatePath("/app/productos");
  revalidatePath("/app/caja");
  revalidatePath(`/app/ventas/${saleId}/comprobante`);
  return { cancelled: true, message: "Venta anulada. El stock y la caja fueron revertidos." };
}
