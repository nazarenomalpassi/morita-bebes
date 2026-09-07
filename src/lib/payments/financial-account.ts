export type FinancialAccountCode = "cash" | "transfer";

export function getFinancialAccountCode(paymentMethodCode: string): FinancialAccountCode {
  return paymentMethodCode === "cash" ? "cash" : "transfer";
}
