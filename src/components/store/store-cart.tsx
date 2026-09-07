"use client";

import { ArrowRight, CheckCircle2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { createWebOrderAction, revalidateStoreCartAction, type StoreActionState } from "@/app/tienda/actions";
import { useStoreCart } from "@/components/store/cart-provider";
import { ProductMedia } from "@/components/store/product-media";
import { ars } from "@/lib/format";
import { orderMinimumProgress } from "@/lib/store/order";

const initialState: StoreActionState = {};
const subscribeToBrowser = () => () => {};

export function StoreCart({ accountType, authenticated, minimum }: { accountType: "guest" | "retail" | "wholesale"; authenticated: boolean; minimum: number }) {
  const { clear, items, remove, subtotal, syncProducts, updateQuantity } = useStoreCart();
  const [state, action, pending] = useActionState(createWebOrderAction, initialState);
  const idempotencyRef = useRef("");
  const idempotencyKey = useSyncExternalStore(
    subscribeToBrowser,
    () => idempotencyRef.current ||= crypto.randomUUID(),
    () => "",
  );
  const [syncMessage, setSyncMessage] = useState("");
  const progress = orderMinimumProgress(subtotal, minimum);
  const remaining = progress.remaining;
  const valid = items.length > 0 && progress.reached && items.every((item) => item.available && !item.issue && item.price !== null && item.quantity <= item.stock);
  const payload = useMemo(() => JSON.stringify(items.map((item) => ({ product_id: item.productId, quantity: item.quantity }))), [items]);
  const productIds = useMemo(() => items.map((item) => item.productId).sort().join(","), [items]);

  useEffect(() => {
    if (!productIds) return;
    let cancelled = false;
    const ids = productIds.split(",");
    void revalidateStoreCartAction(ids).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setSyncMessage(result.error);
        return;
      }
      const snapshots = new Map(result.products.map((product) => [product.id, product]));
      const changed = items.some((item) => {
        const current = snapshots.get(item.productId);
        return !current
          || Number(current.current_stock) !== item.stock
          || (current.display_price === null ? null : Number(current.display_price)) !== item.price
          || current.price_kind !== item.priceKind;
      });
      syncProducts(result.products);
      setSyncMessage(changed ? "Actualizamos precios y disponibilidad con los datos actuales del local." : "");
    });
    return () => { cancelled = true; };
  // The item ID set and account type are the only triggers; syncing values must not start a loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountType, productIds, syncProducts]);

  useEffect(() => {
    if (!state.orderNumber) return;
    clear();
    if (state.whatsappUrl) window.location.assign(state.whatsappUrl);
  }, [clear, state.orderNumber, state.whatsappUrl]);

  if (!items.length && !state.orderNumber) return <div className="store-page store-cart-page"><header className="store-page-heading"><span>Tu selección</span><h1>Carrito</h1></header><div className="store-empty-state"><ShoppingBag aria-hidden="true" /><h2>Tu carrito está vacío</h2><p>Explorá el catálogo y agregá los productos que necesitás.</p><Link className="store-primary-button" href="/tienda/productos">Ver productos <ArrowRight /></Link></div></div>;

  return (
    <div className="store-page store-cart-page">
      <header className="store-page-heading"><span>Tu selección</span><h1>Carrito</h1><p>Revisá cantidades y disponibilidad antes de generar el pedido.</p></header>
      {syncMessage ? <p className="store-cart-sync-message" role="status">{syncMessage}</p> : null}
      {state.orderNumber ? <div className="store-order-success"><CheckCircle2 aria-hidden="true" /><h2>Pedido {state.orderNumber} guardado</h2><p>{state.message}</p>{state.whatsappUrl ? <a className="store-primary-button" href={state.whatsappUrl}>Abrir WhatsApp <ArrowRight /></a> : <Link className="store-secondary-button" href="/tienda/cuenta">Ver mis pedidos</Link>}</div> : <div className="store-cart-layout">
        <section className="store-cart-items" aria-label="Productos del carrito">
          {items.map((item) => <article className="store-cart-item" key={item.productId}>
            <Link className="store-cart-image" href={`/tienda/productos/${item.slug}`}><ProductMedia alt={item.name} imagePath={item.imagePath} /></Link>
            <div className="store-cart-copy"><Link href={`/tienda/productos/${item.slug}`}><h2>{item.name}</h2></Link><span>{item.price === null ? "Consultar precio" : ars.format(item.price)} por {item.unit}</span>{item.minimumQuantity > 1 ? <small>Mínimo {item.minimumQuantity}</small> : null}{item.issue ? <small className="store-cart-item-error">{item.issue}</small> : null}</div>
            <div className="store-cart-quantity"><button aria-label="Restar" disabled={item.quantity <= item.minimumQuantity} onClick={() => updateQuantity(item.productId, item.quantity - 1)} type="button"><Minus /></button><input aria-label={`Cantidad de ${item.name}`} inputMode="numeric" max={item.stock} min={item.minimumQuantity} onChange={(event) => updateQuantity(item.productId, Number(event.target.value) || item.minimumQuantity)} type="number" value={item.quantity} /><button aria-label="Sumar" disabled={item.quantity >= item.stock} onClick={() => updateQuantity(item.productId, item.quantity + 1)} type="button"><Plus /></button></div>
            <strong className="store-cart-line-total">{item.price === null ? "-" : ars.format(item.price * item.quantity)}</strong>
            <button aria-label={`Quitar ${item.name}`} className="store-cart-remove" onClick={() => remove(item.productId)} type="button"><Trash2 /></button>
          </article>)}
        </section>
        <aside className="store-cart-summary"><span>{accountType === "wholesale" ? "Pedido mayorista" : "Pedido minorista"}</span><h2>Resumen</h2><div><span>Subtotal</span><strong>{ars.format(subtotal)}</strong></div><div><span>Mínimo requerido</span><strong>{ars.format(minimum)}</strong></div>{remaining > 0 ? <div className="store-minimum-progress"><span style={{ width: `${progress.percent}%` }} /><p>Te faltan <strong>{ars.format(remaining)}</strong> para alcanzar el mínimo.</p></div> : <p className="store-minimum-ok"><CheckCircle2 aria-hidden="true" /> Alcanzaste el mínimo de compra.</p>}
          {!authenticated ? <div className="store-auth-callout"><p>Iniciá sesión o creá una cuenta para guardar el pedido y continuar por WhatsApp.</p><Link className="store-primary-button" href="/tienda/ingresar?next=/tienda/carrito">Ingresar para continuar</Link></div> : <form action={action} className="store-checkout-form"><input name="items" type="hidden" value={payload} /><input name="idempotency_key" type="hidden" value={idempotencyKey} /><label>Nota para Morita (opcional)<textarea maxLength={500} name="notes" placeholder="Ej.: coordinar retiro por la tarde" /></label><button className="store-primary-button" disabled={!valid || !idempotencyKey || pending} type="submit">{pending ? "Validando stock..." : "Generar pedido por WhatsApp"}<ArrowRight aria-hidden="true" /></button>{state.error ? <p className="store-form-error" role="alert">{state.error}</p> : null}<small>Guardaremos tu pedido antes de abrir WhatsApp. El stock se descuenta recién cuando Morita lo confirma.</small></form>}
        </aside>
      </div>}
    </div>
  );
}
