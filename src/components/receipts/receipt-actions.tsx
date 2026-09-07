"use client";

import { Download, Printer, Share2 } from "lucide-react";
import { useState } from "react";

export function ReceiptActions({ downloadUrl, fileName }: {
  downloadUrl: string;
  fileName: string;
}) {
  const [sharing, setSharing] = useState(false);

  async function shareReceipt() {
    setSharing(true);
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error("No se pudo descargar el comprobante.");
      const file = new File([await response.blob()], fileName, { type: "application/pdf" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Comprobante de Morita Bebés",
          files: [file],
        });
        return;
      }

      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        window.alert(error instanceof Error ? error.message : "No se pudo compartir el comprobante.");
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="receipt-actions" data-print-hidden>
      <a className="button button-primary" download={fileName} href={downloadUrl}>
        <Download size={17} aria-hidden="true" /> Descargar PDF
      </a>
      <button className="button button-secondary" onClick={() => window.print()} type="button">
        <Printer size={17} aria-hidden="true" /> Imprimir
      </button>
      <button className="button button-secondary" disabled={sharing} onClick={shareReceipt} type="button">
        <Share2 size={17} aria-hidden="true" /> {sharing ? "Preparando..." : "Compartir"}
      </button>
    </div>
  );
}
