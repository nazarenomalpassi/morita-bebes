"use client";

import { RotateCcw, Trash2 } from "lucide-react";

export function DraftNotice({ onRestore, onDiscard, unavailable }: { onRestore?: () => void; onDiscard?: () => void; unavailable?: boolean }) {
  if (unavailable) return <p className="form-error" role="status">El navegador no permite conservar el borrador. No cierres esta pestaña antes de guardar.</p>;
  if (!onRestore) return null;
  return <div className="management-draft-notice" role="status"><strong>Hay un borrador sin confirmar</strong><div><button className="button button-secondary" onClick={onRestore} type="button"><RotateCcw size={16} aria-hidden="true" /> Recuperar</button><button className="button button-ghost" onClick={onDiscard} type="button"><Trash2 size={16} aria-hidden="true" /> Descartar</button></div></div>;
}
