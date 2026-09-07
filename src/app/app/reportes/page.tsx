import { Download, ShieldAlert } from "lucide-react";

import { AnalyticsDashboard } from "@/components/reports/analytics-dashboard";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import {
  normalizeAnalyticsReport,
  normalizeDiscountSummary,
  resolveReportPeriod,
  safePaymentKey,
  safeUuid,
  type ReportSearchParams,
} from "@/lib/reports/analytics";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RawSearchParams = Record<string, string | string[] | undefined>;

function lastValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.at(-1) : value;
}

function normalizeSearchParams(raw: RawSearchParams): ReportSearchParams {
  return {
    periodo: lastValue(raw.periodo),
    desde: lastValue(raw.desde),
    hasta: lastValue(raw.hasta),
    comparar: lastValue(raw.comparar),
    categoria: lastValue(raw.categoria),
    producto: lastValue(raw.producto),
    empleado: lastValue(raw.empleado),
    pago: lastValue(raw.pago),
  };
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const search = normalizeSearchParams(await searchParams);
  const period = resolveReportPeriod(search);
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  if (organization.role === "staff") {
    return <div className="page-container permission-state"><ShieldAlert size={30} /><h1>Acceso restringido</h1><p>Los reportes financieros están disponibles para dueños y administradores.</p></div>;
  }

  const employee = safeUuid(search.empleado);
  const analyticsArgs = {
    p_organization_id: organization.id,
    p_from: period.from,
    p_to: period.to,
    p_compare_from: period.compareFrom,
    p_compare_to: period.compareTo,
    p_goal_month: period.goalMonth,
    p_category_id: safeUuid(search.categoria) ?? undefined,
    p_product_id: safeUuid(search.producto) ?? undefined,
    p_created_by: employee ?? undefined,
    p_unassigned_only: search.empleado === "unassigned",
    p_payment_key: safePaymentKey(search.pago) ?? undefined,
  };
  const [analyticsResult, discountResult] = await Promise.all([
    supabase.rpc("get_business_analytics", analyticsArgs),
    supabase.rpc("get_sales_discount_summary", {
      p_organization_id: organization.id,
      p_from: period.from,
      p_to: period.to,
      p_compare_from: period.compareFrom,
      p_compare_to: period.compareTo,
      p_category_id: safeUuid(search.categoria) ?? undefined,
      p_product_id: safeUuid(search.producto) ?? undefined,
      p_created_by: employee ?? undefined,
      p_unassigned_only: search.empleado === "unassigned",
      p_payment_key: safePaymentKey(search.pago) ?? undefined,
    }),
  ]);

  if (analyticsResult.error || !analyticsResult.data || discountResult.error) {
    console.error("No se pudo cargar el panel analítico", analyticsResult.error ?? discountResult.error);
    return <div className="page-container permission-state"><BarChartError /><h1>No pudimos preparar los reportes</h1><p>Reintentá en unos minutos. Los datos operativos no fueron modificados.</p></div>;
  }
  const report = normalizeAnalyticsReport(analyticsResult.data);
  const discountSummary = normalizeDiscountSummary(discountResult.data);
  report.summary.current = { ...report.summary.current, ...discountSummary.current };
  report.summary.previous = { ...report.summary.previous, ...discountSummary.previous };
  const query = new URLSearchParams({ desde: period.from, hasta: period.to });

  return <div className="page-container analytics-page">
    <header className="page-header analytics-page-header">
      <div><span className="eyebrow">Análisis del negocio</span><h1 className="page-title mt-2">Reportes y estadísticas</h1><p className="page-lead">Indicadores comerciales, metas, ventas, stock y rentabilidad con datos conciliados.</p></div>
      <a className="button button-secondary" href={`/api/reportes/gestion?${query.toString()}`}><Download size={17} /> Exportar Excel</a>
    </header>
    <AnalyticsDashboard period={period} report={report} search={search} />
  </div>;
}

function BarChartError() {
  return <ShieldAlert size={30} />;
}
