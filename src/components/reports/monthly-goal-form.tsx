"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import { saveMonthlyGoalAction } from "@/app/app/reportes/actions";
import type { ActionState } from "@/lib/actions/form-state";

export function MonthlyGoalForm({ month, target }: { month: string; target: number | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveMonthlyGoalAction, {});
  return (
    <form action={action} className="goal-form">
      <label className="field-label">
        Mes
        <input className="field-input" defaultValue={month} name="goal_month" required type="month" />
      </label>
      <label className="field-label">
        Meta de facturación
        <input className="field-input" defaultValue={target ?? ""} inputMode="decimal" min="0.01" name="sales_target" placeholder="$ 0" required step="0.01" type="number" />
      </label>
      <button className="button button-primary" disabled={pending} type="submit">
        <Save size={16} /> {pending ? "Guardando..." : "Guardar meta"}
      </button>
      {(state.error || state.message) && <p className={state.error ? "form-error goal-form-feedback" : "form-success goal-form-feedback"}>{state.error ?? state.message}</p>}
    </form>
  );
}
