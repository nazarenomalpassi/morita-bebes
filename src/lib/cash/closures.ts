export type CashClosureMethod = {
  payment_method_id: string;
  name: string;
  code: string;
};

export type RecentCashClosure = {
  business_date: string;
  closure_type: "automatic" | "manual";
  status: "balanced" | "difference";
  closed_at: string;
  absolute_difference_total: number;
};

export type CashClosureWorkspace = {
  configured: boolean;
  business_date: string | null;
  automatic_enabled_from: string | null;
  next_close_at: string | null;
  today_closed: boolean;
  methods: CashClosureMethod[];
  recent_closures: RecentCashClosure[];
};

export type CashClosureResultItem = {
  payment_method_id: string;
  name: string;
  expected_balance: number;
  counted_balance: number;
  difference: number;
};

export type CashClosureResult = {
  id: string;
  business_date: string;
  status: "balanced" | "difference";
  expected_total: number;
  counted_total: number;
  difference_total: number;
  absolute_difference_total: number;
  items: CashClosureResultItem[];
};

export type CashClosureHistoryItem = CashClosureResultItem & {
  opening_balance: number;
  income: number;
  expense: number;
};

export type CashClosureHistoryEntry = Omit<CashClosureResult, "items"> & {
  closure_type: "automatic" | "manual";
  notes: string | null;
  closed_at: string;
  closed_by: string;
  closed_by_name: string;
  items: CashClosureHistoryItem[];
};

export type CashClosureHistory = {
  count: number;
  closures: CashClosureHistoryEntry[];
};

const record = (value: unknown) => (value && typeof value === "object" ? value as Record<string, unknown> : {});
const numberValue = (value: unknown) => Number(value ?? 0);
const statusValue = (value: unknown): "balanced" | "difference" => value === "balanced" ? "balanced" : "difference";
const closureTypeValue = (value: unknown): "automatic" | "manual" => value === "automatic" ? "automatic" : "manual";

export function normalizeCashClosureWorkspace(value: unknown): CashClosureWorkspace {
  const data = record(value);
  return {
    configured: Boolean(data.configured),
    business_date: typeof data.business_date === "string" ? data.business_date : null,
    automatic_enabled_from: typeof data.automatic_enabled_from === "string" ? data.automatic_enabled_from : null,
    next_close_at: typeof data.next_close_at === "string" ? data.next_close_at : null,
    today_closed: Boolean(data.today_closed),
    methods: Array.isArray(data.methods) ? data.methods.map((value) => {
      const method = record(value);
      return {
        payment_method_id: String(method.payment_method_id ?? ""),
        name: String(method.name ?? ""),
        code: String(method.code ?? ""),
      };
    }) : [],
    recent_closures: Array.isArray(data.recent_closures) ? data.recent_closures.map((value) => {
      const closure = record(value);
      return {
        business_date: String(closure.business_date ?? ""),
        closure_type: closureTypeValue(closure.closure_type),
        status: statusValue(closure.status),
        closed_at: String(closure.closed_at ?? ""),
        absolute_difference_total: numberValue(closure.absolute_difference_total),
      };
    }) : [],
  };
}

export function normalizeCashClosureResult(value: unknown): CashClosureResult {
  const data = record(value);
  return {
    id: String(data.id ?? ""),
    business_date: String(data.business_date ?? ""),
    status: statusValue(data.status),
    expected_total: numberValue(data.expected_total),
    counted_total: numberValue(data.counted_total),
    difference_total: numberValue(data.difference_total),
    absolute_difference_total: numberValue(data.absolute_difference_total),
    items: Array.isArray(data.items) ? data.items.map((value) => {
      const item = record(value);
      return {
        payment_method_id: String(item.payment_method_id ?? ""),
        name: String(item.name ?? ""),
        expected_balance: numberValue(item.expected_balance),
        counted_balance: numberValue(item.counted_balance),
        difference: numberValue(item.difference),
      };
    }) : [],
  };
}

export function normalizeCashClosureHistory(value: unknown): CashClosureHistory {
  const data = record(value);
  return {
    count: numberValue(data.count),
    closures: Array.isArray(data.closures) ? data.closures.map((value) => {
      const closure = record(value);
      const base = normalizeCashClosureResult(closure);
      return {
        ...base,
        closure_type: closureTypeValue(closure.closure_type),
        notes: typeof closure.notes === "string" ? closure.notes : null,
        closed_at: String(closure.closed_at ?? ""),
        closed_by: String(closure.closed_by ?? ""),
        closed_by_name: String(closure.closed_by_name ?? ""),
        items: Array.isArray(closure.items) ? closure.items.map((value) => {
          const item = record(value);
          return {
            payment_method_id: String(item.payment_method_id ?? ""),
            name: String(item.name ?? ""),
            opening_balance: numberValue(item.opening_balance),
            income: numberValue(item.income),
            expense: numberValue(item.expense),
            expected_balance: numberValue(item.expected_balance),
            counted_balance: numberValue(item.counted_balance),
            difference: numberValue(item.difference),
          };
        }) : [],
      };
    }) : [],
  };
}
