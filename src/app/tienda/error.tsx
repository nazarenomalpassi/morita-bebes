"use client";

import { RefreshCw } from "lucide-react";

export default function StoreError({ reset }: { error: Error; reset: () => void }) {
  return <div className="store-page store-empty-state"><RefreshCw /><h1>No pudimos cargar la tienda</h1><p>Revisá tu conexión e intentá nuevamente.</p><button className="store-primary-button" onClick={reset} type="button">Volver a intentar</button></div>;
}
