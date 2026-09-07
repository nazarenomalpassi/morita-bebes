"use client";

import { Eye, EyeOff } from "lucide-react";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "morita-hide-sensitive-balances";
const CHANGE_EVENT = "morita-sensitive-balances-change";

type SensitiveBalancesContextValue = {
  hidden: boolean;
  toggle: () => void;
};

const SensitiveBalancesContext = createContext<SensitiveBalancesContextValue | null>(null);

export function SensitiveBalancesProvider({ children }: { children: React.ReactNode }) {
  const hidden = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("storage", onStoreChange);
      window.addEventListener(CHANGE_EVENT, onStoreChange);
      return () => {
        window.removeEventListener("storage", onStoreChange);
        window.removeEventListener(CHANGE_EVENT, onStoreChange);
      };
    },
    () => window.localStorage.getItem(STORAGE_KEY) === "true",
    () => false,
  );

  const value = useMemo(() => ({
    hidden,
    toggle: () => {
      const next = !hidden;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
  }), [hidden]);

  return (
    <SensitiveBalancesContext.Provider value={value}>
      {children}
    </SensitiveBalancesContext.Provider>
  );
}

export function useSensitiveBalances() {
  const context = useContext(SensitiveBalancesContext);
  if (!context) throw new Error("Sensitive balance controls require their provider.");
  return context;
}

export function SensitiveBalancesToggle({ compact = false }: { compact?: boolean }) {
  const { hidden, toggle } = useSensitiveBalances();
  const label = hidden ? "Mostrar saldos" : "Ocultar saldos";

  return (
    <button
      aria-label={label}
      aria-pressed={hidden}
      className={`button button-secondary sensitive-balances-toggle ${compact ? "is-compact" : ""}`}
      onClick={toggle}
      title={label}
      type="button"
    >
      {hidden ? <Eye aria-hidden="true" size={17} /> : <EyeOff aria-hidden="true" size={17} />}
      {!compact ? <span>{label}</span> : null}
    </button>
  );
}

export function SensitiveAmount({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { hidden } = useSensitiveBalances();
  return (
    <span
      aria-label={hidden ? "Importe oculto" : undefined}
      className={`sensitive-amount ${hidden ? "is-hidden" : ""} ${className ?? ""}`.trim()}
    >
      {hidden ? "••••••••" : children}
    </span>
  );
}
