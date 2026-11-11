"use client";

import { ManagementDraftScope } from "@/lib/ui/use-management-draft";

export function ManagementDraftProvider({ scope, children }: { scope: string; children: React.ReactNode }) {
  return <ManagementDraftScope.Provider value={scope}>{children}</ManagementDraftScope.Provider>;
}
