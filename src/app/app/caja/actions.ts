"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import { friendlyDatabaseError, textField, type ActionState } from "@/lib/actions/form-state";
import { normalizeCashClosureResult, type CashClosureResult } from "@/lib/cash/closures";
import { argentinaLocalDateTimeToIso } from "@/lib/date";

export type CashClosureActionState = ActionState & { closure?: CashClosureResult };

function amount(formData: FormData, key: string) {
  return Number(textField(formData, key).replace(",", "."));
}

function localTimestamp(formData: FormData, key: string) {
  return argentinaLocalDateTimeToIso(textField(formData, key));
}

function refreshCash() {
  revalidatePath("/app");
  revalidatePath("/app/caja");
  revalidatePath("/app/ventas");
}

export async function closeDailyCashAction(
  _state: CashClosureActionState,
  formData: FormData,
): Promise<CashClosureActionState> {
  let countedBalances: unknown;
  try {
    countedBalances = JSON.parse(textField(formData, "counted_balances"));
  } catch {
    return { error: "Los saldos contados no son válidos." };
  }
  const parsed = z.object({
    business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    counted_balances: z.array(z.object({
      payment_method_id: z.uuid(),
      counted_balance: z.number().nonnegative().max(999_999_999),
    })).min(1),
    notes: z.string().trim().max(500),
    confirmed: z.literal("on"),
  }).safeParse({
    business_date: textField(formData, "business_date"),
    counted_balances: countedBalances,
    notes: textField(formData, "notes"),
    confirmed: textField(formData, "confirmed"),
  });
  if (!parsed.success) return { error: "Completá todos los saldos y confirmá el conteo antes de cerrar." };

  const { organization, supabase } = await requireActionContext();
  const { data, error } = await supabase.rpc("close_daily_cash", {
    p_organization_id: organization.id,
    p_business_date: parsed.data.business_date,
    p_counted_balances: parsed.data.counted_balances,
    p_notes: parsed.data.notes || undefined,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  refreshCash();
  return { message: "Cierre diario registrado.", closure: normalizeCashClosureResult(data) };
}

export async function initializeCashAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const cutoff = localTimestamp(formData, "tracking_started_at");
  let balances: unknown;
  try { balances = JSON.parse(textField(formData, "balances")); } catch { return { error: "Los saldos iniciales no son válidos." }; }
  const parsed = z.array(z.object({ payment_method_id: z.uuid(), amount: z.number().nonnegative().max(999_999_999) })).min(1).safeParse(balances);
  if (!cutoff || !parsed.success) return { error: "Revisá la fecha de corte y todos los saldos iniciales." };
  const { error } = await supabase.rpc("initialize_cash_tracking", {
    p_organization_id: organization.id, p_tracking_started_at: cutoff, p_balances: parsed.data,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  refreshCash();
  return { message: "Seguimiento de caja iniciado. Los saldos quedaron registrados como movimientos." };
}

export async function transferCashAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({
    from: z.uuid(), to: z.uuid(), amount: z.number().positive().max(999_999_999),
    occurred_at: z.string().min(1), notes: z.string().trim().min(3).max(500),
  }).safeParse({ from: textField(formData, "from"), to: textField(formData, "to"), amount: amount(formData, "amount"), occurred_at: localTimestamp(formData, "occurred_at"), notes: textField(formData, "notes") });
  if (!parsed.success || parsed.data.from === parsed.data.to) return { error: "Elegí dos cajas distintas, un monto válido y un motivo." };
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.rpc("transfer_cash", {
    p_organization_id: organization.id, p_from_payment_method_id: parsed.data.from,
    p_to_payment_method_id: parsed.data.to, p_amount: parsed.data.amount,
    p_occurred_at: parsed.data.occurred_at, p_notes: parsed.data.notes,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  refreshCash();
  return { message: "Transferencia registrada en ambas cajas." };
}

export async function manualCashAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({
    payment_method_id: z.uuid(), direction: z.enum(["credit", "debit"]),
    amount: z.number().positive().max(999_999_999), concept: z.string().trim().min(2).max(160),
    occurred_at: z.string().min(1), notes: z.string().trim().max(500),
  }).safeParse({ payment_method_id: textField(formData, "payment_method_id"), direction: textField(formData, "direction"), amount: amount(formData, "amount"), concept: textField(formData, "concept"), occurred_at: localTimestamp(formData, "occurred_at"), notes: textField(formData, "notes") });
  if (!parsed.success) return { error: "Revisá el tipo, caja, monto, fecha y concepto." };
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.rpc("record_manual_cash_movement", {
    p_organization_id: organization.id, p_payment_method_id: parsed.data.payment_method_id,
    p_direction: parsed.data.direction, p_amount: parsed.data.amount, p_concept: parsed.data.concept,
    p_occurred_at: parsed.data.occurred_at, p_notes: parsed.data.notes || undefined,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  refreshCash();
  return { message: "Movimiento extraordinario registrado." };
}

export async function reconcileCashAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ payment_method_id: z.uuid(), counted_balance: z.number().min(-999_999_999).max(999_999_999), reason: z.string().trim().min(3).max(500), occurred_at: z.string().min(1) }).safeParse({
    payment_method_id: textField(formData, "payment_method_id"), counted_balance: amount(formData, "counted_balance"),
    reason: textField(formData, "reason"), occurred_at: localTimestamp(formData, "occurred_at"),
  });
  if (!parsed.success) return { error: "Ingresá el saldo contado, la caja y un motivo claro." };
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { data, error } = await supabase.rpc("reconcile_cash_account", {
    p_organization_id: organization.id, p_payment_method_id: parsed.data.payment_method_id,
    p_counted_balance: parsed.data.counted_balance, p_reason: parsed.data.reason,
    p_occurred_at: parsed.data.occurred_at,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  refreshCash();
  const difference = Number((data as { difference?: number } | null)?.difference ?? 0);
  return { message: difference === 0 ? "La caja ya coincidía con el saldo contado." : "Control registrado con su ajuste auditable." };
}
