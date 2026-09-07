import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type CurrentOrganization = {
  id: string;
  name: string;
  slug: string;
  role: Database["public"]["Enums"]["app_role"];
};

export async function getCurrentOrganization(
  supabase: SupabaseClient<Database>,
): Promise<CurrentOrganization | null> {
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", claims.sub)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("id", membership.organization_id)
    .maybeSingle();

  if (!organization) return null;

  return { ...organization, role: membership.role };
}
