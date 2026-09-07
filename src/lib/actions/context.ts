import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type AppRole = Database["public"]["Enums"]["app_role"];

export type ActionContext = {
  organization: NonNullable<
    Awaited<ReturnType<typeof getCurrentOrganization>>
  >;
  supabase: SupabaseClient<Database>;
  userId: string;
};

export async function requireActionContext(
  allowedRoles: AppRole[] = ["owner", "admin", "staff"],
): Promise<ActionContext> {
  const supabase = await createServerSupabaseClient();
  const [{ data }, organization] = await Promise.all([
    supabase.auth.getClaims(),
    getCurrentOrganization(supabase),
  ]);

  const userId = data?.claims?.sub;
  if (!userId || !organization) {
    throw new Error("No hay una sesión activa para realizar esta operación.");
  }

  if (!allowedRoles.includes(organization.role)) {
    throw new Error("Tu perfil no tiene permisos para realizar esta operación.");
  }

  return { organization, supabase, userId };
}

