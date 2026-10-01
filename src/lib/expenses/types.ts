import type { Database } from "@/types/database";

export type ExpenseRecord = Database["public"]["Tables"]["expenses"]["Row"] & {
  expense_categories: { name: string; is_payroll_advance: boolean } | null;
  payment_methods: { name: string } | null;
};
export type ExpenseCategory = { id: string; name: string; is_payroll_advance: boolean };
