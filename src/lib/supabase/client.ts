import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

import { getSupabaseEnv } from "./env";

export function createBrowserSupabaseClient({
  detectSessionInUrl = true,
}: {
  detectSessionInUrl?: boolean;
} = {}) {
  const { supabaseUrl, supabasePublishableKey } = getSupabaseEnv();

  return createBrowserClient<Database>(supabaseUrl, supabasePublishableKey, {
    auth: { detectSessionInUrl },
  });
}
