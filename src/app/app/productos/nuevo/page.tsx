import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProductForm } from "@/components/inventory/product-form";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { createProductAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/app");
  const [categories, brands, suppliers] = await Promise.all([
    supabase.from("categories").select("id, name, is_active").eq("organization_id", organization.id).eq("is_active", true).order("name"),
    supabase.from("brands").select("id, name, is_active").eq("organization_id", organization.id).eq("is_active", true).order("name"),
    supabase.from("suppliers").select("id, business_name, is_active").eq("organization_id", organization.id).eq("is_active", true).order("business_name"),
  ]);
  if (categories.error || brands.error || suppliers.error) {
    throw new Error("No se pudieron cargar las opciones del producto.");
  }

  return (
    <div className="page-container">
      <Link className="inline-flex items-center gap-2 text-sm font-bold text-[var(--plum)] no-underline hover:underline" href="/app/productos">
        <ArrowLeft size={17} /> Volver a productos
      </Link>
      <header className="mt-6">
        <span className="eyebrow">Catálogo</span>
        <h1 className="page-title mt-2">Nuevo producto</h1>
        <p className="page-lead">Cargá lo que ya conozcas. Categoría, marca y proveedor pueden completarse más adelante.</p>
      </header>
      <ProductForm
        action={createProductAction}
        brands={brands.data ?? []}
        categories={categories.data ?? []}
        suppliers={suppliers.data ?? []}
      />
    </div>
  );
}
