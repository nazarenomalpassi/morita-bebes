import { MapPin, Pencil, Phone, Search, UserRoundPlus, UserX } from "lucide-react";

import { toggleCommissionAgentAction } from "@/app/app/comisionistas/actions";
import { CommissionAgentForm } from "@/app/app/comisionistas/commission-agent-form";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CommissionAgentsPage({
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
    .replace(/[^a-zA-Z0-9À-ÿ+().\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const showInactive = params.estado === "todos";
  const canManage = organization.role === "owner" || organization.role === "admin";

  let request = supabase
    .from("commission_agents")
    .select("id, first_name, last_name, phone, route_description, notes, is_active")
    .eq("organization_id", organization.id)
    .order("last_name")
    .order("first_name")
    .limit(500);
  if (!showInactive) request = request.eq("is_active", true);
  if (query) {
    request = request.or(
      `first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%,route_description.ilike.%${query}%`,
    );
  }

  const { data: agents, error } = await request;
  if (error) throw new Error("No se pudieron cargar los comisionistas.");

  return (
    <div className="page-container commission-agents-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Agenda logística</span>
          <h1 className="page-title mt-2">Comisionistas</h1>
          <p className="page-lead">Contactos y recorridos para coordinar el traslado de mercadería.</p>
        </div>
        {canManage ? (
          <details className="header-details">
            <summary className="button button-primary"><UserRoundPlus size={17} /> Nuevo comisionista</summary>
            <div className="details-panel"><CommissionAgentForm /></div>
          </details>
        ) : null}
      </header>

      <form className="filter-bar" method="get">
        <label className="search-field filter-search">
          <Search aria-hidden="true" size={18} />
          <span className="sr-only">Buscar comisionistas</span>
          <input defaultValue={query} name="q" placeholder="Nombre, teléfono o zona" type="search" />
        </label>
        {canManage ? (
          <select className="field-input filter-select" defaultValue={showInactive ? "todos" : "activos"} name="estado">
            <option value="activos">Solo activos</option>
            <option value="todos">Todos</option>
          </select>
        ) : null}
        <button className="button button-secondary" type="submit">Buscar</button>
      </form>

      <div className="commission-agent-grid">
        {(agents ?? []).map((agent) => (
          <article className="commission-agent-card" key={agent.id}>
            <div className="commission-agent-heading">
              <div>
                <strong>{agent.first_name} {agent.last_name}</strong>
                {!agent.is_active ? <span className="tag tag-muted">Inactivo</span> : null}
              </div>
              {canManage ? (
                <div className="commission-agent-actions">
                  <details className="row-editor">
                    <summary aria-label={`Editar a ${agent.first_name} ${agent.last_name}`} className="icon-button" title="Editar comisionista"><Pencil size={17} /></summary>
                    <div className="row-editor-panel"><CommissionAgentForm values={agent} /></div>
                  </details>
                  <form action={toggleCommissionAgentAction}>
                    <input name="id" type="hidden" value={agent.id} />
                    <input name="active" type="hidden" value={String(!agent.is_active)} />
                    <button aria-label={agent.is_active ? "Desactivar comisionista" : "Reactivar comisionista"} className="icon-button" title={agent.is_active ? "Desactivar" : "Reactivar"} type="submit"><UserX size={17} /></button>
                  </form>
                </div>
              ) : null}
            </div>
            <a className="commission-agent-phone" href={`tel:${agent.phone.replace(/[^\d+]/g, "")}`}><Phone size={16} /> {agent.phone}</a>
            <p><MapPin size={16} /> <span>{agent.route_description}</span></p>
            {agent.notes ? <small>{agent.notes}</small> : null}
          </article>
        ))}
        {(agents?.length ?? 0) === 0 ? <p className="inline-empty">No hay comisionistas para esta búsqueda.</p> : null}
      </div>
    </div>
  );
}
