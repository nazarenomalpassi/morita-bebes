import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ProductForm } from "@/components/inventory/product-form";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { updateProductAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: PageProps<"/app/productos/[id]/editar">) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/app");
  const [product, categories, brands, suppliers] = await Promise.all([
    supabase.from("products").select("name, sku, barcode, description, commercial_description, category_id, brand_id, default_supplier_id, cost_price, retail_price, wholesale_price, wholesale_min_quantity, current_stock, min_stock, target_stock, unit, image_path, is_published, is_featured, hide_when_out_of_stock, store_slug, seo_title, seo_description").eq("id", id).eq("organization_id", organization.id).maybeSingle(),
    supabase.from("categories").select("id, name, is_active").eq("organization_id", organization.id).order("name"),
    supabase.from("brands").select("id, name, is_active").eq("organization_id", organization.id).order("name"),
    supabase.from("suppliers").select("id, business_name, is_active").eq("organization_id", organization.id).order("business_name"),
  ]);
  if (product.error || categories.error || brands.error || suppliers.error) {
    throw new Error("No se pudo cargar el producto.");
  }
  if (!product.data) notFound();

  const action = updateProductAction.bind(null, id);

  return (
    <div className="page-container">
      <Link className="inline-flex items-center gap-2 text-sm font-bold text-[var(--plum)] no-underline hover:underline" href={`/app/productos/${id}`}>
        <ArrowLeft size={17} /> Volver al producto
      </Link>
      <header className="mt-6">
        <span className="eyebrow">Catálogo</span>
        <h1 className="page-title mt-2">Editar producto</h1>
        <p className="page-lead">{product.data.name}. Los cambios de stock quedarán registrados automáticamente en su historial.</p>
      </header>
      <ProductForm
        action={action}
        brands={brands.data ?? []}
        categories={categories.data ?? []}
        product={product.data}
        suppliers={suppliers.data ?? []}
      />
    </div>
  );
}
