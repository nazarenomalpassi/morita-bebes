import { Heart, LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";

import { LoginForm } from "./login-form";

import { PwaInstallButton } from "@/components/pwa/pwa-provider";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (claims) redirect("/app");

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Heart size={22} strokeWidth={2.25} />
          </span>
          <span>morita bebes</span>
        </div>

        <div className="mt-10 flex items-center gap-3 text-[var(--ink-muted)]">
          <LockKeyhole size={20} />
          <span className="text-sm font-semibold">Gestión interna</span>
        </div>

        <h1 className="mt-4 text-3xl font-semibold text-[var(--ink)]">
          Acceso al sistema
        </h1>
        <p className="mt-2 mb-8 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
          Operaciones, stock y ventas en un solo espacio de trabajo.
        </p>

        <LoginForm initialError={params.error === "confirmacion" ? "El enlace de acceso no es válido o venció." : params.error === "acceso" ? "Tu acceso no está habilitado." : undefined} />
        <div className="login-install-action"><PwaInstallButton /></div>
      </section>

      <aside className="login-aside" aria-hidden="true">
        <div className="login-pattern">
          <span className="login-orbit login-orbit-one" />
          <span className="login-orbit login-orbit-two" />
          <span className="login-orbit login-orbit-three" />
        </div>
        <p>Productos que miman. Gestión que acompaña.</p>
      </aside>
    </main>
  );
}
