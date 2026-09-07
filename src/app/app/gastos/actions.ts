"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import {
  friendlyDatabaseError,
  textField,
  type ActionState,
} from "@/lib/actions/form-state";

const expenseSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]),
  description: z.string().trim().min(2).max(240),
  amount: z.number().positive().max(999_999_999),
  expense_date: z.iso.date(),
  notes: z.string().trim().max(1000),
  payment_method_id: z.uuid(),
  category_id: z.union([z.uuid(), z.literal("")]),
  payroll_employee_id: z.union([z.uuid(), z.literal("")]),
  payroll_period_month: z.union([z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), z.literal("")]),
});

export async function saveExpenseAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = expenseSchema.safeParse({
    id: textField(formData, "id"),
    description: textField(formData, "description"),
    amount: Number(textField(formData, "amount").replace(",", ".")),
    expense_date: textField(formData, "expense_date"),
    notes: textField(formData, "notes"),
    payment_method_id: textField(formData, "payment_method_id"),
    category_id: textField(formData, "category_id"),
    payroll_employee_id: textField(formData, "payroll_employee_id"),
    payroll_period_month: textField(formData, "payroll_period_month"),
  });

  if (!parsed.success) {
    return { error: "Revisá la descripción, importe y fecha del gasto." };
  }

  const context = parsed.data.id
    ? await requireActionContext(["owner", "admin"])
    : await requireActionContext();
  const { organization, supabase, userId } = context;
  const { data: category, error: categoryError } = parsed.data.category_id
    ? await supabase
        .from("expense_categories")
        .select("id, is_payroll_advance")
        .eq("id", parsed.data.category_id)
        .eq("organization_id", organization.id)
        .maybeSingle()
    : { data: null, error: null };

  if (categoryError || (parsed.data.category_id && !category)) {
    return { error: "La categoría seleccionada ya no está disponible." };
  }

  const isPayrollAdvance = category?.is_payroll_advance ?? false;
  if (isPayrollAdvance && organization.role === "staff") {
    return { error: "Solo un administrador puede registrar adelantos de sueldo." };
  }
  if (isPayrollAdvance && (!parsed.data.payroll_employee_id || !parsed.data.payroll_period_month)) {
    return { error: "Elegí la empleada y el mes donde se descontará el adelanto." };
  }

  const payload = {
    description: parsed.data.description,
    amount: parsed.data.amount,
    expense_date: parsed.data.expense_date,
    category_id: parsed.data.category_id || null,
    payment_method_id: parsed.data.payment_method_id,
    notes: parsed.data.notes || null,
    payroll_employee_id: isPayrollAdvance ? parsed.data.payroll_employee_id : null,
    payroll_period_month: isPayrollAdvance ? `${parsed.data.payroll_period_month}-01` : null,
  };

  const result = parsed.data.id
    ? await supabase
        .from("expenses")
        .update(payload)
        .eq("id", parsed.data.id)
        .eq("organization_id", organization.id)
    : await supabase.from("expenses").insert({
        ...payload,
        organization_id: organization.id,
        created_by: userId,
      });

  if (result.error) return { error: friendlyDatabaseError(result.error) };
  revalidatePath("/app");
  revalidatePath("/app/gastos");
  revalidatePath("/app/caja");
  revalidatePath("/app/personal");
  revalidatePath("/app/mi-sueldo");
  return { message: parsed.data.id ? "Gasto actualizado." : "Gasto registrado." };
}

export async function cancelExpenseAction(formData: FormData) {
  const id = textField(formData, "id");
  const reason = textField(formData, "reason");
  if (!z.uuid().safeParse(id).success || reason.length < 3) return;
  const { supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.rpc("cancel_expense", {
    p_expense_id: id,
    p_reason: reason.slice(0, 500),
  });
  if (error) throw new Error(friendlyDatabaseError(error));
  revalidatePath("/app");
  revalidatePath("/app/gastos");
  revalidatePath("/app/caja");
}

export async function createExpenseCategoryAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = textField(formData, "name");
  if (name.length < 2 || name.length > 100) {
    return { error: "Ingresá un nombre de entre 2 y 100 caracteres." };
  }
  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { error } = await supabase.from("expense_categories").insert({
    organization_id: organization.id,
    name,
    is_payroll_advance: ["sueldo", "sueldos"].includes(name.trim().toLowerCase()),
  });
  if (error) return { error: friendlyDatabaseError(error) };
  revalidatePath("/app/gastos");
  return { message: "Categoría creada." };
}
