"use client";

import { Menu, Search, Settings2, ShoppingBag, UserRound, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useStoreCart } from "@/components/store/cart-provider";
import type { StoreManagementRole } from "@/lib/store/admin";

const navigation = [
  { href: "/tienda", label: "Inicio" },
  { href: "/tienda/productos", label: "Productos" },
  { href: "/tienda/mayoristas", label: "Mayoristas" },
];

export function StoreHeader({
  customerName,
  managementRole,
}: {
  customerName?: string | null;
  managementRole?: StoreManagementRole | null;
}) {
  const pathname = usePathname();
  const { count } = useStoreCart();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  return (
    <>
      <div className="store-announcement">Compra minorista desde $20.000 · Envíos coordinados por WhatsApp</div>
      <header className="store-header">
        <div className="store-header-inner">
          <button aria-expanded={open} aria-label={open ? "Cerrar menú" : "Abrir menú"} className="store-icon-button store-mobile-menu" onClick={() => setOpen((value) => !value)} type="button">
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
          <Link className="store-brand" href="/tienda">
            <Image alt="Morita Bebés" height={48} priority src="/brand/morita-logo.svg" width={48} />
            <span><strong>morita bebés</strong><small>Productos que miman</small></span>
          </Link>
          <nav aria-label="Navegación principal" className={`store-nav ${open ? "is-open" : ""}`}>
            {navigation.map((item) => <Link className={pathname === item.href ? "is-active" : ""} href={item.href} key={item.href}>{item.label}</Link>)}
          </nav>
          <div className="store-header-actions">
            <Link aria-label="Buscar productos" className="store-icon-button store-search-link" href="/tienda/productos"><Search aria-hidden="true" /></Link>
            {managementRole ? (
              <Link aria-label={`Administrar tienda${customerName ? `, ${customerName}` : ""}`} className="store-admin-button" href="/app/tienda" title="Administrar tienda">
                <Settings2 aria-hidden="true" />
                <span>Administrar</span>
              </Link>
            ) : (
              <Link aria-label={customerName ? `Mi cuenta, ${customerName}` : "Ingresar"} className="store-icon-button" href={customerName ? "/tienda/cuenta" : "/tienda/ingresar"}><UserRound aria-hidden="true" /></Link>
            )}
            <Link aria-label={`Carrito con ${count} ${count === 1 ? "producto" : "productos"}`} className="store-icon-button store-cart-link" href="/tienda/carrito">
              <ShoppingBag aria-hidden="true" />
              {count > 0 ? <span>{count > 99 ? "99+" : count}</span> : null}
            </Link>
          </div>
        </div>
      </header>
      {open ? <button aria-label="Cerrar menú" className="store-nav-overlay" onClick={() => setOpen(false)} type="button" /> : null}
    </>
  );
}
