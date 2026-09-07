"use client";

import { CheckCircle2, Clock3, LockKeyhole, WalletCards } from "lucide-react";

import type { CashClosureWorkspace } from "@/lib/cash/closures";
import { dateTime, localDate } from "@/lib/format";

export function DailyCashClosureForm({ workspace }: { workspace: CashClosureWorkspace }) {
  if (!workspace.configured) return (
    <section className="cash-closure-panel cash-closure-unavailable">
      <WalletCards size={26} />
      <div>
        <h2>Cierre automático pendiente de configuración</h2>
        <p>Un dueño o administrador debe configurar primero los saldos iniciales de caja.</p>
      </div>
    </section>
  );

  return (
    <section className={`cash-closure-panel cash-closure-automatic ${workspace.today_closed ? "cash-closure-complete" : ""}`}>
      <span className="cash-closure-icon">
        {workspace.today_closed ? <CheckCircle2 size={24} /> : <Clock3 size={24} />}
      </span>
      <div className="cash-closure-automatic-copy">
        <span className="eyebrow">Cierre protegido</span>
        <h2>{workspace.today_closed ? "La caja de hoy ya está cerrada" : "Cierre automático diario a las 22:00"}</h2>
        <p>
          {workspace.today_closed
            ? `${localDate(workspace.business_date ?? "")} · El registro es inmutable.`
            : workspace.next_close_at
              ? `Próxima ejecución: ${dateTime.format(new Date(workspace.next_close_at))}.`
              : "La ejecución se realiza desde la base de datos, aunque el sistema esté cerrado."}
        </p>
      </div>
      <span className="cash-blind-badge"><LockKeyhole size={14} /> No editable</span>
    </section>
  );
}
