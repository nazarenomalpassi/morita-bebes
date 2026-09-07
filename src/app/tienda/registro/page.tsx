import type { Metadata } from "next";
import Link from "next/link";

import { StoreRegisterForm } from "@/components/store/store-auth-form";

export const metadata: Metadata = { title: "Crear cuenta", robots: { index: false, follow: true } };

export default function StoreRegisterPage() {
  return <div className="store-register-page store-page"><header className="store-page-heading"><span>Sumate a Morita</span><h1>Creá tu cuenta</h1><p>Elegí si comprás para tu familia o para tu comercio. Ya tenés cuenta: <Link href="/tienda/ingresar">ingresá acá</Link>.</p></header><StoreRegisterForm /></div>;
}
