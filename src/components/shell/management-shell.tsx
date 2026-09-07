"use client";

import { Heart, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { signOutAction } from "@/app/auth/actions";
import { SensitiveBalancesToggle } from "@/components/finance/sensitive-balances";
import { PwaInstallButton } from "@/components/pwa/pwa-provider";
import { getManagementSectionLabel, ManagementNav } from "@/components/shell/management-nav";

type Role = "owner" | "admin" | "staff";

export function ManagementShell({
  children,
  organizationName,
  role,
  userLabel,
}: {
  children: React.ReactNode;
  organizationName: string;
  role?: Role;
  userLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  useEffect(() => {
    document.documentElement.classList.toggle("mobile-nav-open", open);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.documentElement.classList.remove("mobile-nav-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const roleLabel = role === "staff" ? "Empleado" : role === "owner" ? "Dueño" : "Administrador";

  return (
    <div className="management-shell">
      <header className="mobile-app-bar">
        <button aria-controls="management-drawer" aria-expanded={open} aria-label="Abrir menú" className="icon-button mobile-menu-button" onClick={() => setOpen(true)} type="button"><Menu size={21} /></button>
        <div className="mobile-app-title"><small>Morita Bebés</small><strong>{getManagementSectionLabel(pathname)}</strong></div>
        <SensitiveBalancesToggle compact />
      </header>

      <button aria-label="Cerrar menú" className={`mobile-nav-overlay ${open ? "is-open" : ""}`} onClick={() => setOpen(false)} type="button" />
      <aside className={`management-sidebar ${open ? "is-open" : ""}`} id="management-drawer">
        <div className="sidebar-brand-row">
          <Link className="brand-lockup" href="/app" onClick={() => setOpen(false)}>
            <span className="brand-mark" aria-hidden="true"><Heart size={20} strokeWidth={2.25} /></span>
            <span>morita bebes</span>
          </Link>
          <button aria-label="Cerrar menú" className="icon-button mobile-drawer-close" onClick={() => setOpen(false)} type="button"><X size={20} /></button>
        </div>

        <ManagementNav onNavigate={() => setOpen(false)} role={role} />

        <div className="sidebar-footer">
          <div className="sidebar-context">
            <strong title={userLabel}>{userLabel}</strong>
            <span className="sidebar-context-meta">
              <span className="sidebar-context-label">{organizationName}</span>
              <small>{roleLabel}</small>
            </span>
          </div>
          <div className="sidebar-tools">
            <PwaInstallButton compact />
            <SensitiveBalancesToggle compact />
            <form action={signOutAction}>
              <button aria-label="Salir" className="sign-out-button" title="Salir" type="submit"><LogOut size={17} /></button>
            </form>
          </div>
        </div>
      </aside>

      <main className="management-main">{children}</main>
    </div>
  );
}
