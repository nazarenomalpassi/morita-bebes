import type { InventoryActionState } from "./action-state";

export function ActionFeedback({ state }: { state: InventoryActionState }) {
  if (state.status === "idle" || !state.message) return null;

  return (
    <div
      aria-live="polite"
      className={
        state.status === "error"
          ? "rounded-[6px] bg-[#f9e8e8] px-3 py-2 text-sm text-[var(--danger)]"
          : "rounded-[6px] bg-[#e6f2ed] px-3 py-2 text-sm text-[var(--success)]"
      }
      role="status"
    >
      {state.message}
    </div>
  );
}

export function FieldError({
  name,
  state,
}: {
  name: string;
  state: InventoryActionState;
}) {
  const error = state.fieldErrors?.[name];
  if (!error) return null;

  return <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>;
}
