"use client";

import { ArrowRight, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import { storeLoginAction, storeRegisterAction, type StoreActionState } from "@/app/tienda/actions";

const initialState: StoreActionState = {};

export function StoreLoginForm({ next = "/tienda" }: { next?: string }) {
  const [state, action, pending] = useActionState(storeLoginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  return <form action={action} className="store-auth-form"><input name="next" type="hidden" value={next} /><label>Correo electrónico<input autoComplete="email" name="email" placeholder="tu@email.com" required type="email" /></label><label>Contraseña<span className="store-password-field"><input autoComplete="current-password" minLength={8} name="password" required type={showPassword ? "text" : "password"} /><button aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? <EyeOff /> : <Eye />}</button></span></label>{state.error ? <p className="store-form-error" role="alert">{state.error}</p> : null}<button className="store-primary-button" disabled={pending} type="submit">{pending ? "Ingresando..." : "Ingresar"}<ArrowRight /></button><div className="store-auth-links"><Link href="/tienda/recuperar">Olvidé mi contraseña</Link><span>¿Todavía no tenés cuenta? <Link href="/tienda/registro">Crear cuenta</Link></span></div></form>;
}

export function StoreRegisterForm() {
  const [state, action, pending] = useActionState(storeRegisterAction, initialState);
  const [type, setType] = useState<"retail" | "wholesale">("retail");
  const [showPassword, setShowPassword] = useState(false);
  return <form action={action} className="store-auth-form store-register-form"><fieldset><legend>Tipo de cuenta</legend><label className={type === "retail" ? "is-selected" : ""}><input checked={type === "retail"} name="customer_type" onChange={() => setType("retail")} type="radio" value="retail" /><span><strong>Compra minorista</strong><small>Para compras personales desde $20.000</small></span></label><label className={type === "wholesale" ? "is-selected" : ""}><input checked={type === "wholesale"} name="customer_type" onChange={() => setType("wholesale")} type="radio" value="wholesale" /><span><strong>Quiero comprar por mayor</strong><small>Cuenta sujeta a aprobación, desde $500.000</small></span></label></fieldset><div className="store-form-grid"><label>Nombre<input autoComplete="given-name" name="first_name" required /></label><label>Apellido<input autoComplete="family-name" name="last_name" required /></label><label>Teléfono<input autoComplete="tel" inputMode="tel" name="phone" required type="tel" /></label><label>Correo electrónico<input autoComplete="email" name="email" required type="email" /></label><label>Localidad<input autoComplete="address-level2" name="locality" required /></label><label>Provincia<input autoComplete="address-level1" name="province" required /></label>{type === "wholesale" ? <><label>Nombre del comercio<input name="business_name" required /></label><label>CUIT (opcional)<input inputMode="numeric" name="cuit" /></label><label className="store-form-span">Dirección (opcional)<input autoComplete="street-address" name="address" /></label></> : null}<label className="store-form-span">Contraseña<span className="store-password-field"><input autoComplete="new-password" minLength={8} name="password" required type={showPassword ? "text" : "password"} /><button aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? <EyeOff /> : <Eye />}</button></span><small>Mínimo 8 caracteres.</small></label></div>{state.error ? <p className="store-form-error" role="alert">{state.error}</p> : null}{state.message ? <p className="store-form-success" role="status">{state.message}</p> : null}<button className="store-primary-button" disabled={pending} type="submit">{pending ? "Creando cuenta..." : type === "wholesale" ? "Solicitar cuenta mayorista" : "Crear mi cuenta"}<ArrowRight /></button><p className="store-auth-footnote">Al crear tu cuenta aceptás que usemos tus datos únicamente para gestionar tus pedidos.</p></form>;
}
