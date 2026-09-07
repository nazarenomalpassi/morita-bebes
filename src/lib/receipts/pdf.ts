import "server-only";

import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";

import {
  receiptArs,
  receiptDateParts,
  receiptNumberLabel,
  receiptQuantity,
  type SaleReceipt,
} from "./sale-receipt";

const COLORS = {
  paper: "#FBF9F5",
  white: "#FFFFFF",
  ink: "#302B3D",
  muted: "#756F82",
  line: "#E7E2EC",
  lavender: "#B9B4E8",
  rose: "#F8E3DF",
  plum: "#55486F",
  mint: "#CDE8DF",
  danger: "#9D3E45",
};

const PAGE = {
  left: 44,
  right: 551,
  width: 507,
  contentBottom: 746,
};

type Pdf = InstanceType<typeof PDFDocument>;

type ReceiptFonts = {
  regular: Buffer;
  bold: Buffer;
  script: Buffer;
};

function money(value: number) {
  return receiptArs.format(value).replace(/\u00a0/g, " ");
}

function drawHeader(doc: Pdf, receipt: SaleReceipt, logoSvg: string, continued = false) {
  doc.rect(0, 0, doc.page.width, 12).fill(COLORS.lavender);
  SVGtoPDF(doc, logoSvg, PAGE.left, 28, {
    width: 68,
    height: 68,
    preserveAspectRatio: "xMidYMid meet",
    fontCallback: (family) => family.includes("Morita Script") ? "MoritaScript" : "MoritaRegular",
    warningCallback: () => undefined,
  });

  doc.fillColor(COLORS.ink).font("MoritaBold").fontSize(20)
    .text("Morita Bebés", 126, 38, { width: 230 });
  doc.fillColor(COLORS.muted).font("MoritaRegular").fontSize(9)
    .text("Productos que miman", 126, 65, { width: 230 });

  const { date, time } = receiptDateParts(receipt);
  doc.fillColor(COLORS.plum).font("MoritaBold").fontSize(9)
    .text(continued ? "COMPROBANTE · CONTINUACIÓN" : "COMPROBANTE DE VENTA", 365, 35, { width: 186, align: "right" });
  doc.fillColor(COLORS.ink).font("MoritaBold").fontSize(16)
    .text(receiptNumberLabel(receipt), 365, 52, { width: 186, align: "right" });
  doc.fillColor(COLORS.muted).font("MoritaRegular").fontSize(9)
    .text(`${date}${time ? ` · ${time} h` : ""}`, 365, 75, { width: 186, align: "right" });

  doc.moveTo(PAGE.left, 112).lineTo(PAGE.right, 112).lineWidth(1).stroke(COLORS.line);
  return 128;
}

function drawTableHeader(doc: Pdf, y: number) {
  doc.roundedRect(PAGE.left, y, PAGE.width, 27, 4).fill(COLORS.plum);
  doc.fillColor(COLORS.white).font("MoritaBold").fontSize(8);
  doc.text("PRODUCTO", PAGE.left + 10, y + 9, { width: 235 });
  doc.text("CANT.", 296, y + 9, { width: 48, align: "right" });
  doc.text("PRECIO UNIT.", 356, y + 9, { width: 82, align: "right" });
  doc.text("SUBTOTAL", 450, y + 9, { width: 91, align: "right" });
  return y + 27;
}

function drawFooter(doc: Pdf, pageNumber: number, pageCount: number) {
  const y = 775;
  doc.moveTo(PAGE.left, y).lineTo(PAGE.right, y).lineWidth(1).stroke(COLORS.line);
  doc.fillColor(COLORS.plum).font("MoritaBold").fontSize(8)
    .text("¡Gracias por elegir Morita Bebés!", PAGE.left, y + 11, { width: 235 });
  doc.fillColor(COLORS.muted).font("MoritaRegular").fontSize(7.5)
    .text("Comprobante interno de venta · No válido como factura fiscal.", 190, y + 11, { width: 270, align: "center" });
  doc.text(`Página ${pageNumber} de ${pageCount}`, 465, y + 11, { width: 86, align: "right" });
}

function addContinuationPage(doc: Pdf, receipt: SaleReceipt, logoSvg: string) {
  doc.addPage();
  let y = drawHeader(doc, receipt, logoSvg, true);
  y = drawTableHeader(doc, y);
  return y;
}

function drawInfo(doc: Pdf, receipt: SaleReceipt, y: number) {
  const hasSeller = Boolean(receipt.seller_name);
  const columns = hasSeller ? 3 : 2;
  const gap = 12;
  const width = (PAGE.width - gap * (columns - 1)) / columns;
  const boxes = [
    { label: "CLIENTE", primary: receipt.customer?.name ?? "Consumidor final", secondary: receipt.customer?.phone },
    { label: "MEDIO DE PAGO", primary: receipt.payments.map((payment) => payment.method).join(" + ") || "Sin indicar" },
    ...(hasSeller ? [{ label: "ATENDIDO POR", primary: receipt.seller_name ?? "" }] : []),
  ];
  const height = 58;

  boxes.forEach((box, index) => {
    const x = PAGE.left + index * (width + gap);
    doc.roundedRect(x, y, width, height, 5).fillAndStroke(COLORS.paper, COLORS.line);
    doc.fillColor(COLORS.muted).font("MoritaBold").fontSize(7)
      .text(box.label, x + 10, y + 10, { width: width - 20 });
    doc.fillColor(COLORS.ink).font("MoritaBold").fontSize(9)
      .text(box.primary, x + 10, y + 25, { width: width - 20, height: 14, ellipsis: true });
    if (box.secondary) {
      doc.fillColor(COLORS.muted).font("MoritaRegular").fontSize(7.5)
        .text(box.secondary, x + 10, y + 42, { width: width - 20, height: 10, ellipsis: true });
    }
  });

  return y + height + 22;
}

function drawItems(doc: Pdf, receipt: SaleReceipt, logoSvg: string, startY: number) {
  let y = drawTableHeader(doc, startY);

  if (receipt.items.length === 0) {
    doc.roundedRect(PAGE.left, y + 14, PAGE.width, 78, 5).fillAndStroke(COLORS.paper, COLORS.line);
    doc.fillColor(COLORS.ink).font("MoritaBold").fontSize(10)
      .text("Detalle no disponible en el archivo histórico", PAGE.left + 14, y + 28, { width: PAGE.width - 28 });
    doc.fillColor(COLORS.muted).font("MoritaRegular").fontSize(8.5)
      .text("El sistema anterior no proporcionó productos ni cantidades para esta venta. Este comprobante conserva exactamente los importes y datos recuperados.", PAGE.left + 14, y + 47, { width: PAGE.width - 28, lineGap: 2 });
    return y + 108;
  }

  for (const item of receipt.items) {
    doc.font("MoritaBold").fontSize(9);
    const nameHeight = doc.heightOfString(item.name, { width: 235, lineGap: 1 });
    const secondaryLines = (item.sku ? 1 : 0) + (item.discount > 0 ? 1 : 0);
    const rowHeight = Math.max(42, 18 + nameHeight + secondaryLines * 11);

    if (y + rowHeight > PAGE.contentBottom) {
      y = addContinuationPage(doc, receipt, logoSvg);
    }

    doc.rect(PAGE.left, y, PAGE.width, rowHeight).fill(COLORS.white);
    doc.moveTo(PAGE.left, y + rowHeight).lineTo(PAGE.right, y + rowHeight).lineWidth(0.7).stroke(COLORS.line);

    let copyY = y + 10;
    doc.fillColor(COLORS.ink).font("MoritaBold").fontSize(9)
      .text(item.name, PAGE.left + 10, copyY, { width: 235, lineGap: 1 });
    copyY += nameHeight + 3;
    if (item.sku) {
      doc.fillColor(COLORS.muted).font("MoritaRegular").fontSize(7)
        .text(`SKU ${item.sku}`, PAGE.left + 10, copyY, { width: 235 });
      copyY += 10;
    }
    if (item.discount > 0) {
      doc.fillColor(COLORS.danger).font("MoritaRegular").fontSize(7)
        .text(`Descuento del producto: - ${money(item.discount)}`, PAGE.left + 10, copyY, { width: 235 });
    }

    doc.fillColor(COLORS.ink).font("MoritaRegular").fontSize(8.5)
      .text(receiptQuantity.format(item.quantity), 296, y + 14, { width: 48, align: "right" });
    doc.text(money(item.unit_price), 356, y + 14, { width: 82, align: "right" });
    doc.font("MoritaBold").text(money(item.line_total), 450, y + 14, { width: 91, align: "right" });
    y += rowHeight;
  }

  return y + 18;
}

function drawSummary(doc: Pdf, receipt: SaleReceipt, logoSvg: string, startY: number) {
  const amountRows = [
    ["Subtotal", receipt.subtotal, false] as const,
    ...(receipt.vat_10_5 !== 0 ? [["Impuestos informados 10,5%", receipt.vat_10_5, false] as const] : []),
    ...(receipt.vat_21 !== 0 ? [["Impuestos informados 21%", receipt.vat_21, false] as const] : []),
    ...(receipt.rounding_adjustment !== 0 ? [["Ajuste", receipt.rounding_adjustment, false] as const] : []),
    ...(receipt.discount > 0 ? [[`Descuento${receipt.discount_percent != null ? ` (${receipt.discount_percent}%)` : ""}`, receipt.discount, true] as const] : []),
    ...(receipt.manual_surcharge > 0 ? [["Recargo", receipt.manual_surcharge, false] as const] : []),
    ...(receipt.surcharge > 0 ? [["Recargo por tarjeta", receipt.surcharge, false] as const] : []),
  ];
  const requiredHeight = 96 + amountRows.length * 18;
  let y = startY;
  if (y + requiredHeight > PAGE.contentBottom) {
    doc.addPage();
    y = drawHeader(doc, receipt, logoSvg, true);
  }

  if (receipt.status === "cancelled") {
    doc.roundedRect(PAGE.left, y, 180, 28, 4).fill("#F9E8E8");
    doc.fillColor(COLORS.danger).font("MoritaBold").fontSize(9)
      .text("VENTA ANULADA", PAGE.left + 10, y + 10, { width: 160 });
  } else if (receipt.payments.length > 0) {
    doc.fillColor(COLORS.muted).font("MoritaBold").fontSize(7)
      .text("MEDIO DE PAGO", PAGE.left, y + 4, { width: 190 });
    doc.fillColor(COLORS.ink).font("MoritaBold").fontSize(10)
      .text(receipt.payments.map((payment) => payment.method).join(" + "), PAGE.left, y + 20, { width: 205 });
  }

  const x = 320;
  let totalY = y;
  for (const [label, value, negative] of amountRows) {
    doc.fillColor(COLORS.muted).font("MoritaRegular").fontSize(8.5)
      .text(label, x, totalY, { width: 112 });
    doc.fillColor(negative ? COLORS.danger : COLORS.ink).font("MoritaBold").fontSize(8.5)
      .text(`${negative ? "- " : ""}${money(value)}`, 435, totalY, { width: 116, align: "right" });
    totalY += 18;
  }

  doc.roundedRect(x, totalY + 4, 231, 58, 5).fill(COLORS.plum);
  doc.fillColor(COLORS.rose).font("MoritaBold").fontSize(9)
    .text("TOTAL", x + 14, totalY + 15, { width: 65 });
  doc.fillColor(COLORS.white).font("MoritaBold").fontSize(18)
    .text(money(receipt.total), x + 74, totalY + 12, { width: 143, align: "right" });
}

export async function generateSaleReceiptPdf(receipt: SaleReceipt, logoSvg: string, fonts: ReceiptFonts) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    compress: true,
    // PDFKit accepts a font Buffer at runtime, although its public option type only declares strings.
    font: fonts.regular as unknown as string,
    info: {
      Title: `Comprobante interno de venta ${receiptNumberLabel(receipt)}`,
      Author: "Morita Bebés",
      Subject: "Comprobante interno de venta - No válido como factura fiscal",
    },
  });

  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.registerFont("MoritaRegular", fonts.regular);
  doc.registerFont("MoritaBold", fonts.bold);
  doc.registerFont("MoritaScript", fonts.script);

  let y = drawHeader(doc, receipt, logoSvg);
  if (receipt.status === "cancelled") {
    doc.roundedRect(PAGE.left, y, PAGE.width, 26, 4).fill("#F9E8E8");
    doc.fillColor(COLORS.danger).font("MoritaBold").fontSize(8.5)
      .text("VENTA ANULADA", PAGE.left + 10, y + 9, { width: PAGE.width - 20, align: "center" });
    y += 38;
  }
  y = drawInfo(doc, receipt, y);
  y = drawItems(doc, receipt, logoSvg, y);
  drawSummary(doc, receipt, logoSvg, y);

  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    drawFooter(doc, page - range.start + 1, range.count);
  }

  doc.end();
  return result;
}
