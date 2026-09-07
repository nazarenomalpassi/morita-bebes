import { ArrowLeft, Heart, KeyRound } from "lucide-react";
import Link from "next/link";

import { PasswordResetForm } from "@/app/recuperar/password-reset-form";

export default function PasswordResetPage() {
  return (
    <main className="login-page login-page-single">
      <section className="login-panel">
        <div className="brand-lockup"><span className="brand-mark"><Heart size={22} /></span><span>morita bebes</span></div>
        <div className="mt-10 flex items-center gap-3 text-[var(--ink-muted)]"><KeyRound size={20} /><span className="text-sm font-semibold">Recuperar acceso</span></div>
        <h1 className="mt-4 text-3xl font-semibold">Restablecer contraseña</h1>
        <p className="mt-2 mb-8 text-sm leading-6 text-[var(--ink-muted)]">Ingresá el correo de tu usuario.</p>
        <PasswordResetForm />
        <Link className="text-link mt-6" href="/login"><ArrowLeft size={15} /> Volver al ingreso</Link>
      </section>
    </main>
  );
}

