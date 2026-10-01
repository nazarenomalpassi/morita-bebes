"use client";

import { Heart, LogOut, Menu, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { signOutAction } from "@/app/auth/actions";
import { SensitiveBalancesToggle } from "@/components/finance/sensitive-balances";
import { PwaInstallButton } from "@/components/pwa/pwa-provider";
import { getManagementSectionLabel, ManagementNav } from "@/components/shell/management-nav";
import { useMediaQuery } from "@/lib/ui/use-media-query";
import { useModalFocus } from "@/lib/ui/use-modal-focus";

type Role = "owner" | "admin" | "staff";

export function ManagementShell({
  children,
  organizationName,
  role,
  userLabel,
  renderVersion,
}: {
  children: React.ReactNode;
  organizationName: string;
  role?: Role;
  userLabel: string;
  renderVersion: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const isMobile = useMediaQuery("(max-width: 900px)");
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  useModalFocus(open && isMobile, drawerRef, closeMenu, menuRef);

  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  useEffect(() => {
    document.documentElement.classList.toggle("mobile-nav-open", open && isMobile);
    return () => {
      document.documentElement.classList.remove("mobile-nav-open");
    };
  }, [open, isMobile]);
  useEffect(() => {
    const show = () => setRefreshNeeded(true);
    window.addEventListener("morita-refresh-needed", show);
    return () => window.removeEventListener("morita-refresh-needed", show);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setRefreshNeeded(false), 0);
    return () => window.clearTimeout(timer);
  }, [renderVersion, pathname]);

  const roleLabel = role === "staff" ? "Empleado" : role === "owner" ? "Dueño" : "Administrador";

  return (
    <div className="management-shell">
      <header className="mobile-app-bar">
        <button aria-controls="management-drawer" aria-expanded={open} aria-label="Abrir menú" className="icon-button mobile-menu-button" onClick={() => setOpen(true)} ref={menuRef} type="button"><Menu size={21} /></button>
        <div className="mobile-app-title"><small>Morita Bebés</small><strong>{getManagementSectionLabel(pathname)}</strong></div>
        <SensitiveBalancesToggle compact />
      </header>

      <button aria-label="Cerrar menú" className={`mobile-nav-overlay ${open ? "is-open" : ""}`} onClick={() => setOpen(false)} type="button" />
      <aside aria-label="Menú de gestión" aria-modal={open && isMobile ? true : undefined} className={`management-sidebar ${open ? "is-open" : ""}`} id="management-drawer" inert={isMobile && !open} ref={drawerRef} role={open && isMobile ? "dialog" : undefined} tabIndex={-1}>
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

      <main className="management-main" data-render-version={renderVersion} inert={open && isMobile}>
        {refreshNeeded ? <div className="form-message" role="status">
          <p>Los cambios se guardaron. La vista necesita actualizarse.</p>
          <button className="button button-secondary" onClick={() => {
            if (window.confirm("Actualizar la vista? Los cambios nuevos sin guardar se perderan.")) window.location.reload();
          }} type="button"><RefreshCw size={16} aria-hidden="true" /> Actualizar vista</button>
        </div> : null}
        {children}
      </main>
    </div>
  );
}
