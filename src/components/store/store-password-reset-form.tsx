"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";

import { storePasswordResetAction, type StoreActionState } from "@/app/tienda/actions";

export function StorePasswordResetForm() {
  const [state, action, pending] = useActionState<StoreActionState, FormData>(storePasswordResetAction, {});
  return (
    <form action={action} className="store-auth-form">
      <label>Correo electrónico<input autoComplete="email" name="email" placeholder="tu@email.com" required type="email" /></label>
      {state.error ? <p className="store-form-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="store-form-success" role="status">{state.message}</p> : null}
      <button className="store-primary-button" disabled={pending} type="submit"><Send aria-hidden="true" />{pending ? "Enviando..." : "Enviar enlace"}</button>
    </form>
  );
}
