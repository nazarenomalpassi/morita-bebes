import { describe, expect, it } from "vitest";
import { buildExpenseAnalytics, type ReportExpense } from "./expenses";
import { resolveReportPeriod } from "./analytics";

const cash = "81111111-1111-4111-8111-111111111111";
const transfer = "82222222-2222-4222-8222-222222222222";
const methods = [{ id: cash, name: "Efectivo" }, { id: transfer, name: "Transferencia" }];
const employees = [{ id: "owner", name: "Dueño" }];
const period = resolveReportPeriod({ periodo: "custom", desde: "2026-10-10", hasta: "2026-10-11" });
function expense(overrides: Partial<ReportExpense> = {}): ReportExpense {
  return { id: "one", amount: 10000, status: "posted", expense_date: "2026-10-10", description: "Compra de insumos", category_id: "services", created_by: "owner", payment_method_id: null,
    expense_categories: { name: "Servicios", is_payroll_advance: false }, payment_allocations: [{ payment_method_id: cash, amount: 4000 }, { payment_method_id: transfer, amount: 6000 }], ...overrides };
}

describe("expense analytics", () => {
  it("counts a combined payment once and reconciles category, payment and daily totals", () => {
    const report = buildExpenseAnalytics([expense()], methods, employees, period, {});
    expect(report.current).toEqual({ amount: 10000, count: 1, average: 10000, dailyAverage: 5000 });
    expect(report.byCategory).toEqual([{ name: "Servicios", amount: 10000 }]);
    expect(report.byPayment.reduce((sum, row) => sum + row.amount, 0)).toBe(10000);
    expect(report.timeline.map((point) => point.current)).toEqual([10000, 0]);
    expect(report.details[0].employee).toBe("Dueño");
  });
  it("filters combined payments by their allocation, not the entire expense", () => {
    const report = buildExpenseAnalytics([expense()], methods, employees, period, { gasto_pago: cash });
    expect(report.current.amount).toBe(4000);
    expect(report.current.count).toBe(1);
    expect(report.byCategory[0].amount).toBe(4000);
    expect(report.byPayment).toEqual([{ key: cash, name: "Efectivo", amount: 4000, operations: 1 }]);
    expect(report.details[0]).toMatchObject({ amount: 10000, filteredAmount: 4000 });
  });
  it("excludes cancelled, salary advances and out-of-period expenses", () => {
    const report = buildExpenseAnalytics([expense(), expense({ id: "cancelled", status: "cancelled" }), expense({ id: "salary", expense_categories: { name: "Sueldo", is_payroll_advance: true } }), expense({ id: "old", expense_date: "2026-01-01" })], methods, employees, period, {});
    expect(report.current.count).toBe(1);
    expect(report.current.amount).toBe(10000);
  });
  it("compares the preceding period with the same category, employee and payment filters", () => {
    const report = buildExpenseAnalytics([expense(), expense({ id: "previous", expense_date: "2026-10-08" }), expense({ id: "other", created_by: "someone" })], methods, employees, period, { gasto_categoria: "services", gasto_empleado: "owner", gasto_pago: transfer });
    expect(report.current.amount).toBe(6000);
    expect(report.previous.amount).toBe(6000);
    expect(report.timeline[0]).toMatchObject({ current: 6000, previous: 6000, previousDate: "2026-10-08" });
  });
  it("preserves legacy single payments and unassigned expenses", () => {
    const legacy = expense({ created_by: null, category_id: null, expense_categories: null, payment_method_id: cash, payment_allocations: [] });
    const report = buildExpenseAnalytics([legacy], methods, employees, period, { gasto_empleado: "unassigned", gasto_categoria: "none" });
    expect(report.current.amount).toBe(10000);
    expect(report.details[0]).toMatchObject({ employee: "Histórico / sin identificar", category: "Sin categoría" });
    expect(report.byPayment[0].name).toBe("Efectivo");
  });
  it("handles missing payment metadata and empty results without NaN", () => {
    const report = buildExpenseAnalytics([expense({ payment_method_id: null, payment_allocations: [] })], [], [], period, { gasto_pago: "none" });
    expect(report.byPayment[0].name).toBe("Sin indicar");
    const empty = buildExpenseAnalytics([], methods, employees, period, {});
    expect(empty.current).toEqual({ amount: 0, count: 0, average: 0, dailyAverage: 0 });
  });
  it("accumulates currency in cents", () => {
    const report = buildExpenseAnalytics([expense({ amount: 0.1, payment_allocations: [] }), expense({ id: "two", amount: 0.2, payment_allocations: [] })], [], [], period, {});
    expect(report.current.amount).toBe(0.3);
  });
  it("does not truncate more than 1000 expenses", () => {
    const report = buildExpenseAnalytics(Array.from({ length: 1001 }, (_, index) => expense({ id: String(index), amount: 1, payment_allocations: [] })), methods, employees, period, {});
    expect(report.current).toMatchObject({ count: 1001, amount: 1001 });
  });
});
