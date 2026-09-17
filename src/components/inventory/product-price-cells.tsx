"use client";

import { Pencil, Save, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";

import { updateProductPricesAction } from "@/app/app/productos/actions";
import { ars } from "@/lib/format";
import { formatPriceInput, parsePriceInput, type ProductPrices } from "@/lib/inventory/prices";

type PriceFields = { cost: string; retail: string; wholesale: string };
type PriceFieldName = keyof PriceFields;
const subscribe = () => () => {};

function inputValues(prices: ProductPrices): PriceFields {
  return {
    cost: formatPriceInput(prices.costPrice),
    retail: formatPriceInput(prices.retailPrice),
    wholesale: formatPriceInput(prices.wholesalePrice),
  };
}

export function ProductPriceCells({
  productId,
  productName,
  initialPrices,
  status,
}: {
  productId: string;
  productName: string;
  initialPrices: ProductPrices;
  status: React.ReactNode;
}) {
  const [prices, setPrices] = useState(initialPrices);
  const [fields, setFields] = useState(() => inputValues(initialPrices));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const changed = (fields.wholesale.trim() !== "" && parsePriceInput(fields.wholesale) === null)
    || parsePriceInput(fields.cost) !== prices.costPrice
    || parsePriceInput(fields.retail) !== prices.retailPrice
    || parsePriceInput(fields.wholesale) !== prices.wholesalePrice;

  function openEditor() {
    setFields(inputValues(prices));
    setErrors({});
    setMessage("");
    dialogRef.current?.showModal();
    firstInputRef.current?.focus();
  }

  function closeEditor() {
    if (pending) return;
    if (changed && !window.confirm("Hay cambios sin guardar. ¿Querés descartarlos?")) return;
    dialogRef.current?.close();
  }

  function updateField(name: PriceFieldName, value: string) {
    setFields((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name === "cost" ? "cost_price" : name === "retail" ? "retail_price" : "wholesale_price"]: "" }));
    setMessage("");
  }

  function formatField(name: PriceFieldName) {
    const value = parsePriceInput(fields[name]);
    if (value !== null) setFields((previous) => ({ ...previous, [name]: formatPriceInput(value) }));
  }

  function submitPrices(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !changed) return;

    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await updateProductPricesAction(productId, formData);
        if (result.status === "success" && result.prices) {
          setPrices(result.prices);
          setFields(inputValues(result.prices));
          setErrors({});
          setSavedMessage(result.message);
          dialogRef.current?.close();
          return;
        }
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message);
      } catch {
        setMessage("No se pudieron actualizar los precios. Intentá nuevamente.");
      }
    });
  }

  const dialog = (
    <dialog
      aria-labelledby={`price-editor-title-${productId}`}
      className="product-price-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeEditor();
      }}
      ref={dialogRef}
    >
      <div className="product-price-dialog-heading">
        <div>
          <span className="eyebrow">Producto</span>
          <h2 id={`price-editor-title-${productId}`}>Editar precios</h2>
          <p>{productName}</p>
        </div>
        <button aria-label="Cerrar" className="icon-button" disabled={pending} onClick={closeEditor} title="Cerrar" type="button"><X size={18} /></button>
      </div>
      <form noValidate onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} onSubmit={submitPrices}>
        {([
          ["cost", "cost_price", "Precio de costo"],
          ["retail", "retail_price", "Precio minorista"],
          ["wholesale", "wholesale_price", "Precio mayorista"],
        ] as const).map(([field, name, label]) => (
          <label className="product-price-field" key={field}>
            <span>{label}</span>
            <span className="product-price-input-wrap">
              <span aria-hidden="true">$</span>
              <input
                autoComplete="off"
                inputMode="decimal"
                maxLength={20}
                name={name}
                onBlur={() => formatField(field)}
                onChange={(event) => updateField(field, event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                placeholder={field === "wholesale" ? "Sin cargar" : "0"}
                ref={field === "cost" ? firstInputRef : undefined}
                required={field !== "wholesale"}
                type="text"
                value={fields[field]}
              />
            </span>
            {errors[name] ? <small className="product-price-error">{errors[name]}</small> : null}
          </label>
        ))}
        {message ? <p className="form-error" role="alert">{message}</p> : null}
        <div className="product-price-dialog-actions">
          <button className="button button-secondary" disabled={pending} onClick={closeEditor} type="button">Cancelar</button>
          <button className="button button-primary" disabled={pending || !changed} type="submit"><Save size={17} /> {pending ? "Guardando..." : "Guardar precios"}</button>
        </div>
      </form>
    </dialog>
  );

  return (
    <>
      <td className="product-price-value" data-label="Costo">{ars.format(prices.costPrice)}</td>
      <td className="product-price-value" data-label="Minorista">{ars.format(prices.retailPrice)}</td>
      <td className="product-price-value" data-label="Mayorista">{prices.wholesalePrice === null ? <span className="text-[var(--ink-muted)]">Sin cargar</span> : ars.format(prices.wholesalePrice)}</td>
      <td data-label="Estado">{status}</td>
      <td data-label="Acciones">
        <div className="product-price-actions">
          <button className="button button-secondary" onClick={openEditor} type="button"><Pencil size={15} /> Editar precios</button>
          <Link href={`/app/productos/${productId}`}>Ver</Link>
        </div>
        {savedMessage ? <small className="product-price-saved" role="status">{savedMessage}</small> : null}
      </td>
      {mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}
