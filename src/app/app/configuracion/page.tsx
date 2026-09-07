import { Database, Settings2, WalletCards } from "lucide-react";
import Link from "next/link";

import {
  PaymentMethodsForm,
  SettingsForm,
} from "@/app/app/configuracion/settings-forms";
import { getCurrentOrganization } from "@/lib/data/current-organization";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return null;

  if (organization.role === "staff") {
    return <div className="page-container permission-state"><Settings2 size={30} /><h1>Acceso restringido</h1><p>La configuración está disponible para dueños y administradores.</p></div>;
  }

  const [settingsResult, methodsResult] = await Promise.all([
    supabase.from("site_settings").select("*").eq("organization_id", organization.id).maybeSingle(),
    supabase.from("payment_methods").select("code, debit_surcharge_percent, credit_surcharge_percent").eq("organization_id", organization.id).in("code", ["cash", "transfer", "card"]).order("sort_order"),
  ]);
  if (settingsResult.error || methodsResult.error) {
    throw new Error("No se pudo cargar la configuración.");
  }
  const settings = settingsResult.data;
  const cardMethod = (methodsResult.data ?? []).find((method) => method.code === "card");

  return (
    <div className="page-container">
      <header className="page-header"><div><span className="eyebrow">Preferencias del sistema</span><h1 className="page-title mt-2">Configuración</h1><p className="page-lead">Datos del comercio, medios de cobro e importación inicial.</p></div></header>

      <section className="settings-grid">
        <div className="settings-section">
          <div className="section-heading-row"><div><span className="eyebrow">Comercio</span><h2>Datos generales</h2></div><Settings2 size={21} /></div>
          <SettingsForm settings={{ organizationName: organization.name, whatsapp: settings?.whatsapp, email: settings?.email, address: settings?.address, instagramUrl: settings?.instagram_url }} />
        </div>

        <div className="settings-section">
          <div className="section-heading-row"><div><span className="eyebrow">Cobros</span><h2>Medios de pago</h2></div><WalletCards size={21} /></div>
          <PaymentMethodsForm
            creditSurchargePercent={Number(cardMethod?.credit_surcharge_percent ?? 0)}
            debitSurchargePercent={Number(cardMethod?.debit_surcharge_percent ?? 0)}
          />
        </div>
      </section>

      <section className="import-callout">
        <span className="summary-strip-icon"><Database size={20} /></span>
        <div><strong>Inventario del sistema anterior</strong><p>Carga controlada del archivo histórico y revisión de datos pendientes.</p></div>
        <Link className="button button-secondary" href="/app/importar">Abrir importación</Link>
      </section>
    </div>
  );
}
