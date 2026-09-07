"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import {
  friendlyDatabaseError,
  textField,
  type ActionState,
} from "@/lib/actions/form-state";

const employeeSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  first_name: z.string().trim().min(2).max(100),
  last_name: z.string().trim().min(2).max(100),
  document_number: z.string().trim().max(30),
  email: z.union([z.email().max(254), z.literal("")]),
  phone: z.string().trim().max(60),
  hire_date: z.union([z.iso.date(), z.literal("")]),
  user_id: z.union([z.uuid(), z.literal("")]),
  notes: z.string().trim().max(1000),
});

export async function saveEmployeeAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = employeeSchema.safeParse({
    id: textField(formData, "id"),
    first_name: textField(formData, "first_name"),
    last_name: textField(formData, "last_name"),
    document_number: textField(formData, "document_number"),
    email: textField(formData, "email").toLowerCase(),
    phone: textField(formData, "phone"),
    hire_date: textField(formData, "hire_date"),
    user_id: textField(formData, "user_id"),
    notes: textField(formData, "notes"),
  });
  if (!parsed.success) return { error: "Revisá los datos personales y la cuenta vinculada." };

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const payload = {
    first_name: parsed.data.first_name,
    last_name: parsed.data.last_name,
    document_number: parsed.data.document_number || null,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    hire_date: parsed.data.hire_date || null,
    user_id: parsed.data.user_id || null,
    notes: parsed.data.notes || null,
  };
  const result = parsed.data.id
    ? await supabase.from("employees").update(payload).eq("id", parsed.data.id).eq("organization_id", organization.id)
    : await supabase.from("employees").insert({ ...payload, base_salary: 0, organization_id: organization.id });
  if (result.error) return { error: friendlyDatabaseError(result.error) };
  revalidatePath("/app/personal");
  return { message: parsed.data.id ? "Empleado actualizado." : "Empleado agregado." };
}

export async function toggleEmployeeAction(formData: FormData) {
  const id = textField(formData, "id");
  const status = textField(formData, "status");
  if (!z.uuid().safeParse(id).success || !["active", "inactive"].includes(status)) return;
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase
    .from("employees")
    .update({ status: status as "active" | "inactive" })
    .eq("id", id)
    .eq("organization_id", organization.id);
  if (error) throw new Error(friendlyDatabaseError(error));
  revalidatePath("/app/personal");
}

const payrollSchema = z.object({
  employee_id: z.uuid(),
  kind: z.enum(["advance", "bonus", "deduction"]),
  amount: z.number().positive().max(999_999_999),
  period_month: z.string().regex(/^\d{4}-\d{2}$/),
  paid_at: z.union([z.iso.date(), z.literal("")]),
  notes: z.string().trim().max(500),
});

export async function createPayrollMovementAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = payrollSchema.safeParse({
    employee_id: textField(formData, "employee_id"),
    kind: textField(formData, "kind"),
    amount: Number(textField(formData, "amount").replace(",", ".")),
    period_month: textField(formData, "period_month"),
    paid_at: textField(formData, "paid_at"),
    notes: textField(formData, "notes"),
  });
  if (!parsed.success) return { error: "Revisá el empleado, concepto, período e importe." };

  const { organization, supabase, userId } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.from("payroll_movements").insert({
    organization_id: organization.id,
    employee_id: parsed.data.employee_id,
    kind: parsed.data.kind,
    amount: parsed.data.amount,
    period_month: `${parsed.data.period_month}-01`,
    paid_at: parsed.data.paid_at || null,
    notes: parsed.data.notes || null,
    created_by: userId,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  revalidatePath("/app/personal");
  return { message: "Movimiento de sueldo registrado." };
}

export async function deletePayrollMovementAction(formData: FormData) {
  const id = textField(formData, "id");
  if (!z.uuid().safeParse(id).success) return;
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { data, error } = await supabase.from("payroll_movements").delete().eq("id", id).eq("organization_id", organization.id).select("id").maybeSingle();
  if (error) throw new Error(friendlyDatabaseError(error));
  if (!data) throw new Error("El movimiento ya no existe o no está disponible.");
  revalidatePath("/app/personal");
}

const compensationSchema = z.object({
  employee_id: z.uuid(),
  base_salary: z.number().nonnegative().max(999_999_999),
  commission_percentage: z.number().min(0).max(100),
  effective_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  notes: z.string().trim().max(500),
});

export async function saveCompensationAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = compensationSchema.safeParse({
    employee_id: textField(formData, "employee_id"),
    base_salary: Number(textField(formData, "base_salary").replace(",", ".")),
    commission_percentage: Number(textField(formData, "commission_percentage").replace(",", ".")),
    effective_month: textField(formData, "effective_month"),
    notes: textField(formData, "notes"),
  });
  if (!parsed.success) return { error: "Revisá el sueldo, porcentaje y mes de vigencia." };

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.rpc("set_employee_compensation", {
    p_organization_id: organization.id,
    p_employee_id: parsed.data.employee_id,
    p_base_salary: parsed.data.base_salary,
    p_commission_percentage: parsed.data.commission_percentage,
    p_effective_from: `${parsed.data.effective_month}-01`,
    p_notes: parsed.data.notes || undefined,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  revalidatePath("/app/personal");
  revalidatePath("/app/mi-sueldo");
  return { message: "Condiciones salariales actualizadas." };
}

const settlementSchema = z.object({
  employee_id: z.uuid(),
  period_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  notes: z.string().trim().max(500),
});

export async function settlePayrollAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = settlementSchema.safeParse({
    employee_id: textField(formData, "employee_id"),
    period_month: textField(formData, "period_month"),
    notes: textField(formData, "notes"),
  });
  if (!parsed.success) return { error: "Revisá el empleado y el período." };

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.rpc("settle_employee_payroll", {
    p_organization_id: organization.id,
    p_employee_id: parsed.data.employee_id,
    p_period_month: `${parsed.data.period_month}-01`,
    p_notes: parsed.data.notes || undefined,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  revalidatePath("/app/personal");
  revalidatePath("/app/mi-sueldo");
  return { message: "Sueldo liquidado y snapshot histórico guardado." };
}

const paymentSchema = z.object({
  settlement_id: z.uuid(),
  paid_at: z.iso.date(),
  payments: z.array(z.object({
    payment_method_id: z.uuid(),
    amount: z.number().positive().max(999_999_999),
  })).max(20),
  notes: z.string().trim().max(500),
});

export async function markPayrollPaidAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let decodedPayments: unknown;
  try {
    decodedPayments = JSON.parse(textField(formData, "payments"));
  } catch {
    return { error: "La distribución del pago no es válida." };
  }

  const parsed = paymentSchema.safeParse({
    settlement_id: textField(formData, "settlement_id"),
    paid_at: textField(formData, "paid_at"),
    payments: decodedPayments,
    notes: textField(formData, "notes"),
  });
  if (!parsed.success) return { error: "Revisá la fecha, los medios y los importes del pago." };

  if (new Set(parsed.data.payments.map((payment) => payment.payment_method_id)).size !== parsed.data.payments.length) {
    return { error: "No se puede repetir el mismo medio de pago." };
  }

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.rpc("mark_payroll_settlement_paid_with_payments", {
    p_organization_id: organization.id,
    p_settlement_id: parsed.data.settlement_id,
    p_paid_at: parsed.data.paid_at,
    p_payments: parsed.data.payments,
    p_notes: parsed.data.notes || undefined,
  });
  if (error) return { error: friendlyDatabaseError(error) };
  revalidatePath("/app/personal");
  revalidatePath("/app/mi-sueldo");
  revalidatePath("/app/reportes");
  revalidatePath("/app/caja");
  return { message: parsed.data.payments.length > 1
    ? "Liquidación pagada con distribución combinada."
    : "Liquidación marcada como pagada." };
}
