"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import { updatePasswordAction, type FormState } from "@/app/auth/actions";
import { PasswordInput } from "@/components/forms/password-input";

export function UpdatePasswordForm({ next = "/app" }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePasswordAction, {});
  return (
    <form action={action} className="space-y-5">
      <input name="next" type="hidden" value={next} />
      <label className="field-label">Contraseña nueva<PasswordInput autoComplete="new-password" minLength={8} name="password" required /></label>
      <label className="field-label">Repetir contraseña<PasswordInput autoComplete="new-password" minLength={8} name="password_confirmation" required /></label>
      {state.error && <p className="form-error">{state.error}</p>}
      <button className="button button-primary w-full" disabled={pending} type="submit"><Save size={17} /> {pending ? "Guardando..." : "Guardar contraseña"}</button>
    </form>
  );
}
