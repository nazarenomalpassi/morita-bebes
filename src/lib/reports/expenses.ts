import { readExpensePayments } from "../expenses/payments";
import type { ReportSearchParams, ResolvedReportPeriod } from "./analytics";

export type ReportExpense = {
  id: string; expense_date: string; description: string; amount: number; status: string;
  category_id: string | null; created_by: string | null; payment_method_id: string | null;
  payment_allocations: unknown;
  expense_categories: { name: string; is_payroll_advance: boolean } | null;
};
type PaymentMethod = { id: string; name: string };
type Employee = { id: string; name: string };

function dates(from: string, to: string) {
  const list: string[] = [];
  const day = new Date(`${from}T00:00:00Z`);
  while (day.toISOString().slice(0, 10) <= to) {
    list.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return list;
}

export function buildExpenseAnalytics(rows: ReportExpense[], methods: PaymentMethod[], employees: Employee[], period: ResolvedReportPeriod, search: ReportSearchParams) {
  const methodNames = new Map(methods.map((method) => [method.id, method.name]));
  const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
  const eligible = rows.filter((row) => row.status === "posted" && !row.expense_categories?.is_payroll_advance);
  const categories = [...new Map(eligible.map((row) => [row.category_id ?? "none", { id: row.category_id ?? "none", name: row.expense_categories?.name ?? "Sin categoría" }])).values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const filtered = eligible.filter((row) => (!search.gasto_categoria || (row.category_id ?? "none") === search.gasto_categoria)
    && (!search.gasto_empleado || (row.created_by ?? "unassigned") === search.gasto_empleado)).flatMap((row) => {
    const allocations = readExpensePayments(row.payment_allocations);
    const payments = (allocations.length ? allocations.map((allocation) => ({ key: allocation.payment_method_id, cents: Math.round(allocation.amount * 100) }))
      : [{ key: row.payment_method_id ?? "none", cents: Math.round(row.amount * 100) }])
      .map((payment) => ({ ...payment, name: methodNames.get(payment.key) ?? (payment.key === "none" ? "Sin indicar" : "Medio histórico"), amount: payment.cents / 100 }));
    const selected = search.gasto_pago ? payments.filter((payment) => payment.key === search.gasto_pago) : payments;
    if (!selected.length) return [];
    return [{ ...row, category: row.expense_categories?.name ?? "Sin categoría", employee: row.created_by ? employeeNames.get(row.created_by) ?? "Usuario histórico" : "Histórico / sin identificar", payments,
      selectedPayments: selected, cents: selected.reduce((sum, payment) => sum + payment.cents, 0) }];
  });
  const currentDays = dates(period.from, period.to);
  const previousDays = dates(period.compareFrom, period.compareTo);
  const currentRows = filtered.filter((row) => row.expense_date >= period.from && row.expense_date <= period.to);
  const previousRows = filtered.filter((row) => row.expense_date >= period.compareFrom && row.expense_date <= period.compareTo);
  const summary = (items: typeof filtered, dayCount: number) => {
    const amount = items.reduce((sum, row) => sum + row.cents, 0) / 100;
    return { amount, count: items.length, average: items.length ? amount / items.length : 0, dailyAverage: amount / Math.max(1, dayCount) };
  };
  const categoryTotals = new Map<string, { name: string; cents: number }>();
  const paymentTotals = new Map<string, { key: string; name: string; cents: number; operations: number }>();
  const dayTotals = (items: typeof filtered) => {
    const map = new Map<string, number>();
    for (const row of items) map.set(row.expense_date, (map.get(row.expense_date) ?? 0) + row.cents);
    return map;
  };
  for (const row of currentRows) {
    const categoryKey = row.category_id ?? "none";
    const category = categoryTotals.get(categoryKey) ?? { name: row.category, cents: 0 };
    category.cents += row.cents;
    categoryTotals.set(categoryKey, category);
    for (const payment of row.selectedPayments) {
      const total = paymentTotals.get(payment.key) ?? { key: payment.key, name: payment.name, cents: 0, operations: 0 };
      total.cents += payment.cents; total.operations += 1;
      paymentTotals.set(payment.key, total);
    }
  }
  const currentDates = dayTotals(currentRows);
  const previousDates = dayTotals(previousRows);
  return {
    current: summary(currentRows, currentDays.length), previous: summary(previousRows, previousDays.length),
    byCategory: [...categoryTotals.values()].map((row) => ({ name: row.name, amount: row.cents / 100 })).sort((a, b) => b.amount - a.amount),
    byPayment: [...paymentTotals.values()].map((row) => ({ key: row.key, name: row.name, amount: row.cents / 100, operations: row.operations })).sort((a, b) => b.amount - a.amount),
    timeline: Array.from({ length: Math.max(currentDays.length, previousDays.length) }, (_, index) => ({
      date: currentDays[index] ?? null, previousDate: previousDays[index] ?? null,
      current: currentDays[index] ? (currentDates.get(currentDays[index]) ?? 0) / 100 : null,
      previous: previousDays[index] ? (previousDates.get(previousDays[index]) ?? 0) / 100 : null,
    })),
    details: currentRows.sort((a, b) => b.expense_date.localeCompare(a.expense_date) || a.id.localeCompare(b.id)).map((row) => ({
      id: row.id, date: row.expense_date, description: row.description, category: row.category, employee: row.employee,
      amount: row.amount, filteredAmount: row.cents / 100, payments: row.payments.map(({ key, name, amount }) => ({ key, name, amount })),
    })),
    filters: { categories, paymentMethods: [...methods.map((method) => ({ key: method.id, name: method.name })), { key: "none", name: "Sin indicar" }] },
  };
}

export type ExpenseAnalyticsReport = ReturnType<typeof buildExpenseAnalytics>;
