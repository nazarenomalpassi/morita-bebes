import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { SaleReceipt } from "./sale-receipt";

vi.mock("server-only", () => ({}));

function receiptWithItems(count: number): SaleReceipt {
  const items = Array.from({ length: count }, (_, index) => ({
    name: `Producto ${index + 1} con una descripción extensa que debe adaptarse sin cortar información importante`,
    sku: `SKU-${index + 1}`,
    quantity: index % 2 === 0 ? 1 : 3,
    unit_price: 4500,
    discount: index === 0 ? 500 : 0,
    line_total: (index % 2 === 0 ? 1 : 3) * 4500 - (index === 0 ? 500 : 0),
  }));
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const lineDiscount = items.reduce((sum, item) => sum + item.discount, 0);

  return {
    display_number: "MULTI-001",
    source: "system",
    status: "completed",
    occurred_at: "2026-08-10T19:30:00-03:00",
    original_time_known: true,
    item_detail_status: "complete",
    subtotal: subtotal - lineDiscount,
    discount: 1000,
    vat_10_5: 0,
    vat_21: 0,
    rounding_adjustment: 0,
    manual_surcharge: 0,
    surcharge: 0,
    total: subtotal - lineDiscount - 1000,
    customer: null,
    seller_name: "Vendedora",
    payments: [{ method: "Transferencia", amount: subtotal - lineDiscount - 1000 }],
    business: { name: "Morita Bebés" },
    items,
  };
}

describe("sale receipt PDF", () => {
  it("generates a lightweight one-page PDF", async () => {
    const { generateSaleReceiptPdf } = await import("./pdf");
    const brandDirectory = path.join(process.cwd(), "public", "brand");
    const logo = await readFile(path.join(brandDirectory, "morita-logo.svg"), "utf8");
    const fonts = {
      regular: await readFile(path.join(brandDirectory, "morita-body-regular.ttf")),
      bold: await readFile(path.join(brandDirectory, "morita-body-bold.ttf")),
      script: await readFile(path.join(brandDirectory, "morita-script.ttf")),
    };
    const pdf = await generateSaleReceiptPdf(receiptWithItems(1), logo, fonts);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(2000);
    expect(pdf.length).toBeLessThan(250000);
  });

  it("adds pages for a long product list", async () => {
    const { generateSaleReceiptPdf } = await import("./pdf");
    const brandDirectory = path.join(process.cwd(), "public", "brand");
    const logo = await readFile(path.join(brandDirectory, "morita-logo.svg"), "utf8");
    const fonts = {
      regular: await readFile(path.join(brandDirectory, "morita-body-regular.ttf")),
      bold: await readFile(path.join(brandDirectory, "morita-body-bold.ttf")),
      script: await readFile(path.join(brandDirectory, "morita-script.ttf")),
    };
    const pdf = await generateSaleReceiptPdf(receiptWithItems(55), logo, fonts);
    const objects = pdf.toString("latin1");
    const pages = objects.match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
    expect(pdf.length).toBeLessThan(1000000);
    if (process.env.MORITA_WRITE_PDF_FIXTURE === "1") {
      const outputDirectory = path.join(process.cwd(), "tmp", "pdfs");
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(path.join(outputDirectory, "comprobante-multipagina-qa.pdf"), pdf);
    }
  });
});
