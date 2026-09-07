"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { reconcileCartItems } from "@/lib/store/cart";
import type { CartItem, CartSnapshot, StoreProduct } from "@/lib/store/types";

const STORAGE_KEY = "morita-store-cart-v1";

type CartContextValue = {
  addProduct: (product: StoreProduct, quantity?: number) => { ok: boolean; message?: string };
  clear: () => void;
  count: number;
  items: CartItem[];
  remove: (productId: string) => void;
  subtotal: number;
  syncProducts: (products: CartSnapshot[]) => void;
  updateQuantity: (productId: string, quantity: number) => { ok: boolean; message?: string };
};

const CartContext = createContext<CartContextValue | null>(null);

function cleanStoredItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CartItem => Boolean(
    item && typeof item === "object"
      && typeof item.productId === "string"
      && typeof item.name === "string"
      && typeof item.quantity === "number"
      && typeof item.stock === "number"
  )).map((item) => ({ ...item, available: item.available !== false }));
}

export function StoreCartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setItems(cleanStoredItems(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")));
      } catch {
        setItems([]);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [hydrated, items]);

  const addProduct = useCallback((product: StoreProduct, requested = Number(product.minimum_quantity ?? 1)) => {
    const stock = Number(product.current_stock);
    const minimum = Math.max(1, Number(product.minimum_quantity ?? 1));
    const quantity = Math.max(minimum, requested);
    if (stock <= 0) return { ok: false, message: "Este producto está sin stock." };
    if (product.price_kind === "wholesale" && !product.wholesale_available) {
      return { ok: false, message: "Este producto requiere consulta de precio mayorista." };
    }
    let result: { ok: boolean; message?: string } = { ok: true };
    setItems((current) => {
      const existing = current.find((item) => item.productId === product.id);
      const nextQuantity = (existing?.quantity ?? 0) + quantity;
      if (nextQuantity > stock) {
        result = { ok: false, message: `Solo quedan ${stock} unidades disponibles.` };
        return current;
      }
      const nextItem: CartItem = {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        imagePath: product.cover_image_path,
        price: product.display_price === null ? null : Number(product.display_price),
        priceKind: product.price_kind ?? "retail",
        quantity: nextQuantity,
        minimumQuantity: minimum,
        stock,
        unit: product.unit,
        available: true,
      };
      return existing
        ? current.map((item) => item.productId === product.id ? nextItem : item)
        : [...current, nextItem];
    });
    return result;
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    let result: { ok: boolean; message?: string } = { ok: true };
    setItems((current) => current.map((item) => {
      if (item.productId !== productId) return item;
      if (quantity > item.stock) {
        result = { ok: false, message: `Solo quedan ${item.stock} unidades disponibles.` };
        return item;
      }
      return { ...item, quantity: Math.max(item.minimumQuantity, quantity) };
    }));
    return result;
  }, []);

  const remove = useCallback((productId: string) => setItems((current) => current.filter((item) => item.productId !== productId)), []);
  const clear = useCallback(() => setItems([]), []);
  const syncProducts = useCallback((products: CartSnapshot[]) => {
    setItems((current) => reconcileCartItems(current, products));
  }, []);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0);
  const value = useMemo(() => ({ addProduct, clear, count, items, remove, subtotal, syncProducts, updateQuantity }), [addProduct, clear, count, items, remove, subtotal, syncProducts, updateQuantity]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useStoreCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useStoreCart must be used within StoreCartProvider");
  return context;
}
