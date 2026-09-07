import { KeyRound, MailCheck, Power, Save, ShieldCheck, UserRoundX, UsersRound } from "lucide-react";

import { resetMemberPasswordAction, updateMemberAction } from "@/app/app/usuarios/actions";
import { MemberForm } from "@/app/app/usuarios/member-form";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { dateTime } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const roleLabels = { owner: "Administrador principal", admin: "Administrador", staff: "Empleado" } as const;

export default async function UsersPage() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  if (organization.role === "staff") {
    return <div className="page-container permission-state"><UserRoundX size={30} /><h1>Acceso restringido</h1><p>La administración de accesos está disponible solo para administradores.</p></div>;
  }

  const membersResult = await supabase.rpc("list_organization_members", { p_organization_id: organization.id });
  if (membersResult.error) throw new Error("No se pudo consultar el equipo de usuarios.");
  const members = membersResult.data ?? [];

  return (
    <div className="page-container">
      <header className="page-header"><div><span className="eyebrow">Seguridad y permisos</span><h1 className="page-title mt-2">Usuarios y empleados</h1><p className="page-lead">Invitaciones seguras, perfiles y estado de acceso al sistema.</p></div></header>

      <section className="settings-section member-add-section">
        <div className="section-heading-row"><div><span className="eyebrow">Nuevo acceso</span><h2>Invitar usuario</h2></div><KeyRound size={21} /></div>
        <MemberForm canAssignOwner={organization.role === "owner"} />
      </section>

      <section className="records-section">
        <div className="section-heading-row"><div><span className="eyebrow">Equipo</span><h2>Usuarios del comercio</h2></div><UsersRound size={21} /></div>
        <div className="entity-list">
          {members.map((member) => {
            const canManage = organization.role === "owner" || member.role !== "owner";
            return (
              <article className="entity-row" key={member.user_id}>
                <span className="entity-avatar"><ShieldCheck size={18} /></span>
                <div className="entity-copy">
                  <strong>{member.display_name || member.email || "Usuario"}</strong>
                  <small>{member.email || "Sin correo"} · {member.last_login_at ? `Último ingreso ${dateTime.format(new Date(member.last_login_at))}` : "Todavía no ingresó"}</small>
                </div>
                <span className={`tag ${member.is_active ? "" : "tag-muted"}`}>{member.is_active ? roleLabels[member.role] : "Inactivo"}</span>
                {canManage ? (
                  <div className="member-row-form">
                    <form action={updateMemberAction} className="contents">
                      <input name="user_id" type="hidden" value={member.user_id} />
                      <select aria-label="Perfil" className="field-input" defaultValue={member.role} name="role">
                        <option value="staff">Empleado</option>
                        <option value="admin">Administrador</option>
                        {organization.role === "owner" ? <option value="owner">Administrador principal</option> : null}
                      </select>
                      <input name="current_active" type="hidden" value={String(member.is_active)} />
                      <button className="icon-button" name="intent" title="Guardar perfil" type="submit" value="save"><Save size={16} /></button>
                      {member.is_active ? <ConfirmSubmitButton className="icon-button" message={`¿Desactivar el acceso de ${member.email}?`} name="intent" title="Desactivar acceso" value="toggle"><Power size={16} /></ConfirmSubmitButton> : <button className="icon-button" name="intent" title="Reactivar acceso" type="submit" value="toggle"><Power size={16} /></button>}
                    </form>
                    {member.email ? <form action={resetMemberPasswordAction}><input name="email" type="hidden" value={member.email} /><button className="icon-button" title="Enviar recuperación de contraseña" type="submit"><MailCheck size={16} /></button></form> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
