import type { Metadata } from "next";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  ClipboardCheck,
  Headphones,
  PackageOpen,
  ShieldCheck,
  Store,
  Truck,
} from "lucide-react";
import Link from "next/link";

import { StoreRevealSection } from "@/components/store/store-reveal-section";
import { ars } from "@/lib/format";
import { getStoreContext } from "@/lib/store/queries";

export const metadata: Metadata = {
  title: "Compras mayoristas",
  description: "Solicitá tu cuenta mayorista de Morita Bebés y accedé a precios especiales para tu comercio.",
};

export default async function WholesalePage() {
  const { profile, settings } = await getStoreContext();
  const approved = profile?.wholesale_status === "approved";
  const href = approved ? "/tienda/productos" : profile ? "/tienda/cuenta" : "/tienda/registro";
  const cta = approved ? "Ver catálogo mayorista" : profile ? "Ver estado de mi cuenta" : "Solicitar cuenta mayorista";
  const minimum = ars.format(Number(settings.minimum_wholesale_amount || 500_000));

  return (
    <div className="store-wholesale-page">
      <section className="store-wholesale-hero">
        <div className="store-wholesale-hero-copy">
          <span>Morita para comercios</span>
          <h1>Abastecé tu negocio con una selección confiable</h1>
          <p>Precios mayoristas sobre el catálogo real de Morita Bebés, stock actualizado y atención personal para acompañar cada pedido.</p>
          <div className="store-wholesale-hero-actions">
            <Link className="store-primary-button" href={href}>{cta}<ArrowRight aria-hidden="true" /></Link>
            <span><ShieldCheck aria-hidden="true" /> Acceso sujeto a validación</span>
          </div>
          <dl className="store-wholesale-metrics">
            <div><dt>Compra mínima</dt><dd>{minimum}</dd></div>
            <div><dt>Catálogo</dt><dd>Stock sincronizado</dd></div>
          </dl>
        </div>
      </section>

      <StoreRevealSection className="store-wholesale-benefits" ariaLabel="Beneficios de la compra mayorista">
        <article><Boxes aria-hidden="true" /><div><strong>Precios especiales</strong><p>Accedé a los valores mayoristas habilitados para tu cuenta.</p></div></article>
        <article><Truck aria-hidden="true" /><div><strong>Pedido coordinado</strong><p>Definimos entrega, disponibilidad final y pago por WhatsApp.</p></div></article>
        <article><Headphones aria-hidden="true" /><div><strong>Atención personal</strong><p>Te acompañamos para que compres con información clara.</p></div></article>
      </StoreRevealSection>

      <StoreRevealSection className="store-wholesale-steps">
        <header><span>Cómo funciona</span><h2>De tu registro al pedido, sin vueltas</h2><p>La cuenta mayorista conserva tu historial y muestra solamente los precios que te corresponden.</p></header>
        <div>
          <article><span>01</span><Store aria-hidden="true" /><strong>Creá tu cuenta</strong><p>Completá tus datos y la información básica de tu comercio.</p></article>
          <article><span>02</span><ClipboardCheck aria-hidden="true" /><strong>Validamos la solicitud</strong><p>Morita revisa el acceso antes de habilitar los precios especiales.</p></article>
          <article><span>03</span><PackageOpen aria-hidden="true" /><strong>Armá tu pedido</strong><p>Elegí productos según sus mínimos y el stock disponible.</p></article>
          <article><span>04</span><BadgeCheck aria-hidden="true" /><strong>Confirmamos por WhatsApp</strong><p>El pedido queda registrado y coordinamos los próximos pasos.</p></article>
        </div>
      </StoreRevealSection>

      <StoreRevealSection className="store-wholesale-cta">
        <div><span>Empezá hoy</span><h2>Un canal mayorista simple, ordenado y acompañado</h2></div>
        <Link className="store-primary-button" href={href}>{cta}<ArrowRight aria-hidden="true" /></Link>
      </StoreRevealSection>
    </div>
  );
}
