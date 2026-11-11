import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { DirectPurchaseEntry } from "@/components/purchases/direct-purchase-entry";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { getPurchaseCatalog } from "@/lib/purchases/catalog";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DirectPurchasePage() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;
  const [{ products }, categories, brands] = await Promise.all([
    getPurchaseCatalog(supabase, organization.id, false),
    supabase.from("categories").select("id, name").eq("organization_id", organization.id).eq("is_active", true).order("name"),
    supabase.from("brands").select("id, name").eq("organization_id", organization.id).eq("is_active", true).order("name"),
  ]);
  if (categories.error || brands.error) throw new Error("No se pudo cargar la clasificación de productos.");
  return <div className="page-container page-container-wide direct-purchase-page">
    <Link className="direct-purchase-back" href="/app/compras"><ArrowLeft size={16} /> Volver a compras</Link>
    <header className="page-header">
      <div><span className="eyebrow">Productos y stock</span><h1 className="page-title mt-2">Ingresar mercadería</h1></div>
    </header>
    <DirectPurchaseEntry brands={brands.data ?? []} categories={categories.data ?? []} products={products} />
  </div>;
}
