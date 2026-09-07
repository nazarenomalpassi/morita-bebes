import { redirect } from "next/navigation";

import { SensitiveBalancesProvider } from "@/components/finance/sensitive-balances";
import { ManagementShell } from "@/components/shell/management-shell";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function ManagementLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) redirect("/login");

  const organization = await getCurrentOrganization(supabase);
  const userLabel = typeof claims.email === "string" ? claims.email : "Usuario del sistema";

  return (
    <SensitiveBalancesProvider>
      <ManagementShell
        organizationName={organization?.name ?? "Sin configurar"}
        role={organization?.role}
        userLabel={userLabel}
      >
        {children}
      </ManagementShell>
    </SensitiveBalancesProvider>
  );
}
