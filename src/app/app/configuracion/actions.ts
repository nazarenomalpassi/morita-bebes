"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActionContext } from "@/lib/actions/context";
import {
  friendlyDatabaseError,
  textField,
  type ActionState,
} from "@/lib/actions/form-state";

const settingsSchema = z.object({
  organization_name: z.string().trim().min(2).max(80),
  whatsapp: z.string().trim().max(60),
  email: z.union([z.email().max(254), z.literal("")]),
  address: z.string().trim().max(240),
  instagram_url: z.union([z.url().max(500), z.literal("")]),
});

export async function saveSettingsAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = settingsSchema.safeParse({
    organization_name: textField(formData, "organization_name"),
    whatsapp: textField(formData, "whatsapp"),
    email: textField(formData, "email").toLowerCase(),
    address: textField(formData, "address"),
    instagram_url: textField(formData, "instagram_url"),
  });
  if (!parsed.success) return { error: "Revisá el nombre, correo y enlaces del comercio." };

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const [organizationResult, settingsResult] = await Promise.all([
    supabase.from("organizations").update({ name: parsed.data.organization_name }).eq("id", organization.id),
    supabase.from("site_settings").upsert({
      organization_id: organization.id,
      whatsapp: parsed.data.whatsapp || null,
      email: parsed.data.email || null,
      address: parsed.data.address || null,
      instagram_url: parsed.data.instagram_url || null,
    }),
  ]);
  const error = organizationResult.error ?? settingsResult.error;
  if (error) return { error: friendlyDatabaseError(error) };
  revalidatePath("/app", "layout");
  revalidatePath("/app/configuracion");
  return { message: "Configuración actualizada." };
}

const surchargeSchema = z.object({
  debit_surcharge_percent: z.number().min(0).max(100),
  credit_surcharge_percent: z.number().min(0).max(100),
}).refine(
  (values) => [values.debit_surcharge_percent, values.credit_surcharge_percent]
    .every((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001),
  { message: "Los porcentajes admiten hasta dos decimales." },
);

function percentageField(formData: FormData, key: string) {
  return Number(textField(formData, key).replace(",", "."));
}

export async function savePaymentSurchargesAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = surchargeSchema.safeParse({
    debit_surcharge_percent: percentageField(formData, "debit_surcharge_percent"),
    credit_surcharge_percent: percentageField(formData, "credit_surcharge_percent"),
  });
  if (!parsed.success) {
    return { error: "Ingresá porcentajes entre 0% y 100%, con hasta dos decimales." };
  }

  const { organization, supabase } = await requireActionContext(["owner", "admin"]);
  const { data, error } = await supabase
    .from("payment_methods")
    .update({
      debit_surcharge_percent: parsed.data.debit_surcharge_percent,
      credit_surcharge_percent: parsed.data.credit_surcharge_percent,
    })
    .eq("organization_id", organization.id)
    .eq("code", "card")
    .select("id")
    .maybeSingle();

  if (error) return { error: friendlyDatabaseError(error) };
  if (!data) return { error: "No se encontró el medio de pago Tarjeta." };

  revalidatePath("/app/configuracion");
  revalidatePath("/app/ventas");
  return { message: "Recargos de tarjeta actualizados." };
}
