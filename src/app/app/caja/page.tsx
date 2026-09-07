import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, CalendarDays, CircleAlert, Landmark, Search, WalletCards } from "lucide-react";

import { DailyCashClosureForm } from "@/app/app/caja/cash-closure";
import { CashClosureHistorySection } from "@/app/app/caja/cash-closure-history";
import { InitialBalanceForm, ManualMovementForm, ReconcileForm, TransferForm } from "@/app/app/caja/cash-forms";
import { SensitiveAmount, SensitiveBalancesToggle } from "@/components/finance/sensitive-balances";
import { normalizeCashClosureHistory, normalizeCashClosureWorkspace } from "@/lib/cash/closures";
import { cashMovementLabels, normalizeCashDashboard, type CashMovementType } from "@/lib/cash/dashboard";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { ars, dateTime } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = { desde?: string; hasta?: string; caja?: string; tipo?: string; direccion?: string; buscar?: string; pagina?: string };
const localDateTime = (value: string) => dateTime.format(new Date(value));
const uuid = (value?: string) => value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
const movementType = (value?: string) => value && value in cashMovementLabels ? value as CashMovementType : undefined;
const direction = (value?: string) => value === "credit" || value === "debit" ? value : undefined;
const dateStart = (value?: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00-03:00` : undefined;
const dateEnd = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const next = new Date(`${value}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T00:00:00-03:00`;
};

export default async function CashPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;

  const closureWorkspaceResult = await supabase.rpc("get_daily_cash_closure_workspace", {
    p_organization_id: organization.id,
  });
  if (closureWorkspaceResult.error) {
    console.error("No se pudo cargar el cierre diario", closureWorkspaceResult.error);
    return <div className="page-container permission-state"><CircleAlert size={30} /><h1>No pudimos cargar el cierre</h1><p>Reintentá en unos minutos. Ningún movimiento fue modificado.</p></div>;
  }
  const closureWorkspace = normalizeCashClosureWorkspace(closureWorkspaceResult.data);

  if (organization.role === "staff") return <div className="page-container cash-page cash-closure-staff-page">
    <header className="page-header"><div><span className="eyebrow">Control de jornada</span><h1 className="page-title mt-2">Cierre diario de caja</h1><p className="page-lead">El sistema registra el cierre automáticamente y protege su contenido.</p></div></header>
    <DailyCashClosureForm workspace={closureWorkspace} />
    {closureWorkspace.recent_closures.length > 0 ? <section className="cash-closure-staff-recent"><div className="section-heading-row"><div><span className="eyebrow">Tus últimos registros</span><h2>Cierres realizados</h2></div></div><div>{closureWorkspace.recent_closures.map((closure) => <article key={`${closure.business_date}-${closure.closed_at}`}><strong>{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${closure.business_date}T12:00:00Z`))}</strong><span className={closure.status === "balanced" ? "positive-value" : "negative-value"}>{closure.status === "balanced" ? "Sin diferencias" : `Diferencia ${ars.format(closure.absolute_difference_total)}`}</span></article>)}</div></section> : null}
  </div>;

  const page = Math.max(Number.parseInt(params.pagina ?? "1", 10) || 1, 1);
  const selectedMethod = uuid(params.caja);
  const [dashboardResult, methodsResult, historyResult] = await Promise.all([
    supabase.rpc("get_cash_dashboard", {
      p_organization_id: organization.id, p_date_from: dateStart(params.desde), p_date_to: dateEnd(params.hasta),
      p_payment_method_id: selectedMethod, p_type: movementType(params.tipo), p_direction: direction(params.direccion),
      p_search: params.buscar?.trim() || undefined, p_limit: 50, p_offset: (page - 1) * 50,
    }),
    supabase.from("payment_methods").select("id, name").eq("organization_id", organization.id).eq("is_active", true).order("sort_order").order("name"),
    supabase.rpc("list_daily_cash_closures", { p_organization_id: organization.id, p_limit: 90, p_offset: 0 }),
  ]);
  if (dashboardResult.error || methodsResult.error || historyResult.error) {
    console.error("No se pudo cargar Caja y cierres", dashboardResult.error ?? methodsResult.error ?? historyResult.error);
    return <div className="page-container permission-state"><CircleAlert size={30} /><h1>No pudimos cargar la caja</h1><p>Reintentá en unos minutos. Ningún movimiento fue modificado.</p></div>;
  }
  const dashboard = normalizeCashDashboard(dashboardResult.data);
  const methods = methodsResult.data ?? [];
  const closureHistory = normalizeCashClosureHistory(historyResult.data);

  if (!dashboard.configured) return <div className="page-container cash-page">
    <header className="page-header"><div><span className="eyebrow">Administración financiera</span><h1 className="page-title mt-2">Caja y saldos</h1><p className="page-lead">Configurá el punto de partida para seguir el dinero disponible desde hoy.</p></div></header>
    <section className="cash-setup-band"><div className="cash-setup-copy"><span className="cash-setup-icon"><Landmark size={24} /></span><div><h2>Configurar saldos iniciales</h2><p>Cargá el dinero real disponible en cada medio de pago. Las ventas, gastos y pagos anteriores a la fecha de corte no se volverán a sumar.</p></div></div><InitialBalanceForm methods={methods} /></section>
  </div>;

  const activeAccounts = dashboard.accounts.filter((account) => account.is_active);
  const options = activeAccounts.map((account) => ({ payment_method_id: account.payment_method_id, name: account.name, balance: account.balance }));
  const selected = selectedMethod ? activeAccounts.find((account) => account.payment_method_id === selectedMethod) : undefined;
  const maxFlow = Math.max(...dashboard.daily_flow.flatMap((entry) => [entry.income, entry.expense]), 1);
  const queryFor = (targetPage: number) => { const query = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value && key !== "pagina") query.set(key, value); }); query.set("pagina", String(targetPage)); return query.toString(); };

  return <div className="page-container page-container-wide cash-page">
    <header className="page-header cash-page-header"><div><span className="eyebrow">Dinero disponible</span><h1 className="page-title mt-2">Caja y saldos</h1><p className="page-lead">Dos cuentas financieras: Efectivo y Transferencia. Débito y crédito se consolidan en Transferencia.</p></div><div className="cash-header-actions">
      <SensitiveBalancesToggle />
      <details className="header-details"><summary className="button button-primary"><ArrowRightLeft size={17} /> Transferir</summary><div className="details-panel"><h2>Transferir dinero</h2><TransferForm accounts={options} /></div></details>
      <details className="header-details"><summary className="button button-secondary"><WalletCards size={17} /> Registrar</summary><div className="details-panel"><h2>Movimiento extraordinario</h2><ManualMovementForm accounts={options} /></div></details>
      <details className="header-details"><summary className="button button-secondary"><Landmark size={17} /> Controlar</summary><div className="details-panel"><h2>Conciliar una caja</h2><ReconcileForm accounts={options} /></div></details>
    </div></header>

    <DailyCashClosureForm workspace={closureWorkspace} />

    <section className="cash-summary-grid" aria-label="Saldos actuales">
      <article className="cash-balance-card cash-total-card"><span>Total disponible</span><strong><SensitiveAmount>{ars.format(dashboard.total_balance)}</SensitiveAmount></strong><small>Consolidado sin duplicar medios de tarjeta</small></article>
      {activeAccounts.map((account) => <a className={`cash-balance-card ${account.balance < 0 ? "cash-balance-negative" : ""} ${selectedMethod === account.payment_method_id ? "cash-balance-selected" : ""}`} href={`/app/caja?caja=${account.payment_method_id}`} key={account.id}><span>{account.name}</span><strong><SensitiveAmount>{ars.format(account.balance)}</SensitiveAmount></strong><div><small><ArrowUpRight size={13} /> <SensitiveAmount>{ars.format(account.month_income)}</SensitiveAmount></small><small><ArrowDownLeft size={13} /> <SensitiveAmount>{ars.format(account.month_expense)}</SensitiveAmount></small></div>{account.balance < 0 ? <em><CircleAlert size={13} /> Saldo negativo</em> : null}</a>)}
    </section>

    {selected ? <section className="cash-account-band"><div><span className="eyebrow">Detalle de caja</span><h2>{selected.name}</h2></div><div><small>Saldo actual</small><strong className={selected.balance < 0 ? "negative-value" : ""}><SensitiveAmount>{ars.format(selected.balance)}</SensitiveAmount></strong></div><div><small>Ingresos del mes</small><strong><SensitiveAmount>{ars.format(selected.month_income)}</SensitiveAmount></strong></div><div><small>Egresos del mes</small><strong><SensitiveAmount>{ars.format(selected.month_expense)}</SensitiveAmount></strong></div><div><small>Movimientos del mes</small><strong>{selected.movement_count}</strong></div><a className="button button-secondary" href="/app/caja">Ver todas</a></section> : null}

    <section className="cash-flow-section"><div className="section-heading-row"><div><span className="eyebrow">Últimos 14 días</span><h2>Ingresos y egresos</h2></div><div className="cash-chart-legend"><span><i className="cash-legend-income" /> Entradas</span><span><i className="cash-legend-expense" /> Salidas</span></div></div><div className="cash-mini-chart" aria-label="Flujo diario">
      {dashboard.daily_flow.map((flow) => <div className="cash-chart-day" key={flow.date}><div className="cash-chart-bars"><i className="cash-bar-income" style={{ height: `${Math.max(flow.income / maxFlow * 100, flow.income ? 4 : 0)}%` }} title={`Ingresos ${ars.format(flow.income)}`} /><i className="cash-bar-expense" style={{ height: `${Math.max(flow.expense / maxFlow * 100, flow.expense ? 4 : 0)}%` }} title={`Egresos ${ars.format(flow.expense)}`} /></div><small>{new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${flow.date}T12:00:00Z`))}</small></div>)}
      {dashboard.daily_flow.length === 0 ? <p className="inline-empty">Todavía no hay flujo posterior al saldo inicial.</p> : null}
    </div></section>

    <CashClosureHistorySection history={closureHistory} />

    <section className="cash-movements-section"><div className="section-heading-row"><div><span className="eyebrow">Libro inmutable</span><h2>Movimientos</h2></div><small>{dashboard.movement_count} resultados</small></div>
      <form className="cash-filters" method="get"><label className="field-label">Desde<input className="field-input" defaultValue={params.desde} name="desde" type="date" /></label><label className="field-label">Hasta<input className="field-input" defaultValue={params.hasta} name="hasta" type="date" /></label><label className="field-label">Caja<select className="field-input" defaultValue={params.caja ?? ""} name="caja"><option value="">Todas</option>{activeAccounts.map((account) => <option key={account.id} value={account.payment_method_id}>{account.name}</option>)}</select></label><label className="field-label">Tipo<select className="field-input" defaultValue={params.tipo ?? ""} name="tipo"><option value="">Todos</option>{Object.entries(cashMovementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field-label">Flujo<select className="field-input" defaultValue={params.direccion ?? ""} name="direccion"><option value="">Entradas y salidas</option><option value="credit">Entradas</option><option value="debit">Salidas</option></select></label><label className="field-label cash-search-field">Buscar<span className="input-shell input-shell-start"><Search aria-hidden="true" size={16} /><input className="field-input" defaultValue={params.buscar} name="buscar" placeholder="Concepto o referencia" /></span></label><button className="button button-secondary" type="submit">Filtrar</button><a className="button button-ghost" href="/app/caja">Limpiar</a></form>
      <div className="cash-movement-list">{dashboard.movements.map((movement) => <article className="cash-movement-row" key={movement.id}><span className={`cash-movement-icon ${movement.direction === "credit" ? "cash-credit" : "cash-debit"}`}>{movement.direction === "credit" ? <ArrowUpRight size={17} /> : <ArrowDownLeft size={17} />}</span><div className="cash-movement-main"><strong>{movement.description}</strong><small>{cashMovementLabels[movement.type]} · {movement.account_name}{movement.reference_id ? ` · ${movement.reference_type ?? "Referencia"} ${movement.reference_id.slice(0, 8).toUpperCase()}` : ""}</small></div><div className="cash-movement-date"><CalendarDays size={14} /><span>{localDateTime(movement.occurred_at)}</span><small>{movement.actor_name}</small></div><strong className={movement.direction === "credit" ? "positive-value" : "negative-value"}><SensitiveAmount>{movement.direction === "credit" ? "+" : "−"}{ars.format(movement.amount)}</SensitiveAmount></strong><div className="cash-result-balance"><small>Saldo técnico</small><strong><SensitiveAmount>{ars.format(movement.balance_after)}</SensitiveAmount></strong></div></article>)}{dashboard.movements.length === 0 ? <p className="inline-empty">No hay movimientos que coincidan con estos filtros.</p> : null}</div>
      {dashboard.movement_count > 50 ? <nav className="cash-pagination" aria-label="Páginas de movimientos">{page > 1 ? <a className="button button-secondary" href={`/app/caja?${queryFor(page - 1)}`}>Anterior</a> : <span />}{page * 50 < dashboard.movement_count ? <a className="button button-secondary" href={`/app/caja?${queryFor(page + 1)}`}>Siguiente</a> : null}</nav> : null}
    </section>
  </div>;
}
