import { readExpensePayments } from "./payments";

type PaymentExpense = { amount: number; payment_allocations: unknown; payment_method_id: string | null };
export function expenseAmountForMethod(expense: PaymentExpense, method: string) {
  if (!method) return Number(expense.amount);
  const allocations = readExpensePayments(expense.payment_allocations);
  if (allocations.length) return allocations.filter((payment) => payment.payment_method_id === method).reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0) / 100;
  return (expense.payment_method_id ?? "none") === method ? Number(expense.amount) : 0;
}
