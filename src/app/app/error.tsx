"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

export default function ManagementError({
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
    <div className="page-container permission-state">
      <TriangleAlert size={30} />
      <h1>No pudimos cargar esta sección</h1>
      <p>La operación no se completó. Tus datos guardados no fueron modificados.</p>
      <button className="button button-primary" onClick={reset} type="button"><RotateCcw size={17} /> Reintentar</button>
    </div>
  );
}

