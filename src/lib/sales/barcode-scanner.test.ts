import { describe, expect, it } from "vitest";

import {
  addProductUnit,
  createProductCodeIndex,
  findProductByScannedCode,
  isAccidentalDuplicateScan,
  normalizeScannedCode,
  type SaleProduct,
} from "./barcode-scanner";

const mamadera: SaleProduct = {
  id: "mamadera",
  name: "Mamadera Avent 260 ml",
  sku: "MAM-AVENT-260",
  barcode: "07791234567890",
  current_stock: 2,
  retail_price: 22_000,
  is_active: true,
  unit: "unidad",
};

const chupete: SaleProduct = {
  id: "chupete",
  name: "Chupete Avent 0-6 meses",
  sku: "7799999999991",
  barcode: null,
  current_stock: 4,
  is_active: true,
  retail_price: 9_500,
  unit: "unidad",
};

describe("barcode scanner", () => {
  it("preserves leading zeroes while trimming scanner whitespace", () => {
    expect(normalizeScannedCode("  07791234567890\r\n")).toBe("07791234567890");
  });

  it("finds an exact barcode and falls back to an exact SKU", () => {
    const index = createProductCodeIndex([mamadera, chupete]);
    expect(findProductByScannedCode(index, mamadera.barcode!)).toBe(mamadera);
    expect(findProductByScannedCode(index, chupete.sku)).toBe(chupete);
    expect(findProductByScannedCode(index, "779999999999")).toBeNull();
  });

  it("prioritizes barcode when a code also exists as another SKU", () => {
    const conflict = { ...chupete, id: "conflict", sku: mamadera.barcode! };
    const index = createProductCodeIndex([conflict, mamadera]);
    expect(findProductByScannedCode(index, mamadera.barcode!)).toBe(mamadera);
  });

  it("adds two different scanned products without replacing either", () => {
    const first = addProductUnit([], mamadera);
    const second = addProductUnit(first.cart, chupete);
    expect(second.cart.map((line) => line.id)).toEqual([mamadera.id, chupete.id]);
  });

  it("increments the existing line when the same product is scanned twice", () => {
    const first = addProductUnit([], mamadera);
    const second = addProductUnit(first.cart, mamadera);
    expect(second.status).toBe("incremented");
    expect(second.cart).toHaveLength(1);
    expect(second.cart[0].quantity).toBe(2);
  });

  it("recognizes but blocks a product without stock", () => {
    const result = addProductUnit([], { ...mamadera, current_stock: 0 });
    expect(result.status).toBe("without_stock");
    expect(result.cart).toEqual([]);
  });

  it("recognizes but blocks an inactive product", () => {
    const result = addProductUnit([], { ...mamadera, is_active: false });
    expect(result.status).toBe("inactive");
    expect(result.cart).toEqual([]);
  });

  it("blocks an additional scan beyond available stock", () => {
    const first = addProductUnit([], { ...mamadera, current_stock: 1 });
    const second = addProductUnit(first.cart, { ...mamadera, current_stock: 1 });
    expect(second.status).toBe("insufficient_stock");
    expect(second.cart[0].quantity).toBe(1);
  });

  it("suppresses only an immediate duplicate Enter event", () => {
    const previous = { code: mamadera.barcode!, occurredAt: 1_000 };
    expect(isAccidentalDuplicateScan(previous, mamadera.barcode!, 1_050)).toBe(true);
    expect(isAccidentalDuplicateScan(previous, mamadera.barcode!, 1_250)).toBe(false);
    expect(isAccidentalDuplicateScan(previous, chupete.sku, 1_050)).toBe(false);
  });
});
