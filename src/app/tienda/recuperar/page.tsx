import type { Metadata } from "next";
import Link from "next/link";

import { StorePasswordResetForm } from "@/components/store/store-password-reset-form";

export const metadata: Metadata = { title: "Recuperar contraseña", robots: { index: false, follow: false } };

export default function StorePasswordResetPage() {
  return (
    <div className="store-auth-page">
      <div className="store-auth-aside"><span>Seguridad de tu cuenta</span><h1>Volvé a tus pedidos</h1><p>Te enviaremos un enlace seguro al correo con el que creaste tu cuenta.</p><Link href="/tienda">Volver a la tienda</Link></div>
      <section className="store-auth-panel"><span>Recuperar acceso</span><h2>Nueva contraseña</h2><p>Ingresá tu correo y revisá la bandeja de entrada y spam.</p><StorePasswordResetForm /><div className="store-auth-links"><Link href="/tienda/ingresar">Volver al ingreso</Link></div></section>
    </div>
  );
}
