"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { authenticateAction, type FormState } from "@/app/auth/actions";
import { PasswordInput } from "@/components/forms/password-input";

function SubmitButtons() {
  const { pending } = useFormStatus();

  return (
    <div>
      <button
        className="button button-primary"
        disabled={pending}
        name="intent"
        type="submit"
        value="signin"
      >
        {pending ? "Procesando..." : "Ingresar"}
      </button>
    </div>
  );
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    authenticateAction,
    initialError ? { error: initialError } : {},
  );

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <label className="field-label" htmlFor="email">
          Correo
        </label>
        <input
          autoComplete="email"
          className="field-input"
          id="email"
          name="email"
          placeholder="nombre@correo.com"
          required
          type="email"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="field-label" htmlFor="password">Contraseña</label>
          <Link className="text-link" href="/recuperar">Olvidé mi contraseña</Link>
        </div>
        <PasswordInput
          autoComplete="current-password"
          id="password"
          minLength={8}
          name="password"
          required
        />
      </div>

      {(state.error || state.message) && (
        <p
          aria-live="polite"
          className={state.error ? "form-error" : "form-success"}
        >
          {state.error ?? state.message}
        </p>
      )}

      <SubmitButtons />
    </form>
  );
}
