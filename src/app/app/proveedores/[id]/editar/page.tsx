import { ArrowLeft, Power, PowerOff } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SupplierForm } from "@/components/inventory/supplier-form";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { toggleSupplierStatusAction, updateSupplierAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditSupplierPage({ params }: PageProps<"/app/proveedores/[id]/editar">) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) redirect("/app");
  const { data: supplier, error } = await supabase
    .from("suppliers")
    .select("business_name, contact_name, phone, whatsapp, email, address, notes, is_active")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (error) throw new Error("No se pudo cargar el proveedor.");
  if (!supplier) notFound();
  const updateAction = updateSupplierAction.bind(null, id);
  const toggleAction = toggleSupplierStatusAction.bind(null, id);

  return (
    <div className="page-container">
      <Link className="inline-flex items-center gap-2 text-sm font-bold text-[var(--plum)] no-underline hover:underline" href="/app/proveedores"><ArrowLeft size={17} /> Volver a proveedores</Link>
      <header className="page-header mt-6">
        <div><span className="eyebrow">Compras</span><h1 className="page-title mt-2">Editar proveedor</h1><p className="page-lead">{supplier.business_name}</p></div>
        <form action={toggleAction}><button className="button button-secondary gap-2" type="submit">{supplier.is_active ? <PowerOff size={17} /> : <Power size={17} />}{supplier.is_active ? "Desactivar" : "Reactivar"}</button></form>
      </header>
      <SupplierForm action={updateAction} supplier={supplier} />
    </div>
  );
}
