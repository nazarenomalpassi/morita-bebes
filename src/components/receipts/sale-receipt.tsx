import Image from "next/image";

import {
  receiptArs,
  receiptDateParts,
  receiptNumberLabel,
  receiptQuantity,
  type SaleReceipt,
} from "@/lib/receipts/sale-receipt";

function TotalRow({ label, value, negative = false }: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div className="receipt-total-row">
      <span>{label}</span>
      <strong>{negative ? `- ${receiptArs.format(value)}` : receiptArs.format(value)}</strong>
    </div>
  );
}

export function SaleReceiptDocument({ receipt }: { receipt: SaleReceipt }) {
  const { date, time } = receiptDateParts(receipt);
  const hasTaxComponents = receipt.vat_10_5 !== 0 || receipt.vat_21 !== 0;

  return (
    <article className="sale-receipt-document">
      <div className="receipt-top-accent" />
      <header className="receipt-header">
        <div className="receipt-brand">
          <Image
            alt="Logo de Morita Bebés"
            className="receipt-logo"
            height={88}
            priority
            src="/brand/morita-logo.svg"
            width={88}
          />
          <div>
            <span className="receipt-brand-name">Morita Bebés</span>
            <p>Productos que miman</p>
          </div>
        </div>
        <div className="receipt-identity">
          <span>Comprobante de venta</span>
          <strong>{receiptNumberLabel(receipt)}</strong>
          <p>{date}{time ? ` · ${time} h` : ""}</p>
        </div>
      </header>

      {receipt.status === "cancelled" ? (
        <div className="receipt-cancelled">Venta anulada · Este comprobante no representa una operación vigente</div>
      ) : null}

      <section className="receipt-context-grid">
        <div>
          <span className="receipt-section-label">Cliente</span>
          <strong>{receipt.customer?.name ?? "Consumidor final"}</strong>
          {receipt.customer?.phone ? <p>{receipt.customer.phone}</p> : null}
        </div>
        {receipt.payments.length > 0 ? (
          <div>
            <span className="receipt-section-label">Medio de pago</span>
            {receipt.payments.map((payment, index) => (
              <strong key={`${payment.method}-${index}`}>{payment.method}</strong>
            ))}
          </div>
        ) : null}
        {receipt.seller_name ? (
          <div>
            <span className="receipt-section-label">Atendido por</span>
            <strong>{receipt.seller_name}</strong>
          </div>
        ) : null}
      </section>

      <section className="receipt-detail">
        <div className="receipt-detail-heading">
          <span>Detalle de la compra</span>
          <span>{receipt.items.length} {receipt.items.length === 1 ? "producto" : "productos"}</span>
        </div>

        {receipt.items.length > 0 ? (
          <div className="receipt-items">
            <div className="receipt-item receipt-item-head" aria-hidden="true">
              <span>Producto</span><span>Cantidad</span><span>Precio unitario</span><span>Subtotal</span>
            </div>
            {receipt.items.map((item, index) => (
              <div className="receipt-item" key={`${item.sku ?? item.name}-${index}`}>
                <div className="receipt-product-copy">
                  <strong>{item.name}</strong>
                  {item.sku ? <small>SKU {item.sku}</small> : null}
                  {item.discount > 0 ? <small>Descuento del producto: - {receiptArs.format(item.discount)}</small> : null}
                </div>
                <span className="receipt-item-quantity">{receiptQuantity.format(item.quantity)}</span>
                <span>{receiptArs.format(item.unit_price)}</span>
                <strong>{receiptArs.format(item.line_total)}</strong>
                <p className="receipt-item-mobile-equation">
                  {receiptQuantity.format(item.quantity)} × {receiptArs.format(item.unit_price)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="receipt-missing-detail">
            <strong>Detalle no disponible en el archivo histórico</strong>
            <p>El sistema anterior no proporcionó productos ni cantidades para esta venta. El comprobante conserva exactamente los importes y datos que sí fueron recuperados.</p>
          </div>
        )}
      </section>

      <section className="receipt-summary">
        <div className="receipt-payment-summary">
          {receipt.payments.length > 1 ? (
            <>
              <span className="receipt-section-label">Pagos</span>
              {receipt.payments.map((payment, index) => (
                <p key={`${payment.method}-amount-${index}`}>
                  <span>{payment.method}</span><strong>{receiptArs.format(payment.amount)}</strong>
                </p>
              ))}
            </>
          ) : null}
          {hasTaxComponents ? (
            <small>La venta histórica incluye componentes impositivos informados por el sistema anterior.</small>
          ) : null}
        </div>
        <div className="receipt-totals">
          <TotalRow label="Subtotal" value={receipt.subtotal} />
          {receipt.vat_10_5 !== 0 ? <TotalRow label="Impuestos informados 10,5%" value={receipt.vat_10_5} /> : null}
          {receipt.vat_21 !== 0 ? <TotalRow label="Impuestos informados 21%" value={receipt.vat_21} /> : null}
          {receipt.rounding_adjustment !== 0 ? <TotalRow label="Ajuste" value={receipt.rounding_adjustment} /> : null}
          {receipt.discount > 0 ? <TotalRow label={`Descuento${receipt.discount_percent != null ? ` (${receipt.discount_percent}%)` : ""}`} negative value={receipt.discount} /> : null}
          {receipt.manual_surcharge > 0 ? <TotalRow label="Recargo" value={receipt.manual_surcharge} /> : null}
          {receipt.surcharge > 0 ? <TotalRow label="Recargo por tarjeta" value={receipt.surcharge} /> : null}
          <div className="receipt-grand-total">
            <span>Total</span>
            <strong>{receiptArs.format(receipt.total)}</strong>
          </div>
        </div>
      </section>

      <footer className="receipt-footer">
        <div>
          <strong>¡Gracias por elegir Morita Bebés!</strong>
          {receipt.business.address ? <span>{receipt.business.address}</span> : null}
          {receipt.business.whatsapp ? <span>WhatsApp {receipt.business.whatsapp}</span> : null}
        </div>
        <p>Comprobante interno de venta · No válido como factura fiscal.</p>
      </footer>
    </article>
  );
}
