import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  analyzeInventoryWorkbook,
  InventoryWorkbookError,
} from "./inventory";

const headers = [
  "CODIGO",
  "DETALLE",
  "FAMILIA",
  "PROVEEDOR",
  "MARCA",
  "P.COSTO",
  "P.VENTA",
  "IVA",
  "P.LISTA2",
  "P.LISTA3",
  "P.MAYOR",
  "STOCK",
  "STOCK MIN",
  "STOCK IDEAL",
];
const auditedInventoryPath = "C:/Users/nazar/Downloads/inventario.xlsx";

async function workbookBuffer(rows: Array<Array<string | number | null>>, customHeaders = headers) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja1");
  sheet.addRow(customHeaders);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("analyzeInventoryWorkbook", () => {
  it("normalizes the legacy structure without mutating stock", async () => {
    const buffer = await workbookBuffer([
      [null, null, null, null, null, 0, 0, 21, 0, 0, 0, 0, 0, 0],
      ["DUP", "Primer producto", "ARTICULOS", "PROVEEDOR", null, 100, 150, 21, 0, 0, 0, 2, 0, 0],
      ["DUP", "Segundo producto", "TELA", null, null, 100, 150, 21, 0, 0, 0, 1, 0, 0],
      [7790250042068, "Babysec paquete", "PANALES", "PROVEEDOR", null, 100, 160, 21, 100, 100, 100, 3, 0, 0],
      ["NEG", "Chicco producto de prueba", null, null, null, 0, 250, 21, 0, 0, 0, -1, 0, 0],
    ]);

    const analysis = await analyzeInventoryWorkbook(buffer, "inventario.xlsx");

    expect(analysis.headers).toEqual(headers);
    expect(analysis.summary).toMatchObject({
      generatedSkus: 1,
      ghostRows: 1,
      gtinValid: 1,
      negativeStock: 1,
      productRows: 4,
      sourceRows: 5,
      zeroCost: 1,
    });
    expect(analysis.products[0].sku).toBe("DUP");
    expect(analysis.products[0].barcode).toBe("DUP");
    expect(analysis.products[1]).toMatchObject({ categoryName: "Tela", sku: "LEG-R4" });
    expect(analysis.products[2].barcode).toBe("7790250042068");
    expect(analysis.products[3]).toMatchObject({
      brandName: "Chicco",
      inferredBrand: true,
      isActive: false,
      openingStock: 0,
    });
    expect(analysis.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "generated_sku_duplicate_code", rowNumber: 4 }),
        expect.objectContaining({ code: "negative_stock", rowNumber: 6, severity: "error" }),
        expect.objectContaining({ code: "zero_cost", rowNumber: 6, severity: "error" }),
      ]),
    );
  });

  it("preserves text identifiers and rejects scientific notation", async () => {
    const buffer = await workbookBuffer([
      ["  07791234567890\t", "Código con cero", "ARTICULOS", null, null, 100, 150, 21, 0, 0, 0, 1, 0, 0],
      ["7.79123E+12", "Código científico", "ARTICULOS", null, null, 100, 150, 21, 0, 0, 0, 1, 0, 0],
    ]);

    const analysis = await analyzeInventoryWorkbook(buffer, "identificadores.xlsx");

    expect(analysis.products[0]).toMatchObject({
      barcode: "07791234567890",
      sku: "07791234567890",
    });
    expect(analysis.products[1]).toMatchObject({ barcode: null, sku: "LEG-R3" });
    expect(analysis.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "normalized_code_characters", rowNumber: 2 }),
      expect.objectContaining({ code: "scientific_notation_code", rowNumber: 3, severity: "error" }),
    ]));
  });

  it("rejects a workbook without the exact legacy headers", async () => {
    const invalidHeaders = [...headers];
    invalidHeaders[1] = "NOMBRE";
    const buffer = await workbookBuffer([], invalidHeaders);

    await expect(analyzeInventoryWorkbook(buffer, "otro.xlsx")).rejects.toBeInstanceOf(
      InventoryWorkbookError,
    );
  });

  it.runIf(existsSync(auditedInventoryPath))(
    "keeps the audited metrics of inventario.xlsx stable",
    async () => {
      const analysis = await analyzeInventoryWorkbook(
        await readFile(auditedInventoryPath),
        "inventario.xlsx",
      );

      expect(analysis.summary).toMatchObject({
        generatedSkus: 12,
        gtinValid: 185,
        inactiveProducts: 8,
        missingCategory: 116,
        missingStock: 1,
        missingSupplier: 403,
        negativeStock: 11,
        positiveStockProducts: 315,
        positiveStockUnits: 766,
        productRows: 403,
      });
      expect(analysis.summary.ivaValues).toEqual({ "21": 403 });
    },
  );
});
