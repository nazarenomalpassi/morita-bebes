import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { getSupabaseEnv } from "./env";

export function createAdminSupabaseClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Falta SUPABASE_SECRET_KEY para administrar invitaciones.");
  }

  const { supabaseUrl } = getSupabaseEnv();
  return createClient<Database>(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
