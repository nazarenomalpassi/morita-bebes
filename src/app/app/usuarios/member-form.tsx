"use client";

import { UserPlus } from "lucide-react";
import { useActionState } from "react";

import { addMemberAction } from "@/app/app/usuarios/actions";
import type { ActionState } from "@/lib/actions/form-state";

export function MemberForm({ canAssignOwner }: { canAssignOwner: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addMemberAction, {});
  return (
    <form action={action} className="inline-create-form member-form">
      <label className="field-label">Nombre<input className="field-input" maxLength={120} minLength={2} name="display_name" required /></label>
      <label className="field-label">Correo<input className="field-input" name="email" required type="email" /></label>
      <label className="field-label">Perfil<select className="field-input" defaultValue="staff" name="role"><option value="staff">Empleado</option><option value="admin">Administrador</option>{canAssignOwner ? <option value="owner">Administrador principal</option> : null}</select></label>
      <button className="button button-primary" disabled={pending} type="submit"><UserPlus size={17} /> {pending ? "Enviando..." : "Invitar"}</button>
      {(state.error || state.message) && <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>}
    </form>
  );
}
