import { z } from "zod";

export type ExpensePayment = { payment_method_id: string; amount: number };

const amountSchema = z.number().positive().max(999_999_999).refine(
  (amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 0.0001,
);

const paymentsSchema = z.array(z.object({
  payment_method_id: z.uuid(),
  amount: amountSchema,
})).min(1).max(20).refine(
  (payments) => new Set(payments.map((payment) => payment.payment_method_id)).size === payments.length,
);

export function validateExpensePayments(value: unknown, total: number) {
  const parsed = paymentsSchema.safeParse(value);
  if (!parsed.success) return { error: "Revisá los medios de pago y sus importes." } as const;
  const cents = parsed.data.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
  if (!amountSchema.safeParse(total).success || cents !== Math.round(total * 100)) {
    return { error: "La suma de los medios de pago debe coincidir exactamente con el importe del gasto." } as const;
  }
  return { payments: parsed.data } as const;
}

export function readExpensePayments(value: unknown): ExpensePayment[] {
  const parsed = paymentsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
