import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";

import { SensitiveAmount } from "@/components/finance/sensitive-balances";
import type { CashClosureHistory, CashClosureHistoryEntry } from "@/lib/cash/closures";
import { ars, dateTime, localDate } from "@/lib/format";

function closureAmounts(closure: CashClosureHistoryEntry) {
  const cash = closure.items.find((item) => item.name.toLocaleLowerCase("es").includes("efectivo"));
  const transfer = closure.items.find((item) => item.name.toLocaleLowerCase("es").includes("transfer"));
  return {
    cashIncome: cash?.income ?? 0,
    cashBalance: cash?.expected_balance ?? 0,
    transferIncome: transfer?.income ?? 0,
    transferBalance: transfer?.expected_balance ?? 0,
    totalIncome: closure.items.reduce((total, item) => total + item.income, 0),
  };
}

function ClosurePeriodSummary({ closure }: { closure: CashClosureHistoryEntry }) {
  const amounts = closureAmounts(closure);
  return <div className="cash-closure-period-summary">
    <article>
      <span className="eyebrow">Ingresos del día</span>
      <dl><div><dt>Efectivo</dt><dd><SensitiveAmount>{ars.format(amounts.cashIncome)}</SensitiveAmount></dd></div><div><dt>Transferencia</dt><dd><SensitiveAmount>{ars.format(amounts.transferIncome)}</SensitiveAmount></dd></div><div><dt>Total ingresado</dt><dd><SensitiveAmount>{ars.format(amounts.totalIncome)}</SensitiveAmount></dd></div></dl>
    </article>
    <article>
      <span className="eyebrow">Saldo al cierre</span>
      <dl><div><dt>Efectivo</dt><dd><SensitiveAmount>{ars.format(amounts.cashBalance)}</SensitiveAmount></dd></div><div><dt>Transferencia</dt><dd><SensitiveAmount>{ars.format(amounts.transferBalance)}</SensitiveAmount></dd></div><div><dt>Saldo total</dt><dd><SensitiveAmount>{ars.format(closure.expected_total)}</SensitiveAmount></dd></div></dl>
    </article>
  </div>;
}

export function CashClosureHistorySection({ history }: { history: CashClosureHistory }) {
  return <section className="cash-closure-history">
    <div className="section-heading-row"><div><span className="eyebrow">Control diario</span><h2>Historial de cierres</h2><p>Cada cierre conserva el saldo esperado, el conteo informado y su diferencia original.</p></div><small>{history.count} cierres registrados</small></div>
    <div className="cash-closure-history-list">
      {history.closures.map((closure) => {
        const amounts = closureAmounts(closure);
        return <details className={`cash-closure-history-row ${closure.status === "difference" ? "has-difference" : ""}`} key={closure.id}>
        <summary>
          <span className={`cash-closure-status-icon ${closure.status === "balanced" ? "is-balanced" : "has-difference"}`}>{closure.status === "balanced" ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}</span>
          <div><strong>{localDate(closure.business_date)}</strong><small>{closure.closure_type === "automatic" ? "Automático" : "Manual"} · {closure.closed_by_name} · {dateTime.format(new Date(closure.closed_at))}</small></div>
          <div><small>Ingresos del día</small><strong><SensitiveAmount>{ars.format(amounts.totalIncome)}</SensitiveAmount></strong></div>
          <div><small>Saldo al cierre</small><strong><SensitiveAmount>{ars.format(closure.expected_total)}</SensitiveAmount></strong></div>
          <ChevronDown size={18} />
        </summary>
        <div className="cash-closure-history-detail">
          <ClosurePeriodSummary closure={closure} />
          <div className="cash-closure-items-table">
            <div className="cash-closure-table-head"><span>Medio</span><span>Apertura</span><span>Ingresos</span><span>Egresos</span><span>Esperado</span><span>Contado</span><span>Diferencia</span></div>
            {closure.items.map((item) => <div className="cash-closure-table-row" key={item.payment_method_id}><strong>{item.name}</strong><span><SensitiveAmount>{ars.format(item.opening_balance)}</SensitiveAmount></span><span className="positive-value"><SensitiveAmount>+{ars.format(item.income)}</SensitiveAmount></span><span className="negative-value"><SensitiveAmount>−{ars.format(item.expense)}</SensitiveAmount></span><span><SensitiveAmount>{ars.format(item.expected_balance)}</SensitiveAmount></span><span><SensitiveAmount>{ars.format(item.counted_balance)}</SensitiveAmount></span><strong className={item.difference < 0 ? "negative-value" : item.difference > 0 ? "positive-value" : ""}><SensitiveAmount>{item.difference === 0 ? "$ 0" : `${item.difference > 0 ? "+" : ""}${ars.format(item.difference)}`}</SensitiveAmount></strong></div>)}
          </div>
          {closure.notes ? <p className="cash-closure-history-notes"><strong>Observación:</strong> {closure.notes}</p> : null}
        </div>
      </details>})}
      {history.closures.length === 0 ? <p className="inline-empty">Todavía no hay cierres diarios registrados.</p> : null}
    </div>
  </section>;
}
