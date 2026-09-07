"use client";

import { Check, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { useStoreCart } from "@/components/store/cart-provider";
import { ProductMedia } from "@/components/store/product-media";
import { ars } from "@/lib/format";
import type { StoreProduct } from "@/lib/store/types";

export function ProductCard({ index = 0, product }: { index?: number; product: StoreProduct }) {
  const { addProduct } = useStoreCart();
  const [feedback, setFeedback] = useState("");
  const cardRef = useRef<HTMLElement>(null);
  const stock = Number(product.current_stock);
  const available = stock > 0 && product.display_price !== null && (product.price_kind !== "wholesale" || product.wholesale_available);

  function add() {
    const result = addProduct(product);
    setFeedback(result.ok ? "Agregado" : result.message ?? "No disponible");
    window.setTimeout(() => setFeedback(""), 2200);
  }

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (!window.IntersectionObserver) {
      card.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      card.classList.add("is-visible");
      observer.disconnect();
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return (
    <article
      className="store-product-card store-scroll-reveal"
      ref={cardRef}
      style={{ "--store-reveal-delay": `${Math.min(index % 4, 3) * 55}ms` } as CSSProperties}
    >
      <Link className="store-product-media" href={`/tienda/productos/${product.slug}`} aria-label={`Ver ${product.name}`}>
        <ProductMedia alt={product.name} categorySlug={product.category_slug} imagePath={product.cover_image_path} />
        {product.is_new ? <span className="store-product-badge">Nuevo</span> : null}
        {stock <= 0 ? <span className="store-product-stock-badge">Sin stock</span> : null}
      </Link>
      <div className="store-product-card-body">
        <span className="store-product-meta">{product.brand_name ?? product.category_name ?? "Morita Bebés"}</span>
        <Link href={`/tienda/productos/${product.slug}`}><h3>{product.name}</h3></Link>
        <div className="store-product-price-row">
          <div>
            {product.display_price !== null ? <strong>{ars.format(Number(product.display_price))}</strong> : <strong>Consultar precio</strong>}
            {product.price_kind === "wholesale" ? <small>Precio mayorista</small> : null}
          </div>
          <button aria-label={`Agregar ${product.name} al carrito`} className="store-add-button" disabled={!available} onClick={add} title={available ? "Agregar al carrito" : "No disponible"} type="button">
            {feedback === "Agregado" ? <Check size={19} /> : available ? <Plus size={20} /> : <ShoppingBag size={18} />}
            <span>{feedback === "Agregado" ? "Agregado" : available ? "Agregar" : "Sin stock"}</span>
          </button>
        </div>
        <span aria-live="polite" className="store-card-feedback">{feedback}</span>
      </div>
    </article>
  );
}
