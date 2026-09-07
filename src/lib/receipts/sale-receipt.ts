import { z } from "zod";

const moneySchema = z.coerce.number().finite();

const saleReceiptSchema = z.object({
  display_number: z.string().min(1),
  source: z.enum(["system", "legacy_import"]),
  status: z.enum(["draft", "completed", "cancelled"]),
  occurred_at: z.string().datetime({ offset: true }),
  original_time_known: z.boolean(),
  item_detail_status: z.enum(["complete", "missing_from_source", "partial"]),
  subtotal: moneySchema,
  discount: moneySchema,
  discount_percent: moneySchema.min(0).max(100).nullable().optional(),
  vat_10_5: moneySchema,
  vat_21: moneySchema,
  rounding_adjustment: moneySchema,
  manual_surcharge: moneySchema.nonnegative(),
  surcharge: moneySchema.nonnegative(),
  total: moneySchema,
  cancelled_at: z.string().datetime({ offset: true }).nullable().optional(),
  cancellation_reason: z.string().min(1).nullable().optional(),
  cancelled_by_name: z.string().min(1).nullable().optional(),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(1).optional(),
  }).nullable(),
  seller_name: z.string().min(1).nullable(),
  payments: z.array(z.object({
    method: z.string().min(1),
    amount: moneySchema,
    base_amount: moneySchema.positive().optional(),
    card_type: z.enum(["debit", "credit"]).nullable().optional(),
    surcharge_percentage: moneySchema.nonnegative().optional(),
    surcharge_amount: moneySchema.nonnegative().optional(),
  })),
  business: z.object({
    name: z.string().min(1),
    address: z.string().min(1).optional(),
    whatsapp: z.string().min(1).optional(),
    email: z.string().email().optional(),
  }),
  items: z.array(z.object({
    name: z.string().min(1),
    sku: z.string().min(1).nullable(),
    quantity: z.coerce.number().positive(),
    unit_price: moneySchema.nonnegative(),
    discount: moneySchema.nonnegative(),
    line_total: moneySchema.nonnegative(),
  })),
});

export type SaleReceipt = z.infer<typeof saleReceiptSchema>;

export function parseSaleReceipt(value: unknown) {
  return saleReceiptSchema.parse(value);
}

export const receiptArs = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const receiptQuantity = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const receiptDate = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

const receiptTime = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

export function receiptDateParts(receipt: SaleReceipt) {
  const value = new Date(receipt.occurred_at);
  return {
    date: receiptDate.format(value),
    time: receipt.original_time_known ? receiptTime.format(value) : null,
  };
}

export function receiptNumberLabel(receipt: SaleReceipt) {
  return receipt.source === "legacy_import"
    ? `Hist. #${receipt.display_number}`
    : `#${receipt.display_number}`;
}

export function receiptFileName(receipt: SaleReceipt) {
  const number = receipt.display_number
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "venta";
  return `Morita-Bebes-Comprobante-${number}.pdf`;
}
