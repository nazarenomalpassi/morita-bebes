"use client";

import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardList,
  LoaderCircle,
  PackagePlus,
  Plus,
  Search,
  Send,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import Link from "next/link";
import {
  useActionState,
  useMemo,
  useState,
} from "react";

import {
  createPurchaseOrderAction,
  updatePurchaseOrderStatusAction,
  type PurchaseActionState,
} from "@/app/app/compras/actions";
import { ars, dateTime, localDate, quantity } from "@/lib/format";

import { OrderReceiptForm } from "./order-receipt-form";
import type {
  PurchaseOrder,
  PurchaseProduct,
  PurchaseSupplier,
} from "./purchase-types";

const initialState: PurchaseActionState = {};

const statusLabels: Record<PurchaseOrder["status"], string> = {
  draft: "Borrador",
  sent: "Enviada",
  partial: "Recepción parcial",
  received: "Recibida",
  cancelled: "Cancelada",
};

function todayInArgentina() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function suggestedQuantity(product: PurchaseProduct) {
  return Math.max(
    1,
    (product.targetStock ?? product.minStock) - product.currentStock,
  );
}

function statusClass(status: PurchaseOrder["status"]) {
  if (status === "received") return "table-status table-status-ok";
  if (status === "cancelled") return "table-status table-status-alert";
  return "table-status text-[var(--plum)]";
}

type OrderLine = {
  productId: string;
  quantity: number;
  unitCost: number;
};

type PurchaseManagementProps = {
  products: PurchaseProduct[];
  suppliers: PurchaseSupplier[];
  orders: PurchaseOrder[];
  canCancel: boolean;
  canManage: boolean;
};

function PurchaseEditor({
  products,
  suppliers,
  orders,
  canCancel,
  canManage,
  state,
  formAction,
  pending,
}: PurchaseManagementProps & {
  state: PurchaseActionState;
  formAction: (payload: FormData) => void;
  pending: boolean;
}) {
  const [showCreator, setShowCreator] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [lines, setLines] = useState<Record<string, OrderLine>>({});
  const [orderFilter, setOrderFilter] = useState<"open" | "all" | PurchaseOrder["status"]>("open");

  const restockProducts = useMemo(
    () => products.filter((product) => product.needsRestock),
    [products],
  );
  const groupedRestock = useMemo(() => {
    const groups = new Map<
      string,
      { supplierId: string | null; supplierName: string; products: PurchaseProduct[] }
    >();
    restockProducts.forEach((product) => {
      const key = product.supplierId ?? "pending";
      const current = groups.get(key) ?? {
        supplierId: product.supplierId,
        supplierName: product.supplierName ?? "Proveedor pendiente",
        products: [],
      };
      current.products.push(product);
      groups.set(key, current);
    });
    return [...groups.values()].sort((a, b) => {
      if (!a.supplierId) return 1;
      if (!b.supplierId) return -1;
      return a.supplierName.localeCompare(b.supplierName, "es");
    });
  }, [restockProducts]);

  const catalog = useMemo(() => {
    const term = productSearch.trim().toLocaleLowerCase("es");
    return products
      .filter((product) => {
        if (!term) return true;
        return `${product.name} ${product.sku} ${product.barcode ?? ""}`
          .toLocaleLowerCase("es")
          .includes(term);
      })
      .slice(0, 80);
  }, [productSearch, products]);

  const selectedLines = useMemo(
    () =>
      Object.values(lines).map((line) => ({
        ...line,
        product: products.find((product) => product.id === line.productId)!,
      })),
    [lines, products],
  );
  const orderTotal = selectedLines.reduce(
    (sum, line) => sum + line.quantity * line.unitCost,
    0,
  );
  const serializedItems = JSON.stringify(
    selectedLines.map((line) => ({
      product_id: line.productId,
      quantity_ordered: line.quantity,
      unit_cost: line.unitCost,
    })),
  );

  function addProduct(product: PurchaseProduct, amount?: number) {
    setLines((current) => ({
      ...current,
      [product.id]: current[product.id] ?? {
        productId: product.id,
        quantity: amount ?? (product.needsRestock ? suggestedQuantity(product) : 1),
        unitCost: product.costPrice,
      },
    }));
  }

  function prepareSupplierOrder(supplierId: string) {
    const supplierProducts = restockProducts.filter(
      (product) => product.supplierId === supplierId,
    );
    setSelectedSupplier(supplierId);
    setLines(
      Object.fromEntries(
        supplierProducts.map((product) => [
          product.id,
          {
            productId: product.id,
            quantity: suggestedQuantity(product),
            unitCost: product.costPrice,
          },
        ]),
      ),
    );
    setShowCreator(true);
    window.setTimeout(
      () => document.getElementById("crear-orden")?.scrollIntoView({ behavior: "smooth" }),
      0,
    );
  }

  function updateLine(productId: string, patch: Partial<OrderLine>) {
    setLines((current) => ({
      ...current,
      [productId]: { ...current[productId], ...patch },
    }));
  }

  const filteredOrders = orders.filter((order) => {
    if (orderFilter === "all") return true;
    if (orderFilter === "open") return ["draft", "sent", "partial"].includes(order.status);
    return order.status === orderFilter;
  });

  return (
    <>
      <section className="mt-8">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">Reposición sugerida</span>
            <h2>Faltantes por proveedor</h2>
          </div>
          <span className="result-count">{restockProducts.length} productos</span>
        </div>

        {groupedRestock.length ? (
          <div className="mt-4 grid gap-3">
            {groupedRestock.map((group, index) => {
              const suggestedUnits = group.products.reduce(
                (sum, product) => sum + suggestedQuantity(product),
                0,
              );
              const estimate = group.products.reduce(
                (sum, product) => sum + suggestedQuantity(product) * product.costPrice,
                0,
              );
              return (
                <details
                  className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)]"
                  key={group.supplierId ?? "pending"}
                  open={index === 0}
                >
                  <summary className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                    <span className={`entity-avatar ${group.supplierId ? "" : "entity-avatar-alert"}`}>
                      {group.supplierId ? <Truck size={18} /> : <AlertTriangle size={18} />}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate">{group.supplierName}</strong>
                      <small className="mt-1 block text-[var(--ink-muted)]">
                        {group.products.length} productos · {quantity.format(suggestedUnits)} unidades sugeridas · {ars.format(estimate)}
                      </small>
                    </span>
                    <ChevronDown className="text-[var(--ink-muted)]" size={18} />
                  </summary>
                  <div className="border-t border-[var(--line)] px-4 pb-4">
                    <div className="data-table-wrap mt-0" data-mobile-cards>
                      <table className="data-table min-w-[42rem]">
                        <thead className="text-left text-[0.7rem] uppercase text-[var(--ink-muted)]">
                          <tr>
                            <th className="py-3 pr-3">Producto</th>
                            <th className="px-3 py-3">Stock</th>
                            <th className="px-3 py-3">Mínimo</th>
                            <th className="px-3 py-3">Objetivo</th>
                            <th className="px-3 py-3">Sugerido</th>
                            <th className="px-3 py-3 text-right">Costo est.</th>
                            {!group.supplierId && <th className="pl-3 py-3"><span className="sr-only">Acción</span></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {group.products.map((product) => {
                            const suggested = suggestedQuantity(product);
                            return (
                              <tr className="border-t border-[var(--line)]" key={product.id}>
                                <td data-label="Producto"><strong>{product.name}</strong><small className="mt-0.5 block text-[var(--ink-muted)]">{product.sku}</small></td>
                                <td className="text-[var(--danger)]" data-label="Stock">{quantity.format(product.currentStock)}</td>
                                <td data-label="Mínimo">{quantity.format(product.minStock)}</td>
                                <td data-label="Objetivo">{quantity.format(product.targetStock ?? product.minStock)}</td>
                                <td className="font-bold" data-label="Sugerido">{quantity.format(suggested)}</td>
                                <td className="text-right" data-label="Costo est.">{ars.format(suggested * product.costPrice)}</td>
                                {!group.supplierId && (
                                  <td className="text-right" data-label="">
                                    {canManage ? (
                                      <Link className="text-link" href={`/app/productos/${product.id}/editar`}>Asignar proveedor</Link>
                                    ) : (
                                      <span className="text-xs text-[var(--ink-muted)]">Pendiente</span>
                                    )}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {group.supplierId && canManage ? (
                      <div className="mt-3 flex justify-end border-t border-[var(--line)] pt-3">
                        <button
                          className="button button-secondary gap-2"
                          onClick={() => prepareSupplierOrder(group.supplierId!)}
                          type="button"
                        >
                          <ShoppingCart size={17} /> Preparar pedido
                        </button>
                      </div>
                    ) : !group.supplierId ? (
                      <p className="mt-3 border-t border-[var(--line)] pt-3 text-xs leading-5 text-[var(--ink-muted)]">
                        Estos productos quedan visibles hasta que se complete su proveedor predeterminado.
                      </p>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="empty-state min-h-48">
            <span className="empty-state-icon"><Check size={24} /></span>
            <h2>Stock cubierto</h2>
            <p>No hay productos en su punto mínimo de reposición.</p>
          </div>
        )}
      </section>

      {canManage && (
        <section className="records-section" id="crear-orden">
          <div className="section-heading-row">
            <div>
              <span className="eyebrow">Pedido a proveedor</span>
              <h2>Nueva orden de compra</h2>
            </div>
            <button
              aria-expanded={showCreator}
              className="button button-primary gap-2"
              onClick={() => setShowCreator((current) => !current)}
              type="button"
            >
              <Plus size={17} /> {showCreator ? "Cerrar" : "Crear orden"}
            </button>
          </div>

          {showCreator && (
            <form action={formAction} className="mt-4 grid gap-4">
              <div className="grid gap-4 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-4 lg:grid-cols-[minmax(18rem,0.75fr)_minmax(24rem,1.25fr)]">
                <div className="min-w-0">
                  <label className="field-label">
                    Proveedor
                    <select
                      className="field-input mt-1"
                      name="supplier_id"
                      onChange={(event) => setSelectedSupplier(event.target.value)}
                      required
                      value={selectedSupplier}
                    >
                      <option value="">Seleccionar proveedor</option>
                      {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                    </select>
                  </label>

                  <label className="search-field mt-4">
                    <Search aria-hidden="true" size={17} />
                    <span className="sr-only">Buscar producto</span>
                    <input
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Producto, SKU o código"
                      value={productSearch}
                    />
                  </label>

                  <div className="mt-2 max-h-80 overflow-y-auto border-t border-[var(--line)]">
                    {catalog.map((product) => {
                      const added = Boolean(lines[product.id]);
                      return (
                        <button
                          className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 border-b border-[var(--line)] bg-transparent px-1 py-3 text-left hover:bg-[#faf9fb] disabled:opacity-50"
                          disabled={added}
                          key={product.id}
                          onClick={() => addProduct(product)}
                          type="button"
                        >
                          <span className="min-w-0">
                            <strong className="block truncate text-sm">{product.name}</strong>
                            <small className="mt-1 block truncate text-xs text-[var(--ink-muted)]">
                              {product.sku} · {product.supplierName ?? "Sin proveedor"} · Stock {quantity.format(product.currentStock)}
                            </small>
                          </span>
                          <span className="icon-button" aria-hidden="true">{added ? <Check size={16} /> : <Plus size={16} />}</span>
                        </button>
                      );
                    })}
                    {catalog.length === 0 && <p className="inline-empty">No encontramos productos.</p>}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold">Detalle del pedido</h3>
                    <span className="tag">{selectedLines.length} items</span>
                  </div>
                  <div className="data-table-wrap mt-3" data-mobile-cards>
                    <table className="data-table min-w-[38rem]">
                      <thead className="text-left text-[0.7rem] uppercase text-[var(--ink-muted)]">
                        <tr><th className="py-2 pr-3">Producto</th><th className="px-3 py-2">Cantidad</th><th className="px-3 py-2">Costo</th><th className="px-3 py-2 text-right">Subtotal</th><th className="py-2 pl-3"><span className="sr-only">Quitar</span></th></tr>
                      </thead>
                      <tbody>
                        {selectedLines.map((line) => (
                          <tr className="border-t border-[var(--line)]" key={line.productId}>
                            <td data-label="Producto"><strong className="block">{line.product.name}</strong><small className="text-[var(--ink-muted)]">{line.product.sku}</small></td>
                            <td data-label="Cantidad"><label><span className="sr-only">Cantidad de {line.product.name}</span><input className="field-input w-28" inputMode="decimal" min="0.001" onChange={(event) => updateLine(line.productId, { quantity: Math.max(0.001, Number(event.target.value)) })} step="0.001" type="number" value={line.quantity} /></label></td>
                            <td data-label="Costo"><label><span className="sr-only">Costo de {line.product.name}</span><input className="field-input w-32" inputMode="decimal" min="0" onChange={(event) => updateLine(line.productId, { unitCost: Math.max(0, Number(event.target.value)) })} step="0.01" type="number" value={line.unitCost} /></label></td>
                            <td className="text-right font-bold" data-label="Subtotal">{ars.format(line.quantity * line.unitCost)}</td>
                            <td data-label=""><button aria-label={`Quitar ${line.product.name}`} className="icon-button icon-button-danger" onClick={() => setLines((current) => { const next = { ...current }; delete next[line.productId]; return next; })} title="Quitar" type="button"><Trash2 size={16} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {selectedLines.length === 0 && <div className="grid min-h-32 place-items-center text-sm text-[var(--ink-muted)]"><span className="text-center"><PackagePlus className="mx-auto mb-2" size={22} />Agregá productos desde el buscador.</span></div>}
                  </div>
                  <div className="mt-3 flex justify-between border-t border-[var(--line)] pt-3 text-sm">
                    <span className="text-[var(--ink-muted)]">Total estimado</span>
                    <strong className="text-base">{ars.format(orderTotal)}</strong>
                  </div>
                </div>
              </div>

              <div className="form-grid mt-0 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-4">
                <label className="field-label">Fecha de orden<input className="field-input mt-1" defaultValue={todayInArgentina()} name="ordered_at" required type="date" /></label>
                <label className="field-label">Entrega esperada<input className="field-input mt-1" min={todayInArgentina()} name="expected_at" type="date" /></label>
                <label className="field-label">Referencia<input className="field-input mt-1" maxLength={80} name="reference" placeholder="Ej.: PED-AGOSTO-01" /></label>
                <label className="field-label">Nota interna<input className="field-input mt-1" maxLength={500} name="notes" placeholder="Condiciones, contacto o recordatorio" /></label>
              </div>

              <input name="items" type="hidden" value={serializedItems} />
              {(state.error || state.message) && (
                <p aria-live="polite" className={state.error ? "form-error" : "form-success"}>{state.error ?? state.message}</p>
              )}
              <div className="flex justify-end">
                <button className="button button-primary gap-2" disabled={pending || !selectedSupplier || selectedLines.length === 0} type="submit">
                  {pending ? <LoaderCircle className="animate-spin" size={17} /> : <ClipboardList size={17} />}
                  {pending ? "Creando..." : "Guardar orden"}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      <section className="records-section">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">Seguimiento</span>
            <h2>Órdenes de compra</h2>
          </div>
          <label>
            <span className="sr-only">Filtrar órdenes</span>
            <select className="field-input min-w-40" onChange={(event) => setOrderFilter(event.target.value as typeof orderFilter)} value={orderFilter}>
              <option value="open">Abiertas</option><option value="all">Todas</option><option value="draft">Borradores</option><option value="sent">Enviadas</option><option value="partial">Parciales</option><option value="received">Recibidas</option><option value="cancelled">Canceladas</option>
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-3">
          {filteredOrders.map((order) => {
            const ordered = order.items.reduce((sum, item) => sum + item.quantityOrdered, 0);
            const received = order.items.reduce((sum, item) => sum + item.quantityReceived, 0);
            const progress = ordered > 0 ? Math.min(100, (received / ordered) * 100) : 0;
            return (
              <details className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)]" key={order.id}>
                <summary className="grid min-h-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 md:grid-cols-[minmax(13rem,1fr)_minmax(11rem,0.7fr)_minmax(9rem,0.55fr)_auto]">
                  <span className="min-w-0"><strong className="block truncate">{order.reference ?? `Orden #${order.id.slice(0, 8)}`}</strong><small className="mt-1 block truncate text-[var(--ink-muted)]">{order.supplierName} · {order.orderedAt ? localDate(order.orderedAt) : "Sin fecha"}</small></span>
                  <span className="hidden min-w-0 md:block"><small className="block text-[0.7rem] font-semibold text-[var(--ink-muted)]">Recepción</small><span className="mt-1 block h-1.5 overflow-hidden rounded bg-[#ece9ef]"><span className="block h-full bg-[var(--plum)]" style={{ width: `${progress}%` }} /></span><small className="mt-1 block text-[0.7rem] text-[var(--ink-muted)]">{quantity.format(received)} de {quantity.format(ordered)}</small></span>
                  <span className="hidden text-right md:block"><small className="block text-[0.7rem] text-[var(--ink-muted)]">Estimado</small><strong>{ars.format(order.estimatedTotal)}</strong></span>
                  <span className={statusClass(order.status)}>{statusLabels[order.status]} <ChevronDown size={15} /></span>
                </summary>

                <div className="border-t border-[var(--line)] px-4 pb-4 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs sm:grid-cols-4">
                      <div><dt className="text-[var(--ink-muted)]">Creada</dt><dd className="mt-0.5 font-semibold">{dateTime.format(new Date(order.createdAt))}</dd></div>
                      <div><dt className="text-[var(--ink-muted)]">Entrega</dt><dd className="mt-0.5 font-semibold">{order.expectedAt ? localDate(order.expectedAt) : "Sin indicar"}</dd></div>
                      <div><dt className="text-[var(--ink-muted)]">Items</dt><dd className="mt-0.5 font-semibold">{order.items.length}</dd></div>
                      <div><dt className="text-[var(--ink-muted)]">Total</dt><dd className="mt-0.5 font-semibold">{ars.format(order.estimatedTotal)}</dd></div>
                    </dl>
                    {canManage && (
                      <div className="flex flex-wrap gap-2">
                        {order.status === "draft" && <form action={updatePurchaseOrderStatusAction}><input name="purchase_order_id" type="hidden" value={order.id} /><input name="status" type="hidden" value="sent" /><button className="button button-secondary gap-2" type="submit"><Send size={16} /> Marcar enviada</button></form>}
                        {canCancel && ["draft", "sent", "partial"].includes(order.status) && <form action={updatePurchaseOrderStatusAction} onSubmit={(event) => { if (!window.confirm("¿Cancelar esta orden de compra?")) event.preventDefault(); }}><input name="purchase_order_id" type="hidden" value={order.id} /><input name="status" type="hidden" value="cancelled" /><button className="button button-secondary gap-2 text-[var(--danger)]" type="submit"><Ban size={16} /> Cancelar</button></form>}
                      </div>
                    )}
                  </div>

                  {order.notes && <p className="mt-4 rounded-[6px] bg-[var(--surface-soft)] px-3 py-2 text-xs leading-5 text-[var(--ink-muted)]">{order.notes}</p>}

                  <div className="data-table-wrap mt-4" data-mobile-cards>
                    <table className="data-table min-w-[42rem]">
                      <thead className="bg-[#f4f2f6] text-left text-[0.7rem] uppercase text-[var(--ink-muted)]"><tr><th className="px-3 py-2.5">Producto</th><th className="px-3 py-2.5">Pedido</th><th className="px-3 py-2.5">Recibido</th><th className="px-3 py-2.5">Pendiente</th><th className="px-3 py-2.5">Costo</th><th className="px-3 py-2.5 text-right">Subtotal</th></tr></thead>
                      <tbody>{order.items.map((item) => <tr className="border-t border-[var(--line)]" key={item.id}><td data-label="Producto"><strong>{item.productName}</strong><small className="mt-0.5 block text-[var(--ink-muted)]">{item.sku}</small></td><td data-label="Pedido">{quantity.format(item.quantityOrdered)}</td><td className="text-[var(--success)]" data-label="Recibido">{quantity.format(item.quantityReceived)}</td><td className="font-semibold" data-label="Pendiente">{quantity.format(Math.max(0, item.quantityOrdered - item.quantityReceived))}</td><td data-label="Costo">{ars.format(item.unitCost)}</td><td className="text-right font-bold" data-label="Subtotal">{ars.format(item.quantityOrdered * item.unitCost)}</td></tr>)}</tbody>
                    </table>
                  </div>

                  {canManage && ["sent", "partial"].includes(order.status) && <OrderReceiptForm order={order} />}
                  {!canManage && ["sent", "partial"].includes(order.status) && (
                    <p className="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-4 text-xs text-[var(--ink-muted)]"><CalendarClock size={16} /> La recepción debe registrarla un dueño o administrador.</p>
                  )}
                </div>
              </details>
            );
          })}
          {filteredOrders.length === 0 && (
            <div className="empty-state min-h-48"><span className="empty-state-icon"><ClipboardList size={24} /></span><h2>No hay órdenes en este estado</h2><p>Los pedidos creados aparecerán acá con su avance de recepción.</p></div>
          )}
        </div>
      </section>
    </>
  );
}

export function PurchaseManagement(props: PurchaseManagementProps) {
  const [state, formAction, pending] = useActionState(
    createPurchaseOrderAction,
    initialState,
  );

  return (
    <PurchaseEditor
      {...props}
      formAction={formAction}
      key={state.orderId ?? "new-purchase-order"}
      pending={pending}
      state={state}
    />
  );
}
