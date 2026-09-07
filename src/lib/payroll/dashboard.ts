import { ARGENTINA_TIME_ZONE } from "@/lib/date";

export type PayrollSettlementSnapshot = {
  id: string;
  periodMonth: string;
  baseSalary: number;
  commissionPercentage: number;
  commissionBase: number;
  commissionAmount: number;
  grossSalary: number;
  bonusAmount: number;
  advanceAmount: number;
  deductionAmount: number;
  netSalary: number;
  salesCount: number;
  status: "settled" | "paid";
  settledAt: string;
  paidAt: string | null;
  paymentMethod: string | null;
  notes: string | null;
  adjustments: PayrollAdjustment[];
};

export type PayrollAdjustment = {
  id: string;
  kind: "advance" | "bonus" | "deduction";
  amount: number;
  occurredOn: string;
  description: string;
  sourceType: "manual" | "expense";
};

export type PayrollEmployeeSummary = {
  id: string;
  userId: string | null;
  name: string;
  status: "active" | "inactive";
  configured: boolean;
  compensationId: string | null;
  baseSalary: number;
  commissionPercentage: number;
  commissionType: "total_store_sales";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  grossSales: number;
  salesCount: number;
  commissionAmount: number;
  grossSalary: number;
  bonusAmount: number;
  advanceAmount: number;
  deductionAmount: number;
  estimatedSalary: number;
  projectedSales: number | null;
  projectedCommission: number | null;
  projectedSalary: number | null;
  lastUpdated: string | null;
  adjustments: PayrollAdjustment[];
  settlement: PayrollSettlementSnapshot | null;
};

export type PayrollDashboard = {
  meta: {
    periodMonth: string;
    periodEnd: string;
    currentDate: string;
    daysElapsed: number;
    daysInMonth: number;
    isCurrentMonth: boolean;
    projectionAvailable: boolean;
    scope: "total_store_sales";
    generatedAt: string;
    employeeLinked: boolean;
  };
  employees: PayrollEmployeeSummary[];
};

export function currentYearMonth(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ARGENTINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).format(date).slice(0, 7);
}

export function payrollMonthLabel(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 7)}-15T12:00:00Z`));
}

export function payrollProgress(daysElapsed: number, daysInMonth: number) {
  if (daysInMonth <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((daysElapsed / daysInMonth) * 100)));
}
