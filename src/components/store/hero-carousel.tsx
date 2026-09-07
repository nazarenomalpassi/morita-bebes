"use client";

import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { resolveStoreImage } from "@/lib/store/images";
import type { StoreBanner } from "@/lib/store/types";

export function HeroCarousel({ banners, fallbackSubtitle, fallbackTitle }: { banners: StoreBanner[]; fallbackSubtitle?: string | null; fallbackTitle?: string | null }) {
  const [active, setActive] = useState(0);
  const slides = banners.length ? banners : [{ id: "fallback", title: fallbackTitle || "Todo para acompañar sus primeros momentos", subtitle: fallbackSubtitle || "Productos elegidos con cuidado para bebés, mamás y familias.", image_path: "/store/hero-morita.webp", cta_href: "/tienda/productos", cta_label: "Ver productos" } as StoreBanner];

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % slides.length), 6500);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const slide = slides[active];
  const image = resolveStoreImage(slide.image_path) ?? "/store/hero-morita.webp";
  const move = (direction: number) => setActive((value) => (value + direction + slides.length) % slides.length);

  return (
    <section aria-roledescription="carrusel" className="store-hero">
      <Image alt="Selección de productos Morita Bebés" fill priority sizes="100vw" src={image} />
      <div className="store-hero-shade" />
      <div className="store-hero-copy" key={slide.id}>
        <span>Morita Bebés</span>
        <h1>{slide.title}</h1>
        {slide.subtitle ? <p>{slide.subtitle}</p> : null}
        {slide.cta_href && slide.cta_label ? <Link className="store-primary-button" href={slide.cta_href}>{slide.cta_label}<ArrowRight aria-hidden="true" size={18} /></Link> : null}
      </div>
      {slides.length > 1 ? <>
        <div className="store-hero-arrows"><button aria-label="Banner anterior" onClick={() => move(-1)} type="button"><ChevronLeft /></button><button aria-label="Banner siguiente" onClick={() => move(1)} type="button"><ChevronRight /></button></div>
        <div className="store-hero-dots">{slides.map((item, index) => <button aria-label={`Ir al banner ${index + 1}`} aria-current={index === active} key={item.id} onClick={() => setActive(index)} type="button" />)}</div>
      </> : null}
    </section>
  );
}
