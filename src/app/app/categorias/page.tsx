import { ArrowLeft, Search, Shapes, Tags } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandManager, CategoryManager } from "@/components/inventory/catalog-manager";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = first(params.q).slice(0, 80).replace(/[%_]/g, "").trim();
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/app");
  let categoryQuery = supabase
    .from("categories")
    .select("id, name, description, is_active")
    .eq("organization_id", organization.id);
  let brandQuery = supabase
    .from("brands")
    .select("id, name, is_active")
    .eq("organization_id", organization.id);
  if (q) {
    categoryQuery = categoryQuery.ilike("name", `%${q}%`);
    brandQuery = brandQuery.ilike("name", `%${q}%`);
  }
  const [categories, brands] = await Promise.all([
    categoryQuery.order("name"),
    brandQuery.order("name"),
  ]);
  if (categories.error || brands.error) throw new Error("No se pudo cargar la clasificación.");

  return (
    <div className="page-container">
      <Link className="inline-flex items-center gap-2 text-sm font-bold text-[var(--plum)] no-underline hover:underline" href="/app/productos"><ArrowLeft size={17} /> Volver a productos</Link>
      <header className="page-header mt-6">
        <div>
          <span className="eyebrow">Catálogo</span>
          <h1 className="page-title mt-2">Categorías y marcas</h1>
          <p className="page-lead">Ordená el catálogo sin borrar el historial. Los registros que ya no se usan pueden desactivarse.</p>
        </div>
        <form className="input-shell input-shell-start w-full max-w-xs" method="get">
          <Search aria-hidden="true" size={17} />
          <input aria-label="Buscar categorías y marcas" className="field-input" defaultValue={q} maxLength={80} name="q" placeholder="Buscar" />
        </form>
      </header>

      <div className="mt-9 grid gap-10 xl:grid-cols-2">
        <section aria-labelledby="categories-heading">
          <div className="mb-5 flex items-start gap-3">
            <span className="operation-icon operation-icon-lavender shrink-0"><Shapes size={19} /></span>
            <div><h2 className="text-lg font-bold" id="categories-heading">Categorías</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">{categories.data?.length ?? 0} registros</p></div>
          </div>
          <CategoryManager categories={categories.data ?? []} />
        </section>
        <section aria-labelledby="brands-heading">
          <div className="mb-5 flex items-start gap-3">
            <span className="operation-icon operation-icon-mint shrink-0"><Tags size={19} /></span>
            <div><h2 className="text-lg font-bold" id="brands-heading">Marcas</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">{brands.data?.length ?? 0} registros</p></div>
          </div>
          <BrandManager brands={brands.data ?? []} />
        </section>
      </div>
    </div>
  );
}
