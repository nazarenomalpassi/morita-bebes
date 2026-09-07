import { Heart, KeyRound } from "lucide-react";

import { PasswordSessionGate } from "@/app/actualizar-clave/password-session-gate";

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  const storeFlow = query.next === "/tienda/ingresar";
  return (
    <main className="login-page login-page-single">
      <section className="login-panel">
        <div className="brand-lockup"><span className="brand-mark"><Heart size={22} /></span><span>morita bebes</span></div>
        <div className="mt-10 flex items-center gap-3 text-[var(--ink-muted)]"><KeyRound size={20} /><span className="text-sm font-semibold">Seguridad</span></div>
        <h1 className="mt-4 text-3xl font-semibold">Nueva contraseña</h1>
        <p className="mt-2 mb-8 text-sm leading-6 text-[var(--ink-muted)]">Elegí una clave de al menos ocho caracteres.</p>
        <PasswordSessionGate next={storeFlow ? "/tienda/ingresar?clave=actualizada" : "/app"} resetHref={storeFlow ? "/tienda/recuperar" : "/recuperar"} />
      </section>
    </main>
  );
}
