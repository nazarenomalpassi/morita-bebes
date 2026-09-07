import { ScrollText, UserRoundX } from "lucide-react";

import { getCurrentOrganization } from "@/lib/data/current-organization";
import { dateTime } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";

const actionLabels: Record<string, string> = {
  cancel_expense: "Anulación de gasto",
  cancel_sale: "Anulación de venta",
  change_member_status: "Cambio de estado de usuario",
  change_role: "Cambio de rol",
  create_sale: "Venta registrada",
  insert_expenses: "Gasto registrado",
  insert_products: "Producto creado",
  login: "Inicio de sesión",
  stock_adjustment: "Ajuste manual de stock",
  update_expenses: "Gasto modificado",
  update_products: "Producto modificado",
};

const roleLabels: Record<string, string> = {
  owner: "Administrador principal",
  admin: "Administrador",
  staff: "Empleado",
  sistema: "Sistema",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function metadataObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  if (organization.role === "staff") {
    return <div className="page-container permission-state"><UserRoundX size={30} /><h1>Acceso restringido</h1><p>La auditoría está disponible solo para administradores.</p></div>;
  }

  const employee = first(params.empleado);
  const action = first(params.accion).slice(0, 80);
  let logsQuery = supabase
    .from("audit_logs")
    .select("id, user_id, action, entity_type, entity_id, created_at, metadata")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (/^[0-9a-f-]{36}$/i.test(employee)) logsQuery = logsQuery.eq("user_id", employee);
  if (action) logsQuery = logsQuery.eq("action", action);

  const [logsResult, membersResult] = await Promise.all([
    logsQuery,
    supabase.rpc("list_organization_members", { p_organization_id: organization.id }),
  ]);
  if (logsResult.error || membersResult.error) throw new Error("No se pudo cargar la auditoría.");

  const actions = Array.from(new Set((logsResult.data ?? []).map((log) => log.action))).sort();

  return (
    <div className="page-container page-container-wide">
      <header className="page-header"><div><span className="eyebrow">Trazabilidad</span><h1 className="page-title mt-2">Auditoría</h1><p className="page-lead">Acciones sensibles, responsables y cambios registrados por el sistema.</p></div><ScrollText size={28} /></header>

      <form className="mt-7 grid gap-3 border-y border-[var(--line)] py-4 sm:grid-cols-[1fr_1fr_auto]" method="get">
        <label className="field-label">Empleado<select className="field-input" defaultValue={employee} name="empleado"><option value="">Todos</option>{(membersResult.data ?? []).map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email || member.user_id}</option>)}</select></label>
        <label className="field-label">Acción<select className="field-input" defaultValue={action} name="accion"><option value="">Todas</option>{actions.map((item) => <option key={item} value={item}>{actionLabels[item] ?? item}</option>)}</select></label>
        <button className="button button-secondary self-end" type="submit">Filtrar</button>
      </form>

      <div className="data-table-wrap mt-6" data-mobile-cards>
        <table className="data-table min-w-[58rem]">
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
          <tbody>
            {(logsResult.data ?? []).map((log) => {
              const metadata = metadataObject(log.metadata);
              return (
                <tr key={log.id}>
                  <td data-label="Fecha">{dateTime.format(new Date(log.created_at))}</td>
                  <td data-label="Usuario"><strong>{String(metadata.actor_name ?? metadata.actor_email ?? "Sistema")}</strong>{metadata.actor_name && metadata.actor_email ? <small>{String(metadata.actor_email)}</small> : null}</td>
                  <td data-label="Rol">{roleLabels[String(metadata.actor_role ?? "sistema")] ?? String(metadata.actor_role)}</td>
                  <td data-label="Acción"><span className="tag">{actionLabels[log.action] ?? log.action}</span></td>
                  <td data-label="Entidad">{log.entity_type}{log.entity_id ? <small className="font-mono">{log.entity_id.slice(0, 8)}</small> : null}</td>
                  <td data-label="Detalle">{String(metadata.description ?? "Cambio registrado")}</td>
                </tr>
              );
            })}
            {(logsResult.data?.length ?? 0) === 0 ? <tr><td className="table-empty-cell" colSpan={6}>No hay eventos para los filtros seleccionados.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
