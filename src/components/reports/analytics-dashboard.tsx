"use client";

import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Boxes,
  CalendarRange,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Filter,
  Gauge,
  PackageSearch,
  ReceiptText,
  ShoppingBag,
  Target,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AnalyticsReport, ReportSearchParams, ResolvedReportPeriod } from "@/lib/reports/analytics";
import { percentageChange } from "@/lib/reports/analytics";

import { MonthlyGoalForm } from "./monthly-goal-form";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", notation: "compact", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const palette = ["#5d506d", "#8f82c9", "#e88f82", "#3f9483", "#d99a3c", "#857b73", "#ba6e8d", "#6a8ca6"];

type Tab = "summary" | "sales" | "products" | "profitability";

function formatDate(value: string) {
  return shortDate.format(new Date(`${value}T00:00:00Z`));
}

function comparisonLabel(period: ResolvedReportPeriod) {
  return `${formatDate(period.compareFrom)} al ${formatDate(period.compareTo)}`;
}

function Delta({ current, previous, compare }: { current: number | null; previous: number | null; compare: boolean }) {
  if (!compare) return <span className="metric-context">Comparación desactivada</span>;
  const change = percentageChange(current, previous);
  if (change === null) return <span className="metric-context">Sin período comparable</span>;
  const UpIcon = change >= 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={change >= 0 ? "metric-delta metric-delta-up" : "metric-delta metric-delta-down"}><UpIcon size={14} /> {percent.format(Math.abs(change))}% vs. anterior</span>;
}

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  current,
  previous,
  compare,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Banknote;
  current: number | null;
  previous: number | null;
  compare: boolean;
  href?: string;
}) {
  const content = <>
    <span className="analytics-kpi-icon"><Icon size={19} /></span>
    <div className="analytics-kpi-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small><Delta compare={compare} current={current} previous={previous} /></div>
    {href ? <ChevronRight className="analytics-kpi-link" size={18} /> : null}
  </>;
  return href ? <Link className="analytics-kpi" href={href}>{content}</Link> : <article className="analytics-kpi">{content}</article>;
}

function ChartEmpty({ children = "No hay datos para este período." }: { children?: string }) {
  return <div className="chart-empty"><BarChart3 size={24} /><p>{children}</p></div>;
}

function ChartPanel({ eyebrow, title, icon: Icon, actions, children, className = "" }: {
  eyebrow: string;
  title: string;
  icon: typeof Banknote;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`analytics-panel ${className}`}>
    <header className="analytics-panel-header">
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
      <div className="analytics-panel-actions">{actions}<Icon size={20} /></div>
    </header>
    {children}
  </section>;
}

function ReportFilters({ report, period, search }: { report: AnalyticsReport; period: ResolvedReportPeriod; search: ReportSearchParams }) {
  return <form className="analytics-filters" method="get">
    <div className="analytics-primary-filters">
      <label className="field-label">Período<select className="field-input" defaultValue={period.preset} name="periodo">
        <option value="today">Hoy</option><option value="yesterday">Ayer</option><option value="last7">Últimos 7 días</option><option value="last30">Últimos 30 días</option><option value="thisMonth">Este mes</option><option value="previousMonth">Mes anterior</option><option value="thisYear">Este año</option><option value="custom">Personalizado</option>
      </select></label>
      <label className="field-label">Desde<input className="field-input" defaultValue={period.from} name="desde" type="date" /></label>
      <label className="field-label">Hasta<input className="field-input" defaultValue={period.to} name="hasta" type="date" /></label>
      <input name="comparar" type="hidden" value="0" />
      <label className="analytics-compare-toggle"><input defaultChecked={period.compare} name="comparar" type="checkbox" value="1" /><span>Comparar con período anterior</span></label>
      <button className="button button-primary" type="submit"><CalendarRange size={17} /> Aplicar</button>
    </div>
    <details className="analytics-more-filters" open={Boolean(search.categoria || search.producto || search.empleado || search.pago)}>
      <summary><Filter size={16} /> Filtros avanzados</summary>
      <div className="analytics-advanced-grid">
        <label className="field-label">Categoría<select className="field-input" defaultValue={search.categoria ?? ""} name="categoria"><option value="">Todas</option>{report.filters.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-label">Producto<select className="field-input" defaultValue={search.producto ?? ""} name="producto"><option value="">Todos</option>{report.filters.products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
        <label className="field-label">Empleado<select className="field-input" defaultValue={search.empleado ?? ""} name="empleado"><option value="">Todos</option><option value="unassigned">Histórico / sin identificar</option>{report.filters.employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-label">Medio de pago<select className="field-input" defaultValue={search.pago ?? ""} name="pago"><option value="">Todos</option>{report.filters.paymentMethods.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
        <button className="button button-secondary" type="submit">Aplicar filtros</button>
        <Link className="button button-ghost" href="/app/reportes">Limpiar</Link>
      </div>
    </details>
  </form>;
}

function SalesTimeline({ report, compare }: { report: AnalyticsReport; compare: boolean }) {
  const data = report.timeline.map((point) => ({ ...point, label: formatDate(point.currentLabel), previous: formatDate(point.previousLabel) }));
  if (!data.some((point) => point.currentRevenue > 0 || point.previousRevenue > 0)) return <ChartEmpty />;
  return <div className="chart-frame chart-frame-large">
    <ResponsiveContainer height="100%" width="100%">
      <AreaChart data={data} margin={{ top: 12, right: 10, left: 2, bottom: 0 }}>
        <defs><linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5d506d" stopOpacity={0.26} /><stop offset="100%" stopColor="#5d506d" stopOpacity={0.02} /></linearGradient></defs>
        <CartesianGrid stroke="#e7e2eb" strokeDasharray="3 4" vertical={false} />
        <XAxis axisLine={false} dataKey="label" fontSize={11} tickLine={false} />
        <YAxis axisLine={false} fontSize={11} tickFormatter={(value: number) => compactMoney.format(value)} tickLine={false} width={72} />
        <Tooltip formatter={(value) => money.format(Number(value))} labelFormatter={(_, payload) => payload?.[0]?.payload ? `${payload[0].payload.label}${compare ? ` / ${payload[0].payload.previous}` : ""}` : ""} />
        <Area dataKey="currentRevenue" fill="url(#salesFill)" name="Período actual" stroke="#5d506d" strokeWidth={3} type="monotone" />
        {compare ? <Line dataKey="previousRevenue" dot={false} name="Período anterior" stroke="#e88f82" strokeDasharray="6 5" strokeWidth={2} type="monotone" /> : null}
        {compare ? <Legend iconType="line" /> : null}
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

function GoalPanel({ report, period }: { report: AnalyticsReport; period: ResolvedReportPeriod }) {
  const goal = report.goal;
  const month = period.goalMonth.slice(0, 7);
  const label = monthName.format(new Date(`${period.goalMonth}T00:00:00Z`));
  const progress = Math.min(goal?.progressPct ?? 0, 100);
  return <ChartPanel className="goal-panel" eyebrow="Objetivo comercial" icon={Target} title={`Meta de ${label}`}>
    {goal ? <>
      <div className="goal-headline"><div><span>Facturado</span><strong>{money.format(goal.revenue)}</strong></div><div><span>Meta</span><strong>{money.format(goal.target)}</strong></div></div>
      <div className="goal-progress" role="progressbar" aria-label="Avance de meta mensual" aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
      <strong className="goal-percentage">{percent.format(goal.progressPct)}%</strong>
      <dl className="goal-details">
        <div><dt>Restante</dt><dd>{money.format(goal.remaining)}</dd></div>
        <div><dt>Días restantes</dt><dd>{goal.daysRemaining}</dd></div>
        <div><dt>Promedio diario necesario</dt><dd>{goal.requiredDaily === null ? "No aplica" : money.format(goal.requiredDaily)}</dd></div>
        <div><dt>Proyección de cierre</dt><dd>{money.format(goal.projectedRevenue)}</dd></div>
      </dl>
      <p className="goal-projection">A este ritmo cerrarías en {percent.format(goal.target > 0 ? goal.projectedRevenue * 100 / goal.target : 0)}% de la meta.</p>
    </> : <div className="goal-empty"><Target size={26} /><div><strong>Sin meta definida</strong><p>La facturación del mes es {money.format(report.goalMonthRevenue)}.</p></div></div>}
    <details className="goal-editor"><summary>{goal ? "Editar meta" : "Definir meta"}</summary><MonthlyGoalForm month={month} target={goal?.target ?? null} /></details>
  </ChartPanel>;
}

function InsightList({ report, compare }: { report: AnalyticsReport; compare: boolean }) {
  const insights: string[] = [];
  const revenueDelta = percentageChange(report.summary.current.revenue, report.summary.previous.revenue);
  const ticketDelta = percentageChange(report.summary.current.averageTicket, report.summary.previous.averageTicket);
  if (compare && revenueDelta !== null) insights.push(`La facturación ${revenueDelta >= 0 ? "aumentó" : "bajó"} ${percent.format(Math.abs(revenueDelta))}% frente al período anterior.`);
  if (report.topProducts[0]) insights.push(`${report.topProducts[0].name} lideró las ventas registradas con ${number.format(report.topProducts[0].units)} unidades.`);
  const bestDay = [...report.weekdays].sort((a, b) => b.averageRevenue - a.averageRevenue)[0];
  if (bestDay?.revenue > 0) insights.push(`${bestDay.name} fue el día con mayor promedio de facturación.`);
  if (compare && ticketDelta !== null) insights.push(`El ticket promedio ${ticketDelta >= 0 ? "subió" : "bajó"} ${percent.format(Math.abs(ticketDelta))}%.`);
  if (report.goal) insights.push(`Se alcanzó ${percent.format(report.goal.progressPct)}% de la meta mensual.`);
  return <div className="insight-list">{insights.length ? insights.map((item, index) => <div className="insight-row" key={item}><span>{index + 1}</span><p>{item}</p></div>) : <p className="inline-empty">Todavía no hay señales suficientes para este período.</p>}</div>;
}

function TopProducts({ report }: { report: AnalyticsReport }) {
  const [metric, setMetric] = useState<"units" | "revenue">("units");
  const [limit, setLimit] = useState<5 | 10>(5);
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedCategory = searchParams.get("categoria") ?? "";
  const data = [...report.topProducts].sort((a, b) => b[metric] - a[metric]).slice(0, limit).reverse();
  const changeCategory = (categoryId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (categoryId) params.set("categoria", categoryId);
    else params.delete("categoria");
    params.delete("producto");
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };
  const actions = <div className="compact-controls compact-controls-ranking"><select aria-label="Categoría del ranking" disabled={isPending} value={selectedCategory} onChange={(event) => changeCategory(event.target.value)}><option value="">Todas las categorías</option>{report.filters.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select aria-label="Métrica del ranking" value={metric} onChange={(event) => setMetric(event.target.value as "units" | "revenue")}><option value="units">Unidades</option><option value="revenue">Facturación</option></select><select aria-label="Cantidad de productos" value={limit} onChange={(event) => setLimit(Number(event.target.value) as 5 | 10)}><option value={5}>Top 5</option><option value={10}>Top 10</option></select></div>;
  return <ChartPanel actions={actions} eyebrow="Mix de productos" icon={PackageSearch} title="Productos más vendidos">
    {data.length ? <div className="chart-frame chart-frame-ranking"><ResponsiveContainer height="100%" width="100%"><BarChart data={data} layout="vertical" margin={{ top: 5, right: 24, left: 8, bottom: 0 }}><CartesianGrid horizontal={false} stroke="#e7e2eb" strokeDasharray="3 4" /><XAxis axisLine={false} fontSize={11} tickFormatter={(value: number) => metric === "revenue" ? compactMoney.format(value) : number.format(value)} tickLine={false} type="number" /><YAxis axisLine={false} dataKey="name" fontSize={11} tickLine={false} type="category" width={132} tickFormatter={(value: string) => value.length > 21 ? `${value.slice(0, 20)}…` : value} /><Tooltip formatter={(value) => metric === "revenue" ? money.format(Number(value)) : `${number.format(Number(value))} unidades`} /><Bar dataKey={metric} fill="#5d506d" maxBarSize={28} name={metric === "revenue" ? "Facturación" : "Unidades"} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <ChartEmpty>{selectedCategory ? "No hay ventas de productos de esta categoría para el período seleccionado." : "No hay detalle de productos en este período."}</ChartEmpty>}
  </ChartPanel>;
}

function CategoryChart({ report }: { report: AnalyticsReport }) {
  const total = report.categories.reduce((sum, item) => sum + item.revenue, 0);
  return <ChartPanel eyebrow="Participación" icon={Boxes} title="Ventas por categoría">
    {report.categories.length ? <><div className="chart-frame"><ResponsiveContainer height="100%" width="100%"><BarChart data={report.categories.slice(0, 10)} margin={{ top: 12, right: 10, left: 0, bottom: 8 }}><CartesianGrid stroke="#e7e2eb" strokeDasharray="3 4" vertical={false} /><XAxis axisLine={false} dataKey="name" fontSize={10} interval={0} tickLine={false} /><YAxis axisLine={false} fontSize={11} tickFormatter={(value: number) => compactMoney.format(value)} tickLine={false} width={68} /><Tooltip formatter={(value) => money.format(Number(value))} /><Bar dataKey="revenue" fill="#8f82c9" maxBarSize={42} name="Facturación" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div><div className="category-summary">{report.categories.slice(0, 5).map((item) => <div key={item.name}><strong>{item.name}</strong><span>{total ? percent.format(item.revenue * 100 / total) : 0}%</span><small>{number.format(item.units)} unidades</small></div>)}</div></> : <ChartEmpty>No hay categorías vinculadas a ventas del período.</ChartEmpty>}
  </ChartPanel>;
}

function PaymentChart({ report }: { report: AnalyticsReport }) {
  const total = report.payments.reduce((sum, item) => sum + item.amount, 0);
  return <ChartPanel eyebrow="Cobros" icon={CreditCard} title="Medios de pago">
    {report.payments.length ? <div className="donut-layout"><div className="chart-frame chart-frame-donut"><ResponsiveContainer height="100%" width="100%"><PieChart><Pie cx="50%" cy="50%" data={report.payments} dataKey="amount" innerRadius={64} nameKey="name" outerRadius={96} paddingAngle={2}>{report.payments.map((item, index) => <Cell fill={palette[index % palette.length]} key={item.key} />)}</Pie><Tooltip formatter={(value) => money.format(Number(value))} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{report.payments.length}</strong><span>medios</span></div></div><div className="legend-list">{report.payments.map((item, index) => <div key={item.key}><span className="legend-swatch" style={{ backgroundColor: palette[index % palette.length] }} /><div><strong>{item.name}</strong><small>{money.format(item.amount)} · {item.operations} operaciones</small></div><span>{total ? percent.format(item.amount * 100 / total) : 0}%</span></div>)}</div></div> : <ChartEmpty />}
  </ChartPanel>;
}

function WeekdayChart({ report }: { report: AnalyticsReport }) {
  return <ChartPanel eyebrow="Patrón semanal" icon={CalendarRange} title="Promedio por día de la semana">
    <div className="chart-frame"><ResponsiveContainer height="100%" width="100%"><BarChart data={report.weekdays} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}><CartesianGrid stroke="#e7e2eb" strokeDasharray="3 4" vertical={false} /><XAxis axisLine={false} dataKey="name" fontSize={10} tickFormatter={(value: string) => value.slice(0, 3)} tickLine={false} /><YAxis axisLine={false} fontSize={11} tickFormatter={(value: number) => compactMoney.format(value)} tickLine={false} width={68} /><Tooltip formatter={(value) => money.format(Number(value))} /><Bar dataKey="averageRevenue" fill="#3f9483" maxBarSize={38} name="Promedio diario" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
  </ChartPanel>;
}

function HourChart({ report }: { report: AnalyticsReport }) {
  const known = report.timeCoverage.operationsWithKnownTime;
  const total = report.timeCoverage.totalOperations;
  return <ChartPanel eyebrow="Demanda" icon={Clock3} title="Ventas por franja horaria" actions={<span className="coverage-label">{known}/{total} con hora confiable</span>}>
    {report.hours.length ? <div className="chart-frame"><ResponsiveContainer height="100%" width="100%"><AreaChart data={report.hours} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}><CartesianGrid stroke="#e7e2eb" strokeDasharray="3 4" vertical={false} /><XAxis axisLine={false} dataKey="band" fontSize={10} tickLine={false} /><YAxis axisLine={false} fontSize={11} tickFormatter={(value: number) => compactMoney.format(value)} tickLine={false} width={68} /><Tooltip formatter={(value) => money.format(Number(value))} /><Area dataKey="revenue" fill="#f4d8d3" name="Facturación" stroke="#e88f82" strokeWidth={2} type="monotone" /></AreaChart></ResponsiveContainer></div> : <ChartEmpty>No hay horarios confiables para analizar.</ChartEmpty>}
  </ChartPanel>;
}

function TicketTimeline({ report, compare }: { report: AnalyticsReport; compare: boolean }) {
  const data = report.timeline.map((point) => ({
    label: formatDate(point.currentLabel),
    previousLabel: formatDate(point.previousLabel),
    current: point.currentSales ? point.currentRevenue / point.currentSales : 0,
    previous: point.previousSales ? point.previousRevenue / point.previousSales : 0,
  }));
  return <ChartPanel eyebrow="Valor por operación" icon={CreditCard} title="Evolución del ticket promedio">
    {data.some((item) => item.current > 0 || item.previous > 0) ? <div className="chart-frame"><ResponsiveContainer height="100%" width="100%"><AreaChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}><CartesianGrid stroke="#e7e2eb" strokeDasharray="3 4" vertical={false} /><XAxis axisLine={false} dataKey="label" fontSize={10} tickLine={false} /><YAxis axisLine={false} fontSize={11} tickFormatter={(value: number) => compactMoney.format(value)} tickLine={false} width={68} /><Tooltip formatter={(value) => money.format(Number(value))} /><Area dataKey="current" fill="#d9eee8" name="Período actual" stroke="#3f9483" strokeWidth={2} type="monotone" />{compare ? <Line dataKey="previous" dot={false} name="Período anterior" stroke="#e88f82" strokeDasharray="5 4" strokeWidth={2} type="monotone" /> : null}{compare ? <Legend /> : null}</AreaChart></ResponsiveContainer></div> : <ChartEmpty />}
  </ChartPanel>;
}

function EmployeeTable({ report, period }: { report: AnalyticsReport; period: ResolvedReportPeriod }) {
  return <ChartPanel eyebrow="Equipo" icon={Users} title="Ventas por empleado">
    {report.employees.length ? <div className="analytics-table-wrap" data-mobile-cards><table className="analytics-table"><thead><tr><th>Empleado</th><th>Operaciones</th><th>Facturación</th><th>Ticket prom.</th><th>Unidades</th></tr></thead><tbody>{report.employees.map((item) => <tr key={item.id ?? "historical"}><td data-label="Empleado"><Link href={`/app/ventas?desde=${period.from}&hasta=${period.to}${item.id ? `&empleado=${item.id}` : ""}`}>{item.name}</Link></td><td data-label="Operaciones">{item.operations}</td><td data-label="Facturación">{money.format(item.revenue)}</td><td data-label="Ticket prom.">{money.format(item.averageTicket)}</td><td data-label="Unidades">{number.format(item.units)}</td></tr>)}</tbody></table></div> : <ChartEmpty />}
  </ChartPanel>;
}

function InventorySummary({ report }: { report: AnalyticsReport }) {
  const inventory = report.inventory;
  const items = [
    { label: "Productos activos", value: number.format(inventory.productCount), icon: Boxes },
    { label: "Unidades en stock", value: number.format(inventory.stockUnits), icon: ShoppingBag },
    { label: "Sin stock", value: number.format(inventory.outOfStock), icon: PackageSearch },
    { label: "Stock bajo", value: number.format(inventory.lowStock), icon: Gauge },
    { label: "Sobre objetivo", value: number.format(inventory.excessStock), icon: TrendingUp },
    { label: "Inventario a costo", value: money.format(inventory.costValue), icon: CircleDollarSign },
    { label: "Venta potencial", value: money.format(inventory.retailValue), icon: WalletCards },
  ];
  return <div className="inventory-stat-grid">{items.map(({ label, value, icon: Icon }) => <article key={label}><Icon size={18} /><span>{label}</span><strong>{value}</strong></article>)}</div>;
}

function SlowProducts({ report }: { report: AnalyticsReport }) {
  const [threshold, setThreshold] = useState<30 | 60 | 90>(30);
  const products = report.slowProducts.filter((item) => item.daysWithoutSale === null || item.daysWithoutSale >= threshold);
  const actions = <div className="compact-controls"><select aria-label="Días sin venta" value={threshold} onChange={(event) => setThreshold(Number(event.target.value) as 30 | 60 | 90)}><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></div>;
  return <ChartPanel actions={actions} eyebrow="Capital inmovilizado" icon={PackageSearch} title="Productos con poca rotación">
    {products.length ? <div className="analytics-table-wrap" data-mobile-cards><table className="analytics-table"><thead><tr><th>Producto</th><th>Stock</th><th>Última venta</th><th>Sin vender</th><th>Valor a costo</th></tr></thead><tbody>{products.map((item) => <tr key={item.id}><td data-label="Producto"><Link href={`/app/productos/${item.id}`}>{item.name}<small>{item.sku}</small></Link></td><td data-label="Stock">{number.format(item.stock)}</td><td data-label="Última venta">{item.lastSale ? formatDate(item.lastSale) : "Sin ventas"}</td><td data-label="Sin vender">{item.daysWithoutSale === null ? "Sin historial" : `${item.daysWithoutSale} días`}</td><td data-label="Valor a costo">{money.format(item.immobilizedCost)}</td></tr>)}</tbody></table></div> : <ChartEmpty>{`No hay productos con stock detenidos por más de ${threshold} días.`}</ChartEmpty>}
  </ChartPanel>;
}

function ExpenseCategoryChart({ report }: { report: AnalyticsReport }) {
  return <ChartPanel eyebrow="Egresos" icon={ReceiptText} title="Gastos por categoría">
    {report.expenseCategories.length ? <div className="chart-frame"><ResponsiveContainer height="100%" width="100%"><BarChart data={[...report.expenseCategories].reverse()} layout="vertical" margin={{ top: 8, right: 18, left: 8, bottom: 0 }}><CartesianGrid horizontal={false} stroke="#e7e2eb" strokeDasharray="3 4" /><XAxis axisLine={false} fontSize={11} tickFormatter={(value: number) => compactMoney.format(value)} tickLine={false} type="number" /><YAxis axisLine={false} dataKey="name" fontSize={11} tickLine={false} type="category" width={120} /><Tooltip formatter={(value) => money.format(Number(value))} /><Bar dataKey="amount" fill="#e88f82" maxBarSize={28} name="Gastos" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <ChartEmpty>No hay gastos contabilizados en el período.</ChartEmpty>}
  </ChartPanel>;
}

function ProfitabilityPanel({ report }: { report: AnalyticsReport }) {
  const current = report.summary.current;
  const rows = [
    ["Venta bruta", current.grossRevenue ?? current.revenue],
    ["Descuentos", -(current.discounts ?? 0)],
    ["Ingreso neto", current.netRevenue ?? current.revenue],
    ["Facturación con costo conocido", current.knownRevenue],
    ["Costo histórico de mercadería", -current.knownCogs],
    ["Ganancia bruta comprobable", current.grossProfitKnown],
    ["Gastos operativos", -current.expenses],
    ["Personal pagado", -current.payroll],
  ] as const;
  return <ChartPanel className="profitability-panel" eyebrow="Rentabilidad" icon={CircleDollarSign} title="Resultado del período">
    <dl className="profitability-breakdown">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value < 0 ? "negative" : ""}>{money.format(value)}</dd></div>)}<div className="profitability-total"><dt>Resultado estimado</dt><dd>{current.estimatedResult === null ? "No calculable" : money.format(current.estimatedResult)}</dd></div></dl>
    {current.unknownRevenue > 0 ? <p className="data-caveat">Hay {money.format(current.unknownRevenue)} de ventas sin costo histórico. Se muestran en facturación, pero se excluyen del margen y del resultado para no usar costos actuales falsos.</p> : <p className="data-confirmed">Todas las ventas del período tienen costo histórico utilizable.</p>}
  </ChartPanel>;
}

export function AnalyticsDashboard({ report, period, search }: { report: AnalyticsReport; period: ResolvedReportPeriod; search: ReportSearchParams }) {
  const [tab, setTab] = useState<Tab>("summary");
  const current = report.summary.current;
  const previous = report.summary.previous;
  const salesHref = `/app/ventas?desde=${period.from}&hasta=${period.to}`;
  const kpis = [
    { label: "Ventas totales", value: money.format(current.revenue), detail: `${current.saleCount} operaciones`, icon: Banknote, current: current.revenue, previous: previous.revenue, href: salesHref },
    { label: "Cantidad de ventas", value: number.format(current.saleCount), detail: "Operaciones completadas", icon: ShoppingBag, current: current.saleCount, previous: previous.saleCount, href: salesHref },
    { label: "Ticket promedio", value: money.format(current.averageTicket), detail: "Facturación por operación", icon: CreditCard, current: current.averageTicket, previous: previous.averageTicket },
    { label: "Ganancia comprobable", value: money.format(current.grossProfitKnown), detail: current.unknownRevenue > 0 ? `${money.format(current.unknownRevenue)} sin costo` : "Costo histórico completo", icon: TrendingUp, current: current.grossProfitKnown, previous: previous.grossProfitKnown },
    { label: "Egresos totales", value: money.format(current.operatingExpenses), detail: current.expenseToRevenuePct === null ? "Gastos operativos + Personal" : `${percent.format(current.expenseToRevenuePct)}% de las ventas`, icon: ReceiptText, current: current.operatingExpenses, previous: previous.operatingExpenses },
    { label: "Margen bruto", value: current.grossMarginKnownPct === null ? "Sin datos" : `${percent.format(current.grossMarginKnownPct)}%`, detail: "Solo ventas con costo conocido", icon: Gauge, current: current.grossMarginKnownPct, previous: previous.grossMarginKnownPct },
    { label: "Productos vendidos", value: number.format(current.unitsSold), detail: "Unidades con detalle registrado", icon: Boxes, current: current.unitsSold, previous: previous.unitsSold },
  ];
  const tabs: Array<{ id: Tab; label: string; icon: typeof Banknote }> = [
    { id: "summary", label: "Resumen", icon: BarChart3 },
    { id: "sales", label: "Ventas", icon: ShoppingBag },
    { id: "products", label: "Productos y stock", icon: Boxes },
    { id: "profitability", label: "Gastos y rentabilidad", icon: CircleDollarSign },
  ];

  return <>
    <ReportFilters period={period} report={report} search={search} />
    <div className="analytics-period-note"><span>Período: {formatDate(period.from)} al {formatDate(period.to)}</span>{period.compare ? <span>Comparado con {comparisonLabel(period)}</span> : null}</div>
    <nav aria-label="Vistas de reportes" className="analytics-tabs">{tabs.map(({ id, label, icon: Icon }) => <button aria-current={tab === id ? "page" : undefined} className={tab === id ? "is-active" : ""} key={id} onClick={() => setTab(id)} type="button"><Icon size={17} />{label}</button>)}</nav>

    {tab === "summary" ? <div className="analytics-view">
      <section className="analytics-kpi-grid" aria-label="Indicadores principales">{kpis.map((item) => <KpiCard compare={period.compare} key={item.label} {...item} />)}</section>
      <div className="analytics-main-grid"><ChartPanel className="analytics-span-2" eyebrow="Evolución" icon={TrendingUp} title="Facturación del período"><SalesTimeline compare={period.compare} report={report} /></ChartPanel><GoalPanel period={period} report={report} /></div>
      <div className="analytics-two-grid"><TopProducts report={report} /><ChartPanel eyebrow="Lectura rápida" icon={Gauge} title="Tendencias del negocio"><InsightList compare={period.compare} report={report} /></ChartPanel></div>
      <div className="analytics-two-grid"><CategoryChart report={report} /><PaymentChart report={report} /></div>
    </div> : null}

    {tab === "sales" ? <div className="analytics-view"><div className="analytics-two-grid"><WeekdayChart report={report} /><HourChart report={report} /></div><div className="analytics-two-grid"><TicketTimeline compare={period.compare} report={report} /><PaymentChart report={report} /></div><div className="analytics-two-grid"><TopProducts report={report} /><EmployeeTable period={period} report={report} /></div></div> : null}

    {tab === "products" ? <div className="analytics-view"><InventorySummary report={report} /><div className="analytics-two-grid"><TopProducts report={report} /><CategoryChart report={report} /></div><SlowProducts report={report} /></div> : null}

    {tab === "profitability" ? <div className="analytics-view"><section className="analytics-kpi-grid analytics-kpi-grid-compact">{kpis.filter((item) => ["Ventas totales", "Ganancia comprobable", "Egresos totales", "Margen bruto"].includes(item.label)).map((item) => <KpiCard compare={period.compare} key={item.label} {...item} />)}</section><div className="analytics-two-grid"><ProfitabilityPanel report={report} /><ExpenseCategoryChart report={report} /></div><ChartPanel eyebrow="Ingresos y egresos" icon={WalletCards} title="Evolución comparada"><div className="chart-frame chart-frame-large"><ResponsiveContainer height="100%" width="100%"><AreaChart data={report.timeline.map((point) => ({ ...point, label: formatDate(point.currentLabel) }))} margin={{ top: 12, right: 10, left: 2, bottom: 0 }}><CartesianGrid stroke="#e7e2eb" strokeDasharray="3 4" vertical={false} /><XAxis axisLine={false} dataKey="label" fontSize={11} tickLine={false} /><YAxis axisLine={false} fontSize={11} tickFormatter={(value: number) => compactMoney.format(value)} tickLine={false} width={72} /><Tooltip formatter={(value) => money.format(Number(value))} /><Legend /><Area dataKey="currentRevenue" fill="#d9eee8" name="Ventas" stroke="#3f9483" strokeWidth={2} type="monotone" /><Line dataKey="currentExpenses" dot={false} name="Egresos totales" stroke="#e88f82" strokeWidth={2} type="monotone" /></AreaChart></ResponsiveContainer></div></ChartPanel></div> : null}

    <div className="analytics-drilldown"><Link href={salesHref}>Ver operaciones del período <ArrowRight size={16} /></Link></div>
  </>;
}
