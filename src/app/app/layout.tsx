import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SensitiveBalancesProvider } from "@/components/finance/sensitive-balances";
import { ManagementDraftProvider } from "@/components/forms/management-draft-provider";
import { ManagementLoadingScreen } from "@/components/shell/management-loading";
import { ManagementShell } from "@/components/shell/management-shell";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import "@/components/forms/management-workflows.css";

export default function ManagementLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense fallback={<main><ManagementLoadingScreen fullScreen /></main>}>
      <AuthenticatedManagementLayout>{children}</AuthenticatedManagementLayout>
    </Suspense>
  );
}

async function AuthenticatedManagementLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) redirect("/login");

  const organization = await getCurrentOrganization(supabase);
  const userLabel = typeof claims.email === "string" ? claims.email : "Usuario del sistema";

  return (
    <ManagementDraftProvider scope={`${organization?.id ?? "none"}:${claims.sub}`}><SensitiveBalancesProvider>
      <ManagementShell
        organizationName={organization?.name ?? "Sin configurar"}
        role={organization?.role}
        userLabel={userLabel}
        renderVersion={crypto.randomUUID()}
      >
        {children}
      </ManagementShell>
    </SensitiveBalancesProvider></ManagementDraftProvider>
  );
}
