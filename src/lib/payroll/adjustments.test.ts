import { describe, expect, it } from "vitest";

import { enrichPayrollDashboard } from "./adjustments";
import type { PayrollDashboard } from "./dashboard";

const dashboard = {
  meta: {
    periodMonth: "2026-08-01",
    periodEnd: "2026-08-31",
    currentDate: "2026-08-20",
    daysElapsed: 20,
    daysInMonth: 31,
    isCurrentMonth: true,
    projectionAvailable: true,
    scope: "total_store_sales",
    generatedAt: "2026-08-20T12:00:00Z",
    employeeLinked: true,
  },
  employees: [{
    id: "employee-1",
    userId: null,
    name: "Nahir Asieri",
    status: "active",
    configured: true,
    compensationId: "compensation-1",
    baseSalary: 700000,
    commissionPercentage: 1,
    commissionType: "total_store_sales",
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
    grossSales: 5000000,
    salesCount: 20,
    commissionAmount: 50000,
    estimatedSalary: 750000,
    projectedSales: 10000000,
    projectedCommission: 100000,
    projectedSalary: 800000,
    lastUpdated: "2026-08-20T12:00:00Z",
    settlement: null,
  }],
} as unknown as PayrollDashboard;

describe("enrichPayrollDashboard", () => {
  it("subtracts advances and deductions while preserving the gross salary", () => {
    const result = enrichPayrollDashboard(dashboard, [
      {
        id: "advance-1",
        employee_id: "employee-1",
        kind: "advance",
        amount: 100000,
        paid_at: null,
        period_month: "2026-08-01",
        notes: "Adelanto desde gastos",
        expense_id: "expense-1",
        expenses: {
          expense_date: "2026-08-12",
          description: "Adelanto de agosto",
          payment_methods: { name: "Transferencia" },
        },
      },
      {
        id: "bonus-1",
        employee_id: "employee-1",
        kind: "bonus",
        amount: 20000,
        paid_at: "2026-08-15",
        period_month: "2026-08-01",
        notes: "Bono",
        expense_id: null,
        expenses: null,
      },
      {
        id: "deduction-1",
        employee_id: "employee-1",
        kind: "deduction",
        amount: 10000,
        paid_at: null,
        period_month: "2026-08-01",
        notes: "Descuento",
        expense_id: null,
        expenses: null,
      },
    ], []);

    expect(result.employees[0]).toMatchObject({
      grossSalary: 750000,
      advanceAmount: 100000,
      bonusAmount: 20000,
      deductionAmount: 10000,
      estimatedSalary: 660000,
      projectedSalary: 710000,
    });
    expect(result.employees[0].adjustments).toHaveLength(3);
    expect(result.employees[0].adjustments[0]).toMatchObject({
      description: "Adelanto de agosto",
      occurredOn: "2026-08-12",
      sourceType: "expense",
      paymentMethodName: "Transferencia",
    });
    expect(result.employees[0].adjustments[1].paymentMethodName).toBeNull();
  });
});
