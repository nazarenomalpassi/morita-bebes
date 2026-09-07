import { Building2, Pencil, Search, UserRound, UserX } from "lucide-react";

import { toggleCustomerAction } from "@/app/app/clientes/actions";
import { CustomerForm } from "@/app/app/clientes/customer-form";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;

  const query = (params.q ?? "")
    .slice(0, 80)
    .replace(/[^a-zA-Z0-9À-ÿ@+._\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const showInactive = params.estado === "todos";
  let request = supabase
    .from("customers")
    .select("*")
    .eq("organization_id", organization.id)
    .order("name")
    .limit(500);
  if (!showInactive) request = request.eq("is_active", true);
  if (query) {
    request = request.or(
      `name.ilike.%${query}%,phone.ilike.%${query}%,whatsapp.ilike.%${query}%`,
    );
  }

  const { data: customers, error } = await request;
  if (error) throw new Error("No se pudieron cargar los clientes.");

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <span className="eyebrow">Base comercial</span>
          <h1 className="page-title mt-2">Clientes</h1>
          <p className="page-lead">Datos de contacto para ventas minoristas y mayoristas.</p>
        </div>
        <details className="header-details">
          <summary className="button button-primary"><UserRound size={17} /> Nuevo cliente</summary>
          <div className="details-panel"><CustomerForm /></div>
        </details>
      </header>

      <form className="filter-bar" method="get">
        <label className="search-field filter-search">
          <Search aria-hidden="true" size={18} />
          <span className="sr-only">Buscar clientes</span>
          <input defaultValue={query} name="q" placeholder="Buscar por nombre o teléfono" type="search" />
        </label>
        <select className="field-input filter-select" defaultValue={showInactive ? "todos" : "activos"} name="estado">
          <option value="activos">Solo activos</option>
          <option value="todos">Todos</option>
        </select>
        <button className="button button-secondary" type="submit">Aplicar</button>
      </form>

      <div className="entity-list">
        {(customers ?? []).map((customer) => (
          <article className="entity-row" key={customer.id}>
            <span className="entity-avatar" aria-hidden="true">
              {customer.is_wholesale ? <Building2 size={19} /> : <UserRound size={19} />}
            </span>
            <div className="entity-copy">
              <strong>{customer.name}</strong>
              <small>{[customer.whatsapp || customer.phone, customer.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</small>
            </div>
            {customer.is_wholesale && <span className="tag">Mayorista</span>}
            {!customer.is_active && <span className="tag tag-muted">Inactivo</span>}
            <details className="row-editor">
              <summary className="icon-button" title="Editar cliente"><Pencil size={17} /></summary>
              <div className="row-editor-panel"><CustomerForm values={customer} /></div>
            </details>
            <form action={toggleCustomerAction}>
              <input name="id" type="hidden" value={customer.id} />
              <input name="active" type="hidden" value={String(!customer.is_active)} />
              <button className="icon-button" title={customer.is_active ? "Desactivar" : "Reactivar"} type="submit">
                <UserX size={17} />
              </button>
            </form>
          </article>
        ))}
        {(customers?.length ?? 0) === 0 && <p className="inline-empty">No hay clientes para estos filtros.</p>}
      </div>
    </div>
  );
}
