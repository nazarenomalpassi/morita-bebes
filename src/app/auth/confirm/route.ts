import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));
  const supabase = await createServerSupabaseClient();

  let error: Error | null = null;
  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    error = result.error;
  } else if (tokenHash && type) {
    const result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    error = result.error;
  } else {
    error = new Error("Missing confirmation parameters");
  }

  if (error) {
    return NextResponse.redirect(new URL(next.startsWith("/tienda") ? "/tienda/ingresar?error=confirmacion" : "/login?error=confirmacion", url.origin));
  }
  if (next.startsWith("/tienda")) {
    return NextResponse.redirect(new URL(next, url.origin));
  }
  const loginAudit = await supabase.rpc("record_login");
  if (loginAudit.error || loginAudit.data < 1) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=acceso", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
