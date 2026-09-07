"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";

import { requestPasswordResetAction, type FormState } from "@/app/auth/actions";

export function PasswordResetForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestPasswordResetAction, {});
  return (
    <form action={action} className="space-y-5">
      <label className="field-label">Correo<input autoComplete="email" className="field-input" name="email" required type="email" /></label>
      {(state.error || state.message) && <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>}
      <button className="button button-primary w-full" disabled={pending} type="submit"><Send size={17} /> {pending ? "Enviando..." : "Enviar enlace"}</button>
    </form>
  );
}

