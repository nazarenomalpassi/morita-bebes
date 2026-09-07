"use client";

import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useStoreCart } from "@/components/store/cart-provider";
import type { StoreProduct } from "@/lib/store/types";

export function ProductDetailActions({ product }: { product: StoreProduct }) {
  const minimum = Math.max(1, Number(product.minimum_quantity ?? 1));
  const stock = Number(product.current_stock);
  const [quantity, setQuantity] = useState(minimum);
  const [feedback, setFeedback] = useState("");
  const { addProduct } = useStoreCart();
  const available = stock > 0 && product.display_price !== null && (product.price_kind !== "wholesale" || product.wholesale_available);

  function add() {
    const result = addProduct(product, quantity);
    setFeedback(result.ok ? "Producto agregado al carrito." : result.message ?? "No disponible.");
  }

  return (
    <div className="store-product-actions">
      {available ? <div className="store-quantity-control"><button aria-label="Restar una unidad" disabled={quantity <= minimum} onClick={() => setQuantity((value) => Math.max(minimum, value - 1))} type="button"><Minus /></button><input aria-label="Cantidad" inputMode="numeric" max={stock} min={minimum} onChange={(event) => setQuantity(Math.min(stock, Math.max(minimum, Number(event.target.value) || minimum)))} type="number" value={quantity} /><button aria-label="Sumar una unidad" disabled={quantity >= stock} onClick={() => setQuantity((value) => Math.min(stock, value + 1))} type="button"><Plus /></button></div> : null}
      <button className="store-primary-button store-add-detail" disabled={!available} onClick={add} type="button"><ShoppingBag aria-hidden="true" />{available ? "Agregar al carrito" : stock <= 0 ? "Sin stock" : "Consultar"}</button>
      {feedback ? <p aria-live="polite" className="store-action-feedback"><Check aria-hidden="true" size={17} /> {feedback} {feedback.includes("agregado") ? <Link href="/tienda/carrito">Ver carrito</Link> : null}</p> : null}
    </div>
  );
}
