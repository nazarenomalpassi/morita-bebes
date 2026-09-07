"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

export function InventoryPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page-container">
      <section className="empty-state">
        <span className="empty-state-icon bg-[#f9e8e8] text-[var(--danger)]">
          <AlertTriangle size={27} />
        </span>
        <h2>No pudimos cargar esta sección</h2>
        <p>Revisá tu conexión e intentá nuevamente. Los datos guardados no se modificaron.</p>
        <button className="button button-secondary mt-4 gap-2" onClick={reset} type="button">
          <RotateCcw size={17} /> Reintentar
        </button>
      </section>
    </div>
  );
}
