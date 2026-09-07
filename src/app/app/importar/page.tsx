import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InventoryImporter } from "@/components/import/inventory-importer";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ImportInventoryPage() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/app");

  const canCommit = organization.role === "owner" || organization.role === "admin";
  return (
    <div className="page-container page-container-wide">
      <Link
        className="inline-flex items-center gap-2 text-sm font-bold text-[var(--plum)] no-underline hover:underline"
        href="/app/productos"
      >
        <ArrowLeft size={17} /> Volver a productos
      </Link>
      <header className="page-header mt-6">
        <div>
          <span className="eyebrow">Catálogo e inventario</span>
          <h1 className="page-title mt-2">Importar inventario legado</h1>
          <p className="page-lead">
            Análisis controlado y alta de productos para {organization.name}.
          </p>
        </div>
        <span className="operation-icon operation-icon-lavender shrink-0">
          <FileSpreadsheet size={20} />
        </span>
      </header>
      <InventoryImporter canCommit={canCommit} />
    </div>
  );
}
