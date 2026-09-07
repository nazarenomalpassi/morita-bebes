export const cashMovementLabels = {
  initial_balance: "Saldo inicial",
  sale: "Venta",
  sale_reversal: "Anulación de venta",
  expense: "Gasto",
  expense_reversal: "Anulación de gasto",
  payroll: "Sueldo pagado",
  transfer: "Transferencia",
  adjustment: "Ajuste",
  other_income: "Ingreso manual",
  other_expense: "Egreso manual",
} as const;

export type CashMovementType = keyof typeof cashMovementLabels;

export type CashAccountSummary = {
  id: string;
  payment_method_id: string;
  name: string;
  code: string;
  is_active: boolean;
  balance: number;
  month_income: number;
  month_expense: number;
  movement_count: number;
  updated_at: string;
};

export type CashMovement = {
  id: string;
  occurred_at: string;
  type: CashMovementType;
  direction: "credit" | "debit";
  amount: number;
  signed_amount: number;
  balance_before: number;
  balance_after: number;
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  transfer_id: string | null;
  created_by: string | null;
  account_name: string;
  payment_method_id: string;
  actor_name: string;
};

export type CashDashboard = {
  configured: boolean;
  tracking_started_at: string | null;
  total_balance: number;
  accounts: CashAccountSummary[];
  daily_flow: Array<{ date: string; income: number; expense: number }>;
  movement_count: number;
  movements: CashMovement[];
};

const numberValue = (value: unknown) => Number(value ?? 0);

export function normalizeCashDashboard(value: unknown): CashDashboard {
  const data = (value ?? {}) as Record<string, unknown>;
  return {
    configured: Boolean(data.configured),
    tracking_started_at: typeof data.tracking_started_at === "string" ? data.tracking_started_at : null,
    total_balance: numberValue(data.total_balance),
    movement_count: numberValue(data.movement_count),
    accounts: Array.isArray(data.accounts)
      ? data.accounts.map((entry) => {
          const account = entry as Record<string, unknown>;
          return {
            id: String(account.id), payment_method_id: String(account.payment_method_id),
            name: String(account.name), code: String(account.code), is_active: Boolean(account.is_active),
            balance: numberValue(account.balance), month_income: numberValue(account.month_income),
            month_expense: numberValue(account.month_expense), movement_count: numberValue(account.movement_count),
            updated_at: String(account.updated_at),
          };
        })
      : [],
    daily_flow: Array.isArray(data.daily_flow)
      ? data.daily_flow.map((entry) => {
          const flow = entry as Record<string, unknown>;
          return { date: String(flow.date), income: numberValue(flow.income), expense: numberValue(flow.expense) };
        })
      : [],
    movements: Array.isArray(data.movements)
      ? data.movements.map((entry) => {
          const movement = entry as Record<string, unknown>;
          return {
            id: String(movement.id), occurred_at: String(movement.occurred_at),
            type: movement.type as CashMovementType,
            direction: movement.direction as "credit" | "debit", amount: numberValue(movement.amount),
            signed_amount: numberValue(movement.signed_amount), balance_before: numberValue(movement.balance_before),
            balance_after: numberValue(movement.balance_after), description: String(movement.description),
            reference_type: movement.reference_type ? String(movement.reference_type) : null,
            reference_id: movement.reference_id ? String(movement.reference_id) : null,
            transfer_id: movement.transfer_id ? String(movement.transfer_id) : null,
            created_by: movement.created_by ? String(movement.created_by) : null,
            account_name: String(movement.account_name), payment_method_id: String(movement.payment_method_id),
            actor_name: String(movement.actor_name),
          };
        })
      : [],
  };
}
