import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { DirectPurchaseEntry } from "@/components/purchases/direct-purchase-entry";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { dateInputValueInArgentina } from "@/lib/date";
import { getPurchaseCatalog } from "@/lib/purchases/catalog";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DirectPurchasePage() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  const catalog = await getPurchaseCatalog(supabase, organization.id);
  return <div className="page-container page-container-wide direct-purchase-page">
    <Link className="direct-purchase-back" href="/app/compras"><ArrowLeft size={16} /> Volver a compras</Link>
    <header className="page-header">
      <div><span className="eyebrow">Mercadería recibida</span><h1 className="page-title mt-2">Cargar orden</h1></div>
    </header>
    <DirectPurchaseEntry {...catalog} today={dateInputValueInArgentina()} />
  </div>;
}
