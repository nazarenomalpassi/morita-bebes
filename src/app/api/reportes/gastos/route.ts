import ExcelJS from "exceljs";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { isIsoDate } from "@/lib/date";
import { resolveReportPeriod } from "@/lib/reports/analytics";
import { loadExpenseAnalytics } from "@/lib/reports/expense-data";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("desde"), to = params.get("hasta");
  if (!isIsoDate(from) || !isIsoDate(to) || from > to || Date.parse(to) - Date.parse(from) > 730 * 86400000) return new Response("Rango de fechas inválido", { status: 400 });
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return new Response("No autorizado", { status: 401 });
  if (organization.role === "staff") return new Response("Acceso restringido", { status: 403 });
  const members = await supabase.rpc("list_organization_members", { p_organization_id: organization.id });
  if (members.error) return new Response("No se pudo preparar el reporte", { status: 500 });
  const period = resolveReportPeriod({ periodo: "custom", desde: from, hasta: to });
  let report;
  try {
    report = await loadExpenseAnalytics(supabase, organization.id, period, {
      gasto_categoria: params.get("gasto_categoria") ?? undefined, gasto_empleado: params.get("gasto_empleado") ?? undefined, gasto_pago: params.get("gasto_pago") ?? undefined,
    }, (members.data ?? []).map((member) => ({ id: member.user_id, name: member.display_name || member.email || "Usuario" })));
  } catch { return new Response("No se pudo preparar el reporte", { status: 500 }); }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Morita Bebes";
  const summary = workbook.addWorksheet("Resumen gastos");
  summary.addRows([["Indicador", "Valor"], ["Desde", from], ["Hasta", to], ["Total de gastos", report.current.amount], ["Cantidad de gastos", report.current.count], ["Gasto promedio", report.current.average], ["Promedio diario", report.current.dailyAverage], ["Alcance", "Gastos vigentes; excluye Personal"], ["Categoría", report.filters.categories.find((item) => item.id === params.get("gasto_categoria"))?.name ?? "Todas"], ["Medio de pago", report.filters.paymentMethods.find((item) => item.key === params.get("gasto_pago"))?.name ?? "Todos"]]);
  for (const row of [4, 6, 7]) summary.getCell(`B${row}`).numFmt = '"$"#,##0.00';
  const details = workbook.addWorksheet("Detalle");
  details.columns = [{ header: "Fecha", key: "date" }, { header: "Descripción", key: "description" }, { header: "Categoría", key: "category" }, { header: "Realizado por", key: "employee" }, { header: "Medios de pago", key: "payments" }, { header: "Importe filtrado", key: "filteredAmount" }, { header: "Total del gasto", key: "amount" }];
  details.addRows(report.details.map((row) => ({ ...row, payments: row.payments.map((payment) => `${payment.name}: ${payment.amount}`).join(" + ") })));
  details.getColumn("filteredAmount").numFmt = details.getColumn("amount").numFmt = '"$"#,##0.00';
  for (const [title, rows] of [["Por categoría", report.byCategory.map((row) => [row.name, row.amount])], ["Medios de egreso", report.byPayment.map((row) => [row.name, row.amount])]] as const) {
    const sheet = workbook.addWorksheet(title);
    sheet.addRows([["Concepto", "Importe"], ...rows]);
    sheet.getColumn(2).numFmt = '"$"#,##0.00';
  }
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5D506D" } };
    sheet.columns.forEach((column) => { column.width = 28; });
  }
  return new Response(new Uint8Array(await workbook.xlsx.writeBuffer()), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="morita-gastos-${from}-${to}.xlsx"`, "Cache-Control": "private, no-store",
  } });
}
