"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  createOrganizationAction,
  type FormState,
} from "@/app/auth/actions";

const initialState: FormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button button-primary" disabled={pending} type="submit">
      {pending ? "Creando..." : "Crear espacio"}
    </button>
  );
}

export function OnboardingForm() {
  const [state, formAction] = useActionState(
    createOrganizationAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 max-w-lg space-y-5">
      <div className="space-y-2">
        <label className="field-label" htmlFor="organization-name">
          Nombre del comercio
        </label>
        <input
          autoFocus
          className="field-input"
          defaultValue="Morita Bebes"
          id="organization-name"
          maxLength={80}
          minLength={2}
          name="name"
          required
        />
      </div>

      {state.error && (
        <p aria-live="polite" className="form-error">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
