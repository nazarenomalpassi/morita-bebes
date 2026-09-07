"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import { updateStoreProfileAction, type StoreActionState } from "@/app/tienda/actions";
import type { StoreCustomerProfile } from "@/lib/store/types";

export function StoreProfileForm({ profile }: { profile: StoreCustomerProfile }) {
  const [state, action, pending] = useActionState<StoreActionState, FormData>(updateStoreProfileAction, {});
  return <form action={action} className="store-account-form"><div className="store-form-grid"><label>Nombre<input defaultValue={profile.first_name} name="first_name" required /></label><label>Apellido<input defaultValue={profile.last_name} name="last_name" required /></label><label>Teléfono<input defaultValue={profile.phone} inputMode="tel" name="phone" required type="tel" /></label><label>Correo<input disabled value={profile.email} /></label><label>Localidad<input defaultValue={profile.locality} name="locality" required /></label><label>Provincia<input defaultValue={profile.province} name="province" required /></label><label>Comercio (opcional)<input defaultValue={profile.business_name ?? ""} name="business_name" /></label><label>CUIT (opcional)<input defaultValue={profile.cuit ?? ""} inputMode="numeric" name="cuit" /></label><label className="store-form-span">Dirección (opcional)<input defaultValue={profile.address ?? ""} name="address" /></label></div>{state.error ? <p className="store-form-error">{state.error}</p> : null}{state.message ? <p className="store-form-success">{state.message}</p> : null}<button className="store-secondary-button" disabled={pending} type="submit"><Save />{pending ? "Guardando..." : "Guardar datos"}</button></form>;
}
