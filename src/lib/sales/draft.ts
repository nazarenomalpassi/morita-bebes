import { z } from "zod";
import type { SaleProduct } from "./barcode-scanner";

const schema = z.object({
  cart: z.array(z.object({ id: z.uuid(), quantity: z.number().positive().max(100_000) })).max(250),
  customerId: z.string().max(36), notes: z.string().max(500), occurredAt: z.string().max(30),
  discountInput: z.string().max(20), manualSurchargeInput: z.string().max(20),
  combinedPayment: z.boolean(), selectedPaymentMethod: z.string().max(36),
  selectedCardType: z.enum(["", "debit", "credit"]),
  paymentAmounts: z.record(z.string().max(36), z.string().max(20)),
  paymentCardTypes: z.record(z.string().max(36), z.enum(["", "debit", "credit"])),
  idempotencyKey: z.union([z.uuid(), z.literal("")]),
});
export type SaleDraft = z.infer<typeof schema>;
export function validateSaleDraft(value: unknown): SaleDraft | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function restoreSaleCart(draft: Pick<SaleDraft, "cart">, products: SaleProduct[]) {
  const seen = new Set<string>();
  return draft.cart.flatMap((line) => {
    const product = products.find((item) => item.id === line.id);
    if (!product?.is_active || product.current_stock <= 0 || seen.has(line.id)) return [];
    seen.add(line.id);
    return [{ ...product, quantity: Math.min(line.quantity, product.current_stock) }];
  });
}
