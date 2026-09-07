"use client";

import {
  Barcode,
  CheckCircle2,
  Copy,
  CreditCard,
  ShieldCheck,
  Minus,
  Plus,
  ReceiptText,
  Search,
  ShoppingCart,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  createSaleAction,
  type SaleActionState,
} from "@/app/app/ventas/actions";
import { dateTimeInputValueInArgentina } from "@/lib/date";
import { ars, quantity as formatQuantity } from "@/lib/format";
import {
  calculateCardSurcharge,
  cardSurchargePercentage,
  roundMoney,
  type CardType,
} from "@/lib/payments/card-surcharge";
import {
  addProductUnit,
  createProductCodeIndex,
  findProductByScannedCode,
  isAccidentalDuplicateScan,
  normalizeScannedCode,
  type SaleCartLine,
  type SaleProduct,
} from "@/lib/sales/barcode-scanner";
import { calculateSaleAmounts, isFullyDiscountedSale } from "@/lib/sales/discount";
import { sanitizeDecimalInput } from "@/lib/sales/decimal-input";

type Option = { id: string; name: string };
type PaymentMethod = Option & {
  code: string;
  debit_surcharge_percent: number;
  credit_surcharge_percent: number;
};
type ScanFeedback = {
  code?: string;
  detail: string;
  id: number;
  tone: "success" | "error";
  title: string;
};

const initialState: SaleActionState = {};

function localDateTimeValue() {
  return dateTimeInputValueInArgentina();
}

function SaleEditor({
  products,
  customers,
  paymentMethods,
  state,
  action,
  pending,
  canChooseDate,
}: {
  products: SaleProduct[];
  customers: Option[];
  paymentMethods: PaymentMethod[];
  state: SaleActionState;
  action: (payload: FormData) => void;
  pending: boolean;
  canChooseDate: boolean;
}) {
  const [query, setQuery] = useState("");
  const [cart, setCartState] = useState<SaleCartLine[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);
  const [discountInput, setDiscountInput] = useState("");
  const [manualSurchargeInput, setManualSurchargeInput] = useState("");
  const [combinedPayment, setCombinedPayment] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [selectedCardType, setSelectedCardType] = useState<CardType | "">("");
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [paymentCardTypes, setPaymentCardTypes] = useState<Record<string, CardType | "">>({});
  const [quantityInputs, setQuantityInputs] = useState<Record<string, string>>({});
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const cartRef = useRef<SaleCartLine[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedSubmitRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const actualSubmitRef = useRef<HTMLButtonElement>(null);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef<{ code: string; occurredAt: number } | null>(null);
  const scanFeedbackIdRef = useRef(0);

  const scannerIndex = useMemo(() => createProductCodeIndex(products), [products]);
  const availableProductCount = useMemo(
    () => products.filter((product) => product.is_active && product.current_stock > 0).length,
    [products],
  );

  useEffect(() => {
    scannerInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!pending) submitInFlightRef.current = false;
  }, [pending]);

  useEffect(() => {
    if (!scanFeedback) return;
    const timeout = window.setTimeout(
      () => setScanFeedback((current) => current?.id === scanFeedback.id ? null : current),
      scanFeedback.tone === "success" ? 1_300 : 4_500,
    );
    return () => window.clearTimeout(timeout);
  }, [scanFeedback]);

  const matches = useMemo(() => {
    const availableProducts = products.filter((product) => product.is_active && product.current_stock > 0);
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return availableProducts.slice(0, 8);
    return availableProducts
      .filter((product) =>
        [product.name, product.sku, product.barcode ?? ""].some((value) =>
          value.toLocaleLowerCase("es").includes(normalized),
        ),
      )
      .slice(0, 12);
  }, [products, query]);

  const subtotal = cart.reduce(
    (total, line) => total + line.quantity * line.retail_price,
    0,
  );
  const discount = discountInput === "" ? 0 : Number(discountInput);
  const discountIsValid = Number.isFinite(discount) && discount >= 0 && discount <= 100;
  const validDiscount = discountIsValid ? discount : 0;
  const manualSurcharge = manualSurchargeInput === "" ? 0 : Number(manualSurchargeInput);
  const manualSurchargeIsValid = Number.isFinite(manualSurcharge)
    && manualSurcharge >= 0
    && manualSurcharge <= 999_999_999;
  const validManualSurcharge = manualSurchargeIsValid ? manualSurcharge : 0;
  const { discountAmount, paymentBaseTotal } = calculateSaleAmounts(
    subtotal,
    validDiscount,
    validManualSurcharge,
  );
  const isNoPaymentSale = isFullyDiscountedSale(subtotal, paymentBaseTotal);
  const requiresPayment = paymentBaseTotal > 0;
  const selectedMethod = paymentMethods.find((method) => method.id === selectedPaymentMethod);
  const payments = !requiresPayment ? [] : combinedPayment
    ? paymentMethods.flatMap((method) => {
        const amount = Number(paymentAmounts[method.id] || 0);
        if (amount <= 0) return [];
        return [{
          payment_method_id: method.id,
          amount: roundMoney(amount),
          ...(method.code === "card" && paymentCardTypes[method.id]
            ? { card_type: paymentCardTypes[method.id] }
            : {}),
        }];
      })
    : selectedMethod ? [{
        payment_method_id: selectedMethod.id,
        amount: roundMoney(paymentBaseTotal),
        ...(selectedMethod.code === "card" && selectedCardType
          ? { card_type: selectedCardType }
          : {}),
      }] : [];
  const allocatedTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const cardTypesAreValid = !requiresPayment || (combinedPayment
    ? paymentMethods.every((method) => (
        method.code !== "card"
        || Number(paymentAmounts[method.id] || 0) <= 0
        || Boolean(paymentCardTypes[method.id])
      ))
    : selectedMethod?.code !== "card" || Boolean(selectedCardType));
  const allocationMatches = Math.abs(allocatedTotal - paymentBaseTotal) < 0.005 && cardTypesAreValid;
  const cardSurcharge = payments.reduce((sum, payment) => {
    const method = paymentMethods.find((candidate) => candidate.id === payment.payment_method_id);
    const cardType = "card_type" in payment ? payment.card_type ?? "" : "";
    return sum + calculateCardSurcharge(payment.amount, method, cardType);
  }, 0);
  const cardBaseTotal = payments.reduce((sum, payment) => {
    const method = paymentMethods.find((candidate) => candidate.id === payment.payment_method_id);
    return method?.code === "card" ? sum + payment.amount : sum;
  }, 0);
  const cardPosnetTotal = roundMoney(cardBaseTotal + cardSurcharge);
  const total = roundMoney(paymentBaseTotal + cardSurcharge);
  const selectedSurchargePercentage = cardSurchargePercentage(selectedMethod, selectedCardType);

  function replaceCart(nextCart: SaleCartLine[]) {
    cartRef.current = nextCart;
    setCartState(nextCart);
  }

  function showScanFeedback(feedback: Omit<ScanFeedback, "id">) {
    scanFeedbackIdRef.current += 1;
    setScanFeedback({ ...feedback, id: scanFeedbackIdRef.current });
  }

  function refocusScanner() {
    window.requestAnimationFrame(() => {
      scannerInputRef.current?.focus();
      scannerInputRef.current?.select();
    });
  }

  function addProduct(product: SaleProduct, refocus = true) {
    const result = addProductUnit(cartRef.current, product);
    if (result.status === "inactive") {
      showScanFeedback({
        tone: "error",
        title: "Producto inactivo",
        detail: `${product.name} existe, pero no está habilitado para la venta.`,
      });
    } else if (result.status === "without_stock") {
      showScanFeedback({
        tone: "error",
        title: "Producto sin stock",
        detail: `${product.name} fue encontrado, pero no posee stock disponible.`,
      });
    } else if (result.status === "insufficient_stock") {
      showScanFeedback({
        tone: "error",
        title: "Stock insuficiente",
        detail: `Stock disponible: ${formatQuantity.format(product.current_stock)} ${product.unit}.`,
      });
    } else {
      replaceCart(result.cart);
      showScanFeedback({
        tone: "success",
        title: result.status === "added" ? "Producto agregado" : "Cantidad actualizada",
        detail: `${product.name} · ${ars.format(product.retail_price)}`,
      });
    }
    if (refocus) refocusScanner();
  }

  function handleScannerKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();

    const code = normalizeScannedCode(event.currentTarget.value);
    setScanValue("");
    if (!code) {
      refocusScanner();
      return;
    }

    const occurredAt = window.performance.now();
    if (isAccidentalDuplicateScan(lastScanRef.current, code, occurredAt)) {
      refocusScanner();
      return;
    }
    lastScanRef.current = { code, occurredAt };

    const product = findProductByScannedCode(scannerIndex, code);
    if (!product) {
      showScanFeedback({
        code,
        tone: "error",
        title: "Código no encontrado",
        detail: `No se encontró ningún producto con el código ${code}.`,
      });
      refocusScanner();
      return;
    }

    addProduct(product);
  }

  function updateQuantity(productId: string, value: number, refocus = false) {
    const product = cartRef.current.find((line) => line.id === productId);
    if (product && value > product.current_stock) {
      showScanFeedback({
        tone: "error",
        title: "Stock insuficiente",
        detail: `Stock disponible: ${formatQuantity.format(product.current_stock)} ${product.unit}.`,
      });
    }
    const boundedValue = product ? Math.min(Math.max(value, 0), product.current_stock) : value;
    setQuantityInputs((current) => ({
      ...current,
      [productId]: boundedValue > 0 ? String(boundedValue) : "",
    }));
    replaceCart(
      cartRef.current
        .map((line) => line.id === productId
          ? { ...line, quantity: Math.min(Math.max(value, 0), line.current_stock) }
          : line)
        .filter((line) => line.quantity > 0),
    );
    if (refocus) refocusScanner();
  }

  function changeQuantity(productId: string, rawValue: string) {
    const sanitized = sanitizeDecimalInput(rawValue, {
      maxIntegerDigits: 6,
      maxFractionDigits: 3,
    });
    if (sanitized === null) return;

    setQuantityInputs((current) => ({ ...current, [productId]: sanitized }));
    if (sanitized === "" || sanitized === ".") return;

    const value = Number(sanitized);
    if (Number.isFinite(value) && value > 0) updateQuantity(productId, value);
  }

  function changeMoneyInput(
    rawValue: string,
    setter: (value: string) => void,
    maxIntegerDigits = 9,
  ) {
    const sanitized = sanitizeDecimalInput(rawValue, { maxIntegerDigits, maxFractionDigits: 2 });
    if (sanitized !== null) setter(sanitized);
  }

  function handleFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.target === scannerInputRef.current) return;
    if (event.target instanceof HTMLTextAreaElement) return;

    event.preventDefault();
    event.stopPropagation();
  }

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!confirmedSubmitRef.current || submitInFlightRef.current) {
      event.preventDefault();
      return;
    }

    confirmedSubmitRef.current = false;
    submitInFlightRef.current = true;
  }

  function confirmSale() {
    if (pending || submitInFlightRef.current) return;
    confirmedSubmitRef.current = true;
    setConfirmationOpen(false);
    formRef.current?.requestSubmit(actualSubmitRef.current ?? undefined);
  }

  const itemsJson = JSON.stringify(
    cart.map((line) => ({
      product_id: line.id,
      quantity: line.quantity,
    })),
  );

  return (
    <form
      action={action}
      className="sale-workspace"
      onKeyDownCapture={handleFormKeyDown}
      onSubmit={handleFormSubmit}
      ref={formRef}
    >
      {scanFeedback ? (
        <div
          aria-live="polite"
          className={`scan-toast scan-toast-${scanFeedback.tone}`}
          role="status"
        >
          {scanFeedback.tone === "success"
            ? <CheckCircle2 aria-hidden="true" size={20} />
            : <XCircle aria-hidden="true" size={20} />}
          <span>
            <strong>{scanFeedback.title}</strong>
            <small>{scanFeedback.detail}</small>
          </span>
          {scanFeedback.code ? (
            <button
              aria-label="Copiar código"
              className="scan-toast-copy"
              onClick={() => void navigator.clipboard?.writeText(scanFeedback.code ?? "")}
              title="Copiar código"
              type="button"
            >
              <Copy aria-hidden="true" size={16} />
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="sale-catalog" aria-label="Catálogo de productos">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Punto de venta</p>
            <h2>Buscar productos</h2>
          </div>
          <span className="result-count">{availableProductCount} disponibles</span>
        </div>

        <label className="sale-scanner-field">
          <span className="sale-scanner-label">
            <Barcode aria-hidden="true" size={19} />
            <strong>Escanear código de barras</strong>
            <small>Lector listo</small>
          </span>
          <input
            autoComplete="off"
            autoFocus
            enterKeyHint="done"
            inputMode="text"
            maxLength={80}
            onChange={(event) => setScanValue(event.target.value)}
            onKeyDown={handleScannerKeyDown}
            placeholder="Código"
            ref={scannerInputRef}
            spellCheck={false}
            type="text"
            value={scanValue}
          />
        </label>

        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Buscar por nombre, SKU o código de barras</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre, SKU o código de barras"
            type="search"
            value={query}
          />
        </label>

        <div className="sale-product-list">
          {matches.map((product) => (
            <button
              className="sale-product-row"
              key={product.id}
              onClick={() => addProduct(product)}
              type="button"
            >
              <span>
                <strong>{product.name}</strong>
                <small>
                  {product.sku} · Stock {formatQuantity.format(product.current_stock)} {product.unit}
                </small>
              </span>
              <span className="sale-product-price">{ars.format(product.retail_price)}</span>
              <Plus size={18} aria-hidden="true" />
            </button>
          ))}
          {matches.length === 0 && (
            <p className="inline-empty">No encontramos productos para esa búsqueda.</p>
          )}
        </div>
      </section>

      <section className="sale-cart" aria-label="Detalle de la venta">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Venta actual</p>
            <h2>Detalle</h2>
          </div>
          <ShoppingCart size={21} aria-hidden="true" />
        </div>

        <div className="cart-lines">
          {cart.map((line) => (
            <div className="cart-line" key={line.id}>
              <div className="cart-line-copy">
                <strong>{line.name}</strong>
                <small>{ars.format(line.retail_price)} por {line.unit}</small>
              </div>
              <div className="quantity-stepper" aria-label={`Cantidad de ${line.name}`}>
                <button
                  aria-label="Restar una unidad"
                  onClick={() => updateQuantity(line.id, line.quantity - 1, true)}
                  type="button"
                >
                  <Minus size={15} />
                </button>
                <input
                  aria-label="Cantidad"
                  inputMode="decimal"
                  onBlur={() => setQuantityInputs((current) => ({
                    ...current,
                    [line.id]: String(line.quantity),
                  }))}
                  onChange={(event) => changeQuantity(line.id, event.target.value)}
                  type="text"
                  value={quantityInputs[line.id] ?? String(line.quantity)}
                />
                <button
                  aria-label="Sumar una unidad"
                  onClick={() => updateQuantity(line.id, line.quantity + 1, true)}
                  type="button"
                >
                  <Plus size={15} />
                </button>
              </div>
              <strong className="cart-line-total">
                {ars.format(line.quantity * line.retail_price)}
              </strong>
              <button
                className="icon-button icon-button-danger"
                aria-label={`Quitar ${line.name}`}
                onClick={() => updateQuantity(line.id, 0, true)}
                title="Quitar producto"
                type="button"
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          {cart.length === 0 && (
            <div className="cart-empty">
              <ShoppingCart size={24} />
              <p>Agregá productos desde el buscador.</p>
            </div>
          )}
        </div>

        <input name="items" type="hidden" value={itemsJson} />
        <input name="payments" type="hidden" value={JSON.stringify(payments)} />
        <input name="idempotency_key" type="hidden" value={idempotencyKey} />

        <div className="sale-fields">
          <label className="field-label">
            Cliente
            <select className="field-input" name="customer_id" defaultValue="">
              <option value="">Consumidor final</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </label>
          {isNoPaymentSale ? (
            <div className="sale-no-payment sale-field-wide">
              <strong>Sin cobro</strong>
              <span>El descuento cubre el total. La salida de stock se registrará sin impactar caja.</span>
            </div>
          ) : requiresPayment && !combinedPayment ? <label className="field-label">
            Medio de pago
            <select className="field-input" onChange={(event) => {
              setSelectedPaymentMethod(event.target.value);
              if (paymentMethods.find((method) => method.id === event.target.value)?.code !== "card") {
                setSelectedCardType("");
              }
            }} value={selectedPaymentMethod} required>
              <option disabled value="">Seleccionar</option>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>{method.name}</option>
              ))}
            </select>
          </label> : null}
          {requiresPayment && !combinedPayment && selectedMethod?.code === "card" ? (
            <fieldset className="sale-card-type sale-field-wide">
              <legend><CreditCard size={16} /> Tipo de tarjeta</legend>
              <div className="segmented-control">
                <label className={selectedCardType === "debit" ? "is-selected" : ""}>
                  <input checked={selectedCardType === "debit"} name="single_card_type" onChange={() => setSelectedCardType("debit")} type="radio" value="debit" />
                  Débito <small>+{selectedMethod.debit_surcharge_percent}%</small>
                </label>
                <label className={selectedCardType === "credit" ? "is-selected" : ""}>
                  <input checked={selectedCardType === "credit"} name="single_card_type" onChange={() => setSelectedCardType("credit")} type="radio" value="credit" />
                  Crédito <small>+{selectedMethod.credit_surcharge_percent}%</small>
                </label>
              </div>
            </fieldset>
          ) : null}
          {requiresPayment ? <label className="field-label sale-combined-toggle"><span>Pago combinado</span><input checked={combinedPayment} onChange={(event) => setCombinedPayment(event.target.checked)} type="checkbox" /></label> : null}
          {requiresPayment && combinedPayment ? (
            <div className="sale-payment-allocation sale-field-wide">
              <div className="sale-payment-allocation-head">
                <strong>Distribución del importe base</strong>
                <span className={allocationMatches ? "positive-value" : "negative-value"}>{ars.format(allocatedTotal)} / {ars.format(paymentBaseTotal)}</span>
              </div>
              {paymentMethods.map((method) => (
                <div className={`sale-payment-allocation-row ${method.code === "card" ? "sale-payment-card-row" : ""}`} key={method.id}>
                  <label className="field-label">
                    {method.name}
                    <input className="field-input" inputMode="decimal" onChange={(event) => {
                      const sanitized = sanitizeDecimalInput(event.target.value);
                      if (sanitized !== null) {
                        setPaymentAmounts((current) => ({ ...current, [method.id]: sanitized }));
                      }
                    }} type="text" value={paymentAmounts[method.id] ?? ""} />
                  </label>
                  {method.code === "card" && Number(paymentAmounts[method.id] || 0) > 0 ? (
                    <label className="field-label">
                      Tipo
                      <select className="field-input" onChange={(event) => setPaymentCardTypes((current) => ({ ...current, [method.id]: event.target.value as CardType }))} required value={paymentCardTypes[method.id] ?? ""}>
                        <option disabled value="">Seleccionar</option>
                        <option value="debit">Débito (+{method.debit_surcharge_percent}%)</option>
                        <option value="credit">Crédito (+{method.credit_surcharge_percent}%)</option>
                      </select>
                      {paymentCardTypes[method.id] ? (
                        <small className="sale-posnet-preview">
                          Cobrar en Posnet: {ars.format(roundMoney(
                            Number(paymentAmounts[method.id] || 0)
                            + calculateCardSurcharge(
                              Number(paymentAmounts[method.id] || 0),
                              method,
                              paymentCardTypes[method.id],
                            ),
                          ))}
                        </small>
                      ) : null}
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {canChooseDate ? <label className="field-label">Fecha y hora<input className="field-input" defaultValue={localDateTimeValue()} name="occurred_at" type="datetime-local" /></label> : null}
          <label className="field-label">
            Descuento (%)
            <input
              className="field-input"
              inputMode="decimal"
              name="discount"
              onChange={(event) => changeMoneyInput(event.target.value, setDiscountInput, 3)}
              placeholder="0"
              type="text"
              value={discountInput}
            />
            {!discountIsValid ? <span className="mt-1 text-xs text-[var(--danger)]">Ingresá un porcentaje entre 0 y 100.</span> : null}
          </label>
          <label className="field-label">
            Recargo ($)
            <input
              className="field-input"
              inputMode="decimal"
              name="manual_surcharge"
              onChange={(event) => changeMoneyInput(event.target.value, setManualSurchargeInput)}
              placeholder="0"
              type="text"
              value={manualSurchargeInput}
            />
            {!manualSurchargeIsValid ? <span className="mt-1 text-xs text-[var(--danger)]">Ingresá un importe igual o mayor a $0.</span> : null}
          </label>
          <label className="field-label sale-field-wide">
            Nota interna
            <textarea className="field-textarea" maxLength={500} name="notes" placeholder={validDiscount === 100 ? "Ej. Consumo personal del dueño" : undefined} rows={2} />
          </label>
        </div>

        <div className="sale-checkout">
          <div className="sale-totals">
            <span>Subtotal <strong>{ars.format(subtotal)}</strong></span>
            {validDiscount > 0 ? <span>Descuento ({validDiscount}%) <strong>- {ars.format(discountAmount)}</strong></span> : null}
            {validManualSurcharge > 0 ? <span>Recargo <strong>+ {ars.format(validManualSurcharge)}</strong></span> : null}
            {cardSurcharge > 0 ? <span>Recargo por tarjeta{!combinedPayment && selectedSurchargePercentage > 0 ? ` (${selectedSurchargePercentage}%)` : ""} <strong>+ {ars.format(cardSurcharge)}</strong></span> : null}
            {combinedPayment && cardBaseTotal > 0 ? <span>Cobrar con tarjeta en Posnet <strong>{ars.format(cardPosnetTotal)}</strong></span> : null}
            {cardBaseTotal > 0 ? <span className="sale-net-card-entry">Ingreso registrado en Transferencia <strong>{ars.format(cardBaseTotal)}</strong></span> : null}
            <span className="sale-grand-total">{isNoPaymentSale ? "Total sin cobro" : !combinedPayment && cardBaseTotal > 0 ? "Total en Posnet" : "Total a cobrar"} <strong>{ars.format(total)}</strong></span>
          </div>

          {(state.error || state.message) && (
            <div aria-live="polite" className={state.error ? "form-error" : "form-success"}>
              <span>{state.error ?? state.message}</span>
              {state.saleId ? (
                <Link className="sale-receipt-success-link" href={`/app/ventas/${state.saleId}/comprobante`}>
                  <ReceiptText size={16} aria-hidden="true" /> Ver comprobante
                </Link>
              ) : null}
            </div>
          )}

          {requiresPayment && paymentMethods.length === 0 && (
            <p className="form-error">
              No hay medios de pago activos. Un dueño o administrador debe habilitar uno desde Configuración.
            </p>
          )}

          <button className="button button-primary sale-submit" disabled={pending || cart.length === 0 || !discountIsValid || !manualSurchargeIsValid || (requiresPayment && paymentMethods.length === 0) || !allocationMatches || total < 0} onClick={() => {
            setIdempotencyKey((current) => current || crypto.randomUUID());
            setConfirmationOpen(true);
          }} type="button">
            {pending ? "Registrando..." : cart.length === 0 ? "Agregá productos para continuar" : isNoPaymentSale ? "Registrar retiro sin cobro" : `Cobrar ${ars.format(total)}`}
          </button>
          <button aria-hidden="true" className="sr-only" ref={actualSubmitRef} tabIndex={-1} type="submit">Confirmar definitivamente</button>
        </div>
      </section>

      {confirmationOpen ? (
        <div className="sale-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmationOpen(false);
        }}>
          <section aria-labelledby="sale-confirmation-title" aria-modal="true" className="sale-confirmation-dialog" role="dialog">
            <div className="sale-confirmation-icon"><ShieldCheck aria-hidden="true" size={22} /></div>
            <div>
              <p className="eyebrow">Revisión final</p>
              <h2 id="sale-confirmation-title">¿Confirmar esta venta?</h2>
              <p>La venta, el stock y la caja se registrarán recién al confirmar definitivamente.</p>
            </div>
            <dl className="sale-confirmation-summary">
              <div><dt>Productos</dt><dd>{formatQuantity.format(cart.reduce((sum, line) => sum + line.quantity, 0))}</dd></div>
              <div><dt>Medio de pago</dt><dd>{isNoPaymentSale ? "Sin cobro" : payments.map((payment) => {
                const method = paymentMethods.find((candidate) => candidate.id === payment.payment_method_id);
                const cardType = "card_type" in payment ? payment.card_type : undefined;
                return `${method?.name ?? "Pago"}${cardType === "debit" ? " débito" : cardType === "credit" ? " crédito" : ""}`;
              }).join(" + ")}</dd></div>
              <div className="sale-confirmation-total"><dt>Total</dt><dd>{ars.format(total)}</dd></div>
            </dl>
            <div className="sale-confirmation-actions">
              <button className="button button-secondary" disabled={pending} onClick={() => setConfirmationOpen(false)} type="button">Volver</button>
              <button className="button button-primary" disabled={pending || !idempotencyKey} onClick={confirmSale} type="button">{pending ? "Registrando..." : "Confirmar venta"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </form>
  );
}

export function SaleWorkspace(props: {
  products: SaleProduct[];
  customers: Option[];
  paymentMethods: PaymentMethod[];
  canChooseDate: boolean;
}) {
  const [state, action, pending] = useActionState(createSaleAction, initialState);
  return (
    <SaleEditor
      {...props}
      action={action}
      key={state.saleId ?? "new-sale"}
      pending={pending}
      state={state}
    />
  );
}
