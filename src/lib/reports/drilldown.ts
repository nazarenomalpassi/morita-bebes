import type { ReportSearchParams } from "./analytics";

export function expenseDetailsHref(from: string, to: string, search: ReportSearchParams) {
  const params = new URLSearchParams({ desde: from, hasta: to, estado: "posted" });
  for (const [target, source] of [["categoria", "gasto_categoria"], ["empleado", "gasto_empleado"], ["pago", "gasto_pago"]] as const) if (search[source]) params.set(target, search[source]!);
  return `/app/gastos?${params}`;
}
