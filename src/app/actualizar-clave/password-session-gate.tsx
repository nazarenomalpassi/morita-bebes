"use client";

import { LoaderCircle, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { UpdatePasswordForm } from "@/app/actualizar-clave/update-password-form";
import { authHashError, authHashOtp, authHashSession } from "@/lib/auth/invite-session";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type GateState = "checking" | "ready" | "error";

export function PasswordSessionGate({ next = "/app", resetHref = "/recuperar" }: { next?: string; resetHref?: string }) {
  const started = useRef(false);
  const [state, setState] = useState<GateState>("checking");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function prepareSession() {
      try {
        const hash = window.location.hash;
        const providerError = authHashError(hash);
        if (providerError) {
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
          setState("error");
          return;
        }

        const supabase = createBrowserSupabaseClient({ detectSessionInUrl: false });
        const otp = authHashOtp(hash);
        const session = authHashSession(hash);

        if (otp) {
          const result = await supabase.auth.verifyOtp({
            token_hash: otp.tokenHash,
            type: otp.type,
          });
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
          if (result.error) {
            setState("error");
            return;
          }
        } else if (session) {
          const result = await supabase.auth.setSession({
            access_token: session.accessToken,
            refresh_token: session.refreshToken,
          });
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
          if (result.error) {
            setState("error");
            return;
          }
        }

        const current = await supabase.auth.getSession();
        setState(current.data.session ? "ready" : "error");
      } catch {
        setState("error");
      }
    }

    void prepareSession();
  }, []);

  if (state === "checking") {
    return <p className="form-success flex items-center gap-2" role="status"><LoaderCircle className="animate-spin" size={17} /> Validando el enlace seguro...</p>;
  }

  if (state === "error") {
    return (
      <div className="space-y-4">
        <p className="form-error">Este enlace no se puede utilizar. Solicitá uno nuevo para crear tu contraseña.</p>
        <Link className="button button-secondary w-full" href={resetHref}><RefreshCcw size={17} /> Solicitar un enlace nuevo</Link>
      </div>
    );
  }

  return <UpdatePasswordForm next={next} />;
}
