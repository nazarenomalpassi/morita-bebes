import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReceiptActions } from "@/components/receipts/receipt-actions";
import { SaleReceiptDocument } from "@/components/receipts/sale-receipt";
import { CancelSaleControl } from "@/components/sales/cancel-sale-control";
import { dateTime } from "@/lib/format";
import { getSaleReceipt } from "@/lib/receipts/get-sale-receipt";
import { receiptFileName, receiptNumberLabel } from "@/lib/receipts/sale-receipt";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SaleReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();
  const receipt = await getSaleReceipt(supabase, id);
  if (!receipt) notFound();

  const downloadUrl = `/api/ventas/${id}/comprobante`;

  return (
    <div className="receipt-preview-page">
      <header className="receipt-preview-toolbar" data-print-hidden>
        <div>
          <Link className="receipt-back-link" href="/app/ventas">
            <ArrowLeft size={17} aria-hidden="true" /> Volver a ventas
          </Link>
          <h1>Comprobante {receiptNumberLabel(receipt)}</h1>
          <p>Vista previa del documento que recibirá el cliente.</p>
        </div>
        <div className="receipt-toolbar-actions">
          <ReceiptActions downloadUrl={downloadUrl} fileName={receiptFileName(receipt)} />
          {receipt.status === "completed" ? <CancelSaleControl saleId={id} /> : null}
        </div>
      </header>
      {receipt.status === "cancelled" ? (
        <section className="sale-cancellation-audit" data-print-hidden>
          <strong>Venta anulada</strong>
          <span>Anulada por: {receipt.cancelled_by_name ?? "Usuario autorizado"}</span>
          {receipt.cancelled_at ? <span>Fecha: {dateTime.format(new Date(receipt.cancelled_at))}</span> : null}
          <span>Motivo: {receipt.cancellation_reason ?? "No informado"}</span>
        </section>
      ) : null}
      <div className="receipt-preview-canvas">
        <SaleReceiptDocument receipt={receipt} />
      </div>
    </div>
  );
}
