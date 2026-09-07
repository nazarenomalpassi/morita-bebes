import { AtSign, MapPin, MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { buildWhatsAppHref, getInstagramContact } from "@/lib/store/contact";

export function StoreFooter({
  address,
  instagram,
  whatsapp,
}: {
  address?: string | null;
  instagram?: string | null;
  whatsapp?: string | null;
}) {
  const whatsappHref = buildWhatsAppHref(whatsapp);
  const instagramContact = getInstagramContact(instagram);
  const storeAddress = address?.trim()
    ? `${address.trim()} · Río Tercero, Córdoba`
    : "Río Tercero, Córdoba";

  return (
    <footer className="store-footer">
      <div className="store-footer-inner">
        <div className="store-footer-brand">
          <Image alt="" height={58} src="/brand/morita-logo.svg" width={58} />
          <div><strong>morita bebés</strong><p>Productos que acompañan, atención cercana y todo el cuidado que sus primeros momentos merecen.</p></div>
        </div>
        <div><h2>Explorá</h2><Link href="/tienda/productos">Todos los productos</Link><Link href="/tienda/mayoristas">Compras mayoristas</Link><Link href="/tienda/cuenta">Mi cuenta</Link></div>
        <div><h2>Información</h2><span>Compra minorista desde $20.000</span><span>Compra mayorista desde $500.000</span><span>Stock actualizado en tiempo real</span></div>
        <div>
          <h2>Contacto</h2>
          {whatsappHref ? <a aria-label={`Escribir a Morita Bebés por WhatsApp al ${whatsapp}`} href={whatsappHref} rel="noreferrer" target="_blank"><MessageCircle aria-hidden="true" size={17} /> WhatsApp · {whatsapp}</a> : <span><MessageCircle aria-hidden="true" size={17} /> WhatsApp</span>}
          {instagramContact ? <a aria-label={`Abrir Instagram de Morita Bebés, ${instagramContact.label}`} href={instagramContact.href} rel="noreferrer" target="_blank"><AtSign aria-hidden="true" size={17} /> Instagram · {instagramContact.label}</a> : null}
          <span><MapPin aria-hidden="true" size={17} /> {storeAddress}</span>
        </div>
      </div>
      <div className="store-footer-legal">© {new Date().getFullYear()} Morita Bebés · Tienda online</div>
    </footer>
  );
}
