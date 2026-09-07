"use client";

import { ArrowRightLeft, ClipboardCheck, Landmark, WalletCards } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { initializeCashAction, manualCashAction, reconcileCashAction, transferCashAction } from "@/app/app/caja/actions";
import { SensitiveAmount, useSensitiveBalances } from "@/components/finance/sensitive-balances";
import type { ActionState } from "@/lib/actions/form-state";
import { ars } from "@/lib/format";

type AccountOption = { payment_method_id: string; name: string; balance: number };

function localNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function Message({ state }: { state: ActionState }) {
  if (!state.error && !state.message) return null;
  return <p className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>;
}

export function InitialBalanceForm({ methods }: { methods: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(initializeCashAction, {});
  const [balances, setBalances] = useState<Record<string, string>>(() => Object.fromEntries(methods.map((method) => [method.id, "0"])));
  const serialized = useMemo(() => methods.map((method) => ({ payment_method_id: method.id, amount: Number(balances[method.id] || 0) })), [balances, methods]);
  return <form action={action} className="cash-setup-form">
    <input name="balances" type="hidden" value={JSON.stringify(serialized)} />
    <label className="field-label">Fecha y hora de corte<input className="field-input" defaultValue={localNow()} max={localNow()} name="tracking_started_at" required type="datetime-local" /></label>
    <div className="cash-opening-grid">
      {methods.map((method) => <label className="field-label" key={method.id}>{method.name}<div className="money-input"><span>$</span><input aria-label={`Saldo inicial de ${method.name}`} inputMode="decimal" min="0" onChange={(event) => setBalances((current) => ({ ...current, [method.id]: event.target.value }))} required step="0.01" type="number" value={balances[method.id]} /></div></label>)}
    </div>
    <p className="form-hint">La fecha de corte separa el saldo disponible actual de las operaciones históricas. Esta configuración se realiza una sola vez.</p>
    <Message state={state} />
    <button className="button button-primary" disabled={pending} type="submit"><Landmark size={17} /> {pending ? "Iniciando..." : "Iniciar seguimiento"}</button>
  </form>;
}

export function TransferForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(transferCashAction, {});
  const { hidden } = useSensitiveBalances();
  return <form action={action} className="entity-form cash-action-form">
    <div className="form-grid">
      <label className="field-label">Desde<select className="field-input" name="from" required>{accounts.map((account) => <option key={account.payment_method_id} value={account.payment_method_id}>{account.name} · {hidden ? "••••••••" : ars.format(account.balance)}</option>)}</select></label>
      <label className="field-label">Hacia<select className="field-input" defaultValue={accounts[1]?.payment_method_id} name="to" required>{accounts.map((account) => <option key={account.payment_method_id} value={account.payment_method_id}>{account.name}</option>)}</select></label>
      <label className="field-label">Monto<input className="field-input" inputMode="decimal" min="0.01" name="amount" required step="0.01" type="number" /></label>
      <label className="field-label">Fecha y hora<input className="field-input" defaultValue={localNow()} name="occurred_at" required type="datetime-local" /></label>
      <label className="field-label form-span-2">Motivo<input className="field-input" maxLength={500} minLength={3} name="notes" placeholder="Ej. Depósito de efectivo en cuenta" required /></label>
    </div><Message state={state} /><button className="button button-primary" disabled={pending || accounts.length < 2} type="submit"><ArrowRightLeft size={17} /> {pending ? "Transfiriendo..." : "Registrar transferencia"}</button>
  </form>;
}

export function ManualMovementForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(manualCashAction, {});
  return <form action={action} className="entity-form cash-action-form"><div className="form-grid">
    <label className="field-label">Tipo<select className="field-input" name="direction"><option value="credit">Ingreso manual</option><option value="debit">Egreso manual</option></select></label>
    <label className="field-label">Caja<select className="field-input" name="payment_method_id">{accounts.map((account) => <option key={account.payment_method_id} value={account.payment_method_id}>{account.name}</option>)}</select></label>
    <label className="field-label">Monto<input className="field-input" inputMode="decimal" min="0.01" name="amount" required step="0.01" type="number" /></label>
    <label className="field-label">Fecha y hora<input className="field-input" defaultValue={localNow()} name="occurred_at" required type="datetime-local" /></label>
    <label className="field-label form-span-2">Concepto<input className="field-input" maxLength={160} minLength={2} name="concept" placeholder="Ej. Aporte de capital del dueño" required /></label>
    <label className="field-label form-span-2">Observación<textarea className="field-textarea" maxLength={500} name="notes" rows={2} /></label>
  </div><Message state={state} /><button className="button button-primary" disabled={pending} type="submit"><WalletCards size={17} /> {pending ? "Registrando..." : "Registrar movimiento"}</button></form>;
}

export function ReconcileForm({ accounts }: { accounts: AccountOption[] }) {
  const [selected, setSelected] = useState(accounts[0]?.payment_method_id ?? "");
  const [counted, setCounted] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(reconcileCashAction, {});
  const system = accounts.find((account) => account.payment_method_id === selected)?.balance ?? 0;
  const difference = counted === "" ? null : Number(counted) - system;
  return <form action={action} className="entity-form cash-action-form"><div className="form-grid">
    <label className="field-label">Caja<select className="field-input" name="payment_method_id" onChange={(event) => setSelected(event.target.value)} value={selected}>{accounts.map((account) => <option key={account.payment_method_id} value={account.payment_method_id}>{account.name}</option>)}</select></label>
    <label className="field-label">Saldo contado<input className="field-input" inputMode="decimal" name="counted_balance" onChange={(event) => setCounted(event.target.value)} required step="0.01" type="number" value={counted} /></label>
    <label className="field-label">Fecha y hora<input className="field-input" defaultValue={localNow()} name="occurred_at" required type="datetime-local" /></label>
    <label className="field-label">Diferencia<span className={`cash-difference ${difference && difference < 0 ? "negative-value" : ""}`}>{difference === null ? "Ingresá el conteo" : <SensitiveAmount>{ars.format(difference)}</SensitiveAmount>}</span></label>
    <label className="field-label form-span-2">Motivo<input className="field-input" maxLength={500} minLength={3} name="reason" placeholder="Ej. Diferencia detectada en arqueo" required /></label>
  </div><p className="form-hint">Saldo del sistema: <strong><SensitiveAmount>{ars.format(system)}</SensitiveAmount></strong>. Solo se registrará la diferencia, conservando ambos valores.</p><Message state={state} /><button className="button button-primary" disabled={pending} type="submit"><ClipboardCheck size={17} /> {pending ? "Controlando..." : "Registrar control"}</button></form>;
}
