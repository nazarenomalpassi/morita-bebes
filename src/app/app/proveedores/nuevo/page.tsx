import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SupplierForm } from "@/components/inventory/supplier-form";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { createSupplierAction } from "../actions";

export default async function NewSupplierPage() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/app/proveedores");
  return (
    <div className="page-container">
      <Link className="inline-flex items-center gap-2 text-sm font-bold text-[var(--plum)] no-underline hover:underline" href="/app/proveedores"><ArrowLeft size={17} /> Volver a proveedores</Link>
      <header className="mt-6"><span className="eyebrow">Compras</span><h1 className="page-title mt-2">Nuevo proveedor</h1><p className="page-lead">Creá el registro con el nombre comercial y completá el contacto cuando esté disponible.</p></header>
      <SupplierForm action={createSupplierAction} />
    </div>
  );
}
