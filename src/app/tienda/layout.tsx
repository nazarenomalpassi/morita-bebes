import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";

import { StoreCartProvider } from "@/components/store/cart-provider";
import { StoreFooter } from "@/components/store/store-footer";
import { StoreHeader } from "@/components/store/store-header";
import { buildWhatsAppHref } from "@/lib/store/contact";
import { getStoreContext } from "@/lib/store/queries";

import "./store.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://morita-bebes.vercel.app"),
  title: { default: "Morita Bebés | Tienda online", template: "%s | Morita Bebés" },
  description: "Tienda online de pañales, higiene, alimentación y productos para bebés. Compras minoristas y mayoristas en Morita Bebés.",
  manifest: "/tienda/manifest.webmanifest",
  alternates: { canonical: "/tienda" },
  openGraph: {
    title: "Morita Bebés",
    description: "Productos que miman. Tienda online minorista y mayorista.",
    images: [{ url: "/store/hero-morita.webp", width: 1536, height: 1024, alt: "Morita Bebés" }],
    locale: "es_AR",
    type: "website",
  },
};

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const context = await getStoreContext();
  const name = context.profile
    ? `${context.profile.first_name} ${context.profile.last_name}`
    : context.managementName;
  const whatsappHref = buildWhatsAppHref(context.settings.whatsapp, context.settings.whatsapp_prefill);
  return (
    <StoreCartProvider>
      <div className="store-shell">
        <StoreHeader customerName={name} managementRole={context.managementRole} />
        <main>{children}</main>
        {whatsappHref ? <a aria-label="Consultar por WhatsApp" className="store-whatsapp-floating" href={whatsappHref} rel="noreferrer" target="_blank"><MessageCircle aria-hidden="true" /></a> : null}
        <StoreFooter address={context.settings.address} instagram={context.settings.instagram_url} whatsapp={context.settings.whatsapp} />
      </div>
    </StoreCartProvider>
  );
}
