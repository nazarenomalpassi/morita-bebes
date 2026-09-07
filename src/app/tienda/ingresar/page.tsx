import type { Metadata } from "next";
import Link from "next/link";

import { StoreLoginForm } from "@/components/store/store-auth-form";

export const metadata: Metadata = { title: "Ingresar", robots: { index: false, follow: false } };

export default async function StoreLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; clave?: string }> }) {
  const query = await searchParams;
  return <div className="store-auth-page"><div className="store-auth-aside"><span>Tu cuenta Morita</span><h1>Tu carrito y tus pedidos, siempre a mano</h1><p>Ingresá para generar pedidos con el stock actualizado y continuar la atención por WhatsApp.</p><Link href="/tienda">Volver a la tienda</Link></div><section className="store-auth-panel"><span>Bienvenida/o</span><h2>Ingresar a mi cuenta</h2><p>Usá el correo con el que te registraste.</p>{query.error ? <p className="store-form-error">El enlace no pudo validarse. Solicitá uno nuevo o ingresá con tu contraseña.</p> : null}{query.clave === "actualizada" ? <p className="store-form-success">La contraseña se actualizó. Ya podés ingresar.</p> : null}<StoreLoginForm next={query.next} /></section></div>;
}
