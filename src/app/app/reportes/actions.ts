"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import { friendlyDatabaseError, textField, type ActionState } from "@/lib/actions/form-state";

const goalSchema = z.object({
  goal_month: z.string().regex(/^\d{4}-\d{2}$/),
  sales_target: z.coerce.number().positive().max(999_999_999_999.99),
});

export async function saveMonthlyGoalAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = goalSchema.safeParse({
    goal_month: textField(formData, "goal_month"),
    sales_target: textField(formData, "sales_target"),
  });
  if (!parsed.success) return { error: "Ingresá un mes y un importe mayor a cero." };

  const { organization, supabase, userId } = await requireActionContext(["owner", "admin"]);
  const goalMonth = `${parsed.data.goal_month}-01`;
  const existing = await supabase
    .from("monthly_sales_goals")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("goal_month", goalMonth)
    .maybeSingle();
  if (existing.error) return { error: friendlyDatabaseError(existing.error) };

  const result = existing.data
    ? await supabase
      .from("monthly_sales_goals")
      .update({ sales_target: parsed.data.sales_target })
      .eq("id", existing.data.id)
      .eq("organization_id", organization.id)
    : await supabase.from("monthly_sales_goals").insert({
      organization_id: organization.id,
      goal_month: goalMonth,
      sales_target: parsed.data.sales_target,
      created_by: userId,
    });

  if (result.error) return { error: friendlyDatabaseError(result.error) };
  revalidatePath("/app/reportes");
  return { message: "Meta mensual guardada." };
}
