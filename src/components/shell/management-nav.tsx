"use client";

import {
  BadgeDollarSign,
  BarChart3,
  Boxes,
  ContactRound,
  ImagePlus,
  LayoutDashboard,
  Landmark,
  Route,
  PackageSearch,
  ShieldCheck,
  ScrollText,
  Settings,
  Store,
  ShoppingBag,
  Tags,
  Truck,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  restricted?: boolean;
  staffOnly?: boolean;
};

const groups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "Operación",
    items: [
      { href: "/app", label: "Resumen", icon: LayoutDashboard, exact: true },
      { href: "/app/ventas", label: "Ventas", icon: ShoppingBag },
      { href: "/app/productos", label: "Productos y stock", icon: PackageSearch },
      { href: "/app/compras", label: "Compras", icon: Boxes },
      { href: "/app/proveedores", label: "Proveedores", icon: Truck },
    ],
  },
  {
    label: "Administración",
    items: [
      { href: "/app/clientes", label: "Clientes", icon: ContactRound },
      { href: "/app/gastos", label: "Gastos", icon: WalletCards },
      { href: "/app/caja", label: "Cierres y caja", icon: Landmark },
      { href: "/app/comisionistas", label: "Comisionistas", icon: Route },
      { href: "/app/personal", label: "Personal", icon: UsersRound, restricted: true },
      { href: "/app/mi-sueldo", label: "Mi sueldo", icon: BadgeDollarSign, staffOnly: true },
      { href: "/app/reportes", label: "Reportes", icon: BarChart3, restricted: true },
    ],
  },
  {
    label: "Tienda online",
    items: [
      { href: "/app/pedidos-web", label: "Pedidos web", icon: ShoppingBag, restricted: true },
      { href: "/app/mayoristas", label: "Cuentas mayoristas", icon: UsersRound, restricted: true },
      { href: "/app/tienda", label: "Configurar tienda", icon: Store, exact: true, restricted: true },
      { href: "/app/tienda/productos", label: "Fotos de productos", icon: ImagePlus, restricted: true },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/app/categorias", label: "Categorías y marcas", icon: Tags },
      { href: "/app/usuarios", label: "Usuarios", icon: ShieldCheck, restricted: true },
      { href: "/app/auditoria", label: "Auditoría", icon: ScrollText, restricted: true },
      { href: "/app/configuracion", label: "Configuración", icon: Settings, restricted: true },
    ],
  },
];

export function getManagementSectionLabel(pathname: string) {
  const items = groups.flatMap((group) => group.items);
  const match = items
    .filter((item) => item.exact ? pathname === item.href : pathname.startsWith(item.href))
    .sort((left, right) => right.href.length - left.href.length)[0];
  return match?.label ?? "Gestión interna";
}

export function ManagementNav({
  onNavigate,
  role,
}: {
  onNavigate?: () => void;
  role?: "owner" | "admin" | "staff";
}) {
  const pathname = usePathname();
  return (
    <nav className="management-nav" aria-label="Gestión principal">
      {groups.map((group) => (
        <div className="management-nav-group" key={group.label}>
          <span className="management-nav-label">{group.label}</span>
          {group.items.filter((item) => (!item.restricted || role !== "staff") && (!item.staffOnly || role === "staff")).map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`management-nav-link ${active ? "management-nav-link-active" : ""}`}
                href={href}
                key={href}
                onClick={onNavigate}
              >
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
