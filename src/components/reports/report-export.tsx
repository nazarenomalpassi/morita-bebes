"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";

export function ReportExport({ from, to }: { from: string; to: string }) {
  const search = useSearchParams();
  const expenses = search.get("vista") === "expenses";
  const query = new URLSearchParams({ desde: from, hasta: to });
  if (expenses) for (const field of ["gasto_categoria", "gasto_empleado", "gasto_pago"]) {
    const value = search.get(field);
    if (value) query.set(field, value);
  }
  return <a className="button button-secondary" href={`/api/reportes/${expenses ? "gastos" : "gestion"}?${query}`}><Download aria-hidden="true" size={17} /> Exportar Excel</a>;
}
