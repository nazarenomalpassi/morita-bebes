export type ReportPreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisMonth"
  | "previousMonth"
  | "thisYear"
  | "custom";

export type ReportSearchParams = {
  periodo?: string;
  desde?: string;
  hasta?: string;
  comparar?: string;
  categoria?: string;
  producto?: string;
  empleado?: string;
  pago?: string;
};

export type AnalyticsSummary = {
  revenue: number;
  grossRevenue?: number;
  discounts?: number;
  netRevenue?: number;
  cardSurchargePreview?: number;
  customerChargedTotal?: number;
  saleCount: number;
  averageTicket: number;
  unitsSold: number;
  knownRevenue: number;
  unknownRevenue: number;
  knownCogs: number;
  grossProfitKnown: number;
  grossMarginKnownPct: number | null;
  expenses: number;
  payroll: number;
  operatingExpenses: number;
  expenseToRevenuePct: number | null;
  estimatedResult: number | null;
};

export type AnalyticsReport = {
  meta: {
    from: string;
    to: string;
    compareFrom: string;
    compareTo: string;
    bucket: "day" | "week" | "month";
    generatedAt: string;
    costPolicy: "historical_only";
    timeZone: string;
  };
  summary: { current: AnalyticsSummary; previous: AnalyticsSummary };
  timeline: Array<{
    position: number;
    currentLabel: string;
    previousLabel: string;
    currentRevenue: number;
    previousRevenue: number;
    currentSales: number;
    previousSales: number;
    currentExpenses: number;
    previousExpenses: number;
  }>;
  topProducts: Array<{ id: string; name: string; sku: string; units: number; revenue: number }>;
  categories: Array<{ name: string; units: number; revenue: number }>;
  payments: Array<{ key: string; name: string; operations: number; amount: number }>;
  weekdays: Array<{ weekday: number; name: string; occurrences: number; operations: number; revenue: number; averageRevenue: number }>;
  hours: Array<{ band: string; operations: number; revenue: number }>;
  timeCoverage: { operationsWithKnownTime: number; totalOperations: number };
  employees: Array<{ id: string | null; name: string; operations: number; revenue: number; averageTicket: number; units: number }>;
  expenseCategories: Array<{ name: string; amount: number }>;
  inventory: {
    productCount: number;
    stockUnits: number;
    outOfStock: number;
    lowStock: number;
    excessStock: number;
    costValue: number;
    retailValue: number;
  };
  slowProducts: Array<{
    id: string;
    name: string;
    sku: string;
    stock: number;
    lastSale: string | null;
    daysWithoutSale: number | null;
    immobilizedCost: number;
  }>;
  goal: null | {
    id: string;
    month: string;
    target: number;
    revenue: number;
    progressPct: number;
    remaining: number;
    daysRemaining: number;
    requiredDaily: number | null;
    projectedRevenue: number;
    updatedAt: string;
  };
  goalMonthRevenue: number;
  filters: {
    categories: Array<{ id: string; name: string }>;
    products: Array<{ id: string; name: string; sku: string }>;
    employees: Array<{ id: string; name: string }>;
    paymentMethods: Array<{ key: string; name: string }>;
  };
};

export type ResolvedReportPeriod = {
  preset: ReportPreset;
  from: string;
  to: string;
  compareFrom: string;
  compareTo: string;
  compare: boolean;
  goalMonth: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRESETS = new Set<ReportPreset>(["today", "yesterday", "last7", "last30", "thisMonth", "previousMonth", "thisYear", "custom"]);

function isoInArgentina(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function fromIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = fromIso(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function monthEnd(value: string) {
  const date = fromIso(monthStart(value));
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return toIso(date);
}

function previousMonthEquivalent(from: string, to: string) {
  const start = fromIso(monthStart(from));
  start.setUTCMonth(start.getUTCMonth() - 1);
  const previousStart = toIso(start);
  const day = Math.min(Number(to.slice(8, 10)), Number(monthEnd(previousStart).slice(8, 10)));
  return { from: previousStart, to: `${previousStart.slice(0, 8)}${String(day).padStart(2, "0")}` };
}

function previousEqualRange(from: string, to: string) {
  const days = Math.round((fromIso(to).getTime() - fromIso(from).getTime()) / 86_400_000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export function resolveReportPeriod(params: ReportSearchParams, now = new Date()): ResolvedReportPeriod {
  const today = isoInArgentina(now);
  const requested = PRESETS.has(params.periodo as ReportPreset) ? params.periodo as ReportPreset : "thisMonth";
  let from = monthStart(today);
  let to = today;
  let compare = previousMonthEquivalent(from, to);

  if (requested === "today") {
    from = today;
    to = today;
    compare = { from: addDays(today, -1), to: addDays(today, -1) };
  } else if (requested === "yesterday") {
    from = addDays(today, -1);
    to = from;
    compare = { from: addDays(from, -1), to: addDays(from, -1) };
  } else if (requested === "last7") {
    from = addDays(today, -6);
    to = today;
    compare = previousEqualRange(from, to);
  } else if (requested === "last30") {
    from = addDays(today, -29);
    to = today;
    compare = previousEqualRange(from, to);
  } else if (requested === "previousMonth") {
    const start = fromIso(monthStart(today));
    start.setUTCMonth(start.getUTCMonth() - 1);
    from = toIso(start);
    to = monthEnd(from);
    compare = previousMonthEquivalent(from, to);
  } else if (requested === "thisYear") {
    from = `${today.slice(0, 4)}-01-01`;
    to = today;
    compare = { from: `${Number(today.slice(0, 4)) - 1}-01-01`, to: `${Number(today.slice(0, 4)) - 1}${today.slice(4)}` };
  } else if (requested === "custom") {
    if (params.desde && params.hasta && ISO_DATE.test(params.desde) && ISO_DATE.test(params.hasta) && params.desde <= params.hasta) {
      from = params.desde;
      to = params.hasta;
      compare = previousEqualRange(from, to);
    }
  }

  return {
    preset: requested,
    from,
    to,
    compareFrom: compare.from,
    compareTo: compare.to,
    compare: params.comparar !== "0",
    goalMonth: monthStart(to),
  };
}

export function safeUuid(value: string | undefined) {
  return value && UUID.test(value) ? value : null;
}

export function safePaymentKey(value: string | undefined) {
  return value && value.length <= 180 ? value : null;
}

export function percentageChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function normalizeAnalyticsReport(value: unknown): AnalyticsReport {
  return value as AnalyticsReport;
}

const numberValue = (value: unknown) => Number(value ?? 0);

export function normalizeDiscountSummary(value: unknown) {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const normalizePeriod = (periodValue: unknown) => {
    const period = periodValue && typeof periodValue === "object" ? periodValue as Record<string, unknown> : {};
    return {
      grossRevenue: numberValue(period.gross_revenue),
      discounts: numberValue(period.discounts),
      netRevenue: numberValue(period.net_revenue),
      cardSurchargePreview: numberValue(period.card_surcharge_preview),
      customerChargedTotal: numberValue(period.customer_charged_total),
    };
  };
  return { current: normalizePeriod(data.current), previous: normalizePeriod(data.previous) };
}
