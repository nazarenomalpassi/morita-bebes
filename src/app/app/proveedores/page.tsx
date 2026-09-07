import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Plus,
  Search,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeSearch(value: string) {
  return value.slice(0, 80).replace(/[^a-zA-Z0-9À-ÿ\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function pageHref(q: string, status: string, page: number) {
  const params = new URLSearchParams({ page: String(page), status });
  if (q) params.set("q", q);
  return `/app/proveedores?${params.toString()}`;
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = safeSearch(first(params.q));
  const status = first(params.status) || "active";
  const parsedPage = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/app");
  let query = supabase
    .from("suppliers")
    .select("id, business_name, contact_name, phone, whatsapp, email, is_active, products(count)", { count: "exact" })
    .eq("organization_id", organization.id);
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`business_name.ilike.${pattern},contact_name.ilike.${pattern},email.ilike.${pattern}`);
  }
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (status === "incomplete") {
    query = query.eq("is_active", true).or("contact_name.is.null,whatsapp.is.null,email.is.null");
  }
  const from = (page - 1) * PAGE_SIZE;
  const { count, data: suppliers, error } = await query.order("business_name").range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error("No se pudieron cargar los proveedores.");
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <span className="eyebrow">Compras</span>
          <h1 className="page-title mt-2">Proveedores</h1>
          <p className="page-lead">{total} proveedores. Completá sus contactos gradualmente para preparar los pedidos por faltantes.</p>
        </div>
        <Link className="button button-primary gap-2" href="/app/proveedores/nuevo"><Plus size={17} /> Nuevo proveedor</Link>
      </header>

      <form className="mt-7 grid gap-3 border-y border-[var(--line)] py-4 md:grid-cols-[minmax(15rem,1fr)_minmax(10rem,0.45fr)_auto]" method="get">
        <label className="input-shell input-shell-start"><span className="sr-only">Buscar proveedor</span><Search aria-hidden="true" size={17} /><input className="field-input" defaultValue={q} maxLength={80} name="q" placeholder="Nombre, contacto o correo" /></label>
        <label><span className="sr-only">Filtrar estado</span><select className="field-input" defaultValue={status} name="status"><option value="all">Todos</option><option value="active">Activos</option><option value="incomplete">Datos pendientes</option><option value="inactive">Inactivos</option></select></label>
        <button className="button button-secondary gap-2" type="submit"><Search size={17} /> Filtrar</button>
      </form>

      {suppliers?.length ? (
        <>
          <div className="data-table-wrap" data-mobile-cards>
            <table className="data-table min-w-[58rem]">
              <thead><tr><th>Proveedor</th><th>Contacto</th><th>WhatsApp / teléfono</th><th>Productos</th><th>Datos</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {suppliers.map((supplier) => {
                  const incomplete = !supplier.contact_name || !supplier.whatsapp || !supplier.email;
                  return (
                    <tr className={supplier.is_active ? "" : "opacity-60"} key={supplier.id}>
                      <td data-label="Proveedor"><strong>{supplier.business_name}</strong><small>{supplier.email ?? "Correo pendiente"}</small></td>
                      <td data-label="Contacto">{supplier.contact_name ?? "Pendiente"}</td>
                      <td data-label="WhatsApp / teléfono">{supplier.whatsapp ?? supplier.phone ?? "Pendiente"}</td>
                      <td data-label="Productos">{supplier.products?.[0]?.count ?? 0}</td>
                      <td data-label="Datos">{!supplier.is_active ? <span className="table-status text-[var(--ink-muted)]"><CircleOff size={14} /> Inactivo</span> : incomplete ? <span className="table-status table-status-alert">Pendiente</span> : <span className="table-status table-status-ok"><CheckCircle2 size={14} /> Completo</span>}</td>
                      <td className="text-right" data-label=""><Link className="font-bold text-[var(--plum)] no-underline hover:underline" href={`/app/proveedores/${supplier.id}/editar`}>Editar</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-3 text-sm text-[var(--ink-muted)]">
            <span>Página {Math.min(page, totalPages)} de {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 ? <Link aria-label="Página anterior" className="button button-secondary h-10 min-h-10 px-3" href={pageHref(q, status, page - 1)}><ChevronLeft size={17} /></Link> : null}
              {page < totalPages ? <Link aria-label="Página siguiente" className="button button-secondary h-10 min-h-10 px-3" href={pageHref(q, status, page + 1)}><ChevronRight size={17} /></Link> : null}
            </div>
          </nav>
        </>
      ) : (
        <section className="empty-state"><span className="empty-state-icon"><Truck size={28} /></span><h2>No encontramos proveedores</h2><p>Podés crear solo el nombre y dejar el contacto pendiente para completarlo después.</p><Link className="button button-primary mt-4 gap-2" href="/app/proveedores/nuevo"><Plus size={17} /> Nuevo proveedor</Link></section>
      )}
    </div>
  );
}
