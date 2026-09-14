import type {
  PayrollAdjustment,
  PayrollDashboard,
} from "@/lib/payroll/dashboard";

type LiveMovement = {
  id: string;
  employee_id: string;
  kind: "salary" | "advance" | "bonus" | "deduction";
  amount: number;
  paid_at: string | null;
  period_month: string;
  notes: string | null;
  expense_id: string | null;
  voided_at?: string | null;
  expenses?: { expense_date: string; description: string } | null;
};

type SettlementAdjustment = {
  id: string;
  kind: "salary" | "advance" | "bonus" | "deduction";
  amount: number;
  occurred_on: string;
  description: string;
  source_type: string;
};

type SettlementRow = {
  id: string;
  employee_id: string;
  period_month: string;
  voided_at?: string | null;
  bonus_amount: number;
  advance_amount: number;
  deduction_amount: number;
  net_salary: number;
  payroll_settlement_adjustments?: SettlementAdjustment[];
};

function liveAdjustment(movement: LiveMovement): PayrollAdjustment | null {
  if (movement.kind === "salary") return null;
  return {
    id: movement.id,
    kind: movement.kind,
    amount: Number(movement.amount),
    occurredOn: movement.expenses?.expense_date ?? movement.paid_at ?? movement.period_month,
    description: movement.expenses?.description ?? movement.notes ?? "Ajuste salarial",
    sourceType: movement.expense_id ? "expense" : "manual",
  };
}

function snapshotAdjustment(adjustment: SettlementAdjustment): PayrollAdjustment | null {
  if (adjustment.kind === "salary") return null;
  return {
    id: adjustment.id,
    kind: adjustment.kind,
    amount: Number(adjustment.amount),
    occurredOn: adjustment.occurred_on,
    description: adjustment.description,
    sourceType: adjustment.source_type === "expense" ? "expense" : "manual",
  };
}

export function enrichPayrollDashboard(
  dashboard: PayrollDashboard,
  movements: LiveMovement[],
  settlements: SettlementRow[],
): PayrollDashboard {
  return {
    ...dashboard,
    employees: dashboard.employees.map((employee) => {
      const liveAdjustments = movements
        .filter((movement) => movement.employee_id === employee.id && !movement.voided_at)
        .flatMap((movement) => {
          const adjustment = liveAdjustment(movement);
          return adjustment ? [adjustment] : [];
        });
      const settlementRow = settlements.find((settlement) => (
        settlement.employee_id === employee.id
        && !settlement.voided_at
        && settlement.period_month.slice(0, 7) === dashboard.meta.periodMonth.slice(0, 7)
      ));

      if (employee.settlement && settlementRow) {
        const adjustments = (settlementRow.payroll_settlement_adjustments ?? [])
          .flatMap((adjustment) => {
            const normalized = snapshotAdjustment(adjustment);
            return normalized ? [normalized] : [];
          });
        return {
          ...employee,
          grossSalary: employee.settlement.grossSalary,
          bonusAmount: Number(settlementRow.bonus_amount),
          advanceAmount: Number(settlementRow.advance_amount),
          deductionAmount: Number(settlementRow.deduction_amount),
          estimatedSalary: Number(settlementRow.net_salary),
          adjustments,
          settlement: {
            ...employee.settlement,
            bonusAmount: Number(settlementRow.bonus_amount),
            advanceAmount: Number(settlementRow.advance_amount),
            deductionAmount: Number(settlementRow.deduction_amount),
            netSalary: Number(settlementRow.net_salary),
            adjustments,
          },
        };
      }

      const bonusAmount = liveAdjustments
        .filter((adjustment) => adjustment.kind === "bonus")
        .reduce((sum, adjustment) => sum + adjustment.amount, 0);
      const advanceAmount = liveAdjustments
        .filter((adjustment) => adjustment.kind === "advance")
        .reduce((sum, adjustment) => sum + adjustment.amount, 0);
      const deductionAmount = liveAdjustments
        .filter((adjustment) => adjustment.kind === "deduction")
        .reduce((sum, adjustment) => sum + adjustment.amount, 0);
      const grossSalary = employee.estimatedSalary;
      const netSalary = Math.max(0, grossSalary + bonusAmount - advanceAmount - deductionAmount);

      return {
        ...employee,
        grossSalary,
        bonusAmount,
        advanceAmount,
        deductionAmount,
        estimatedSalary: netSalary,
        projectedSalary: employee.projectedSalary === null
          ? null
          : Math.max(0, employee.projectedSalary + bonusAmount - advanceAmount - deductionAmount),
        adjustments: liveAdjustments,
      };
    }),
  };
}
