import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { paginationHref } from "@/lib/data/pagination";

export function ManagementPagination({ path, params, page, total, size = 50, pageKey = "pagina", hash = "", label = "Paginación" }: {
  path: string; params: Record<string, string | undefined>; page: number; total: number; size?: number; pageKey?: string; hash?: string; label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1 && page === 1) return null;
  return <nav aria-label={label} className="management-pagination"><span>Página {page} de {pages} · {total} registros</span><div>{page > 1 ? <Link aria-label="Página anterior" className="button button-secondary" href={paginationHref(path, params, pageKey, Math.min(page - 1, pages), hash)}><ChevronLeft size={17} /> Anterior</Link> : null}{page < pages ? <Link aria-label="Página siguiente" className="button button-secondary" href={paginationHref(path, params, pageKey, page + 1, hash)}>Siguiente <ChevronRight size={17} /></Link> : null}</div></nav>;
}
