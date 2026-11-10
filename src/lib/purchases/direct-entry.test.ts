import { describe, expect, it } from "vitest";
import { directPurchaseItemsSchema, entryIdentifierConflict, entryNewProductSchema, filterPurchaseProducts, inventoryEntryItemsSchema, parseDirectPurchaseFields } from "./direct-entry";

const item = { product_id: "22222222-2222-4222-8222-222222222222", quantity: 2.5, unit_cost: 12500.95, retail_price: 18000, wholesale_price: null, original_cost_price: 10000, original_retail_price: 16000, original_wholesale_price: null };

describe("Direct purchase amounts", () => {
  it("accepts Argentine prices, comma quantities and optional wholesale", () => {
    const parsed = parseDirectPurchaseFields({ quantity: "2,5", cost: "12.500,95", retail: "18000.50", wholesale: "" });
    expect(parsed).toMatchObject({ valid: true, quantity: 2.5, cost: 12500.95, retail: 18000.50, wholesale: null });
    expect(directPurchaseItemsSchema.safeParse([item]).success).toBe(true);
  });
  it.each(["", "0", "-1", "1e3", "2.0001", "1000001"])("rejects invalid received quantities: %s", (quantity) => {
    const parsed = parseDirectPurchaseFields({ quantity, cost: "1", retail: "2", wholesale: "" });
    expect(parsed.valid).toBe(false);
    expect(parsed.quantity).toBeNull();
  });
  it("rejects invalid costs/prices without converting them to zero", () => {
    const parsed = parseDirectPurchaseFields({ quantity: "1", cost: "1e5", retail: "-20", wholesale: "5,255" });
    expect(Object.keys(parsed.errors)).toEqual(["cost", "retail", "wholesale"]);
    expect(parsed.cost).toBeNull();
    expect(parseDirectPurchaseFields({ quantity: "1", cost: "0", retail: "0", wholesale: "0" }).valid).toBe(true);
  });
  it("rejects duplicated, empty and malformed server payloads", () => {
    expect(directPurchaseItemsSchema.safeParse([item, item]).success).toBe(false);
    expect(directPurchaseItemsSchema.safeParse([]).success).toBe(false);
    expect(directPurchaseItemsSchema.safeParse([{ ...item, quantity: 0 }]).success).toBe(false);
    expect(directPurchaseItemsSchema.safeParse([{ ...item, unit_cost: 12.00001 }]).success).toBe(false);
    expect(directPurchaseItemsSchema.safeParse([{ ...item, wholesale_price: -1 }]).success).toBe(false);
    expect(directPurchaseItemsSchema.safeParse([{ ...item, original_cost_price: undefined }]).success).toBe(false);
  });
});

describe("Incoming purchase search", () => {
  const products = [
    { name: "Pañal Deluxe", sku: "INT-01", barcode: "07791234567890", stock: 0 },
    { name: "Pañal Confort", sku: "INT-02", barcode: null, stock: 4 },
  ];
  it("searches tokens, accents, SKU and barcode without a stock filter", () => {
    expect(filterPurchaseProducts(products, "panal deluxe")).toEqual([products[0]]);
    expect(filterPurchaseProducts(products, "07791234567890")).toEqual([products[0]]);
    expect(filterPurchaseProducts(products, "INT-02")).toEqual([products[1]]);
    expect(filterPurchaseProducts(products, "inexistente")).toEqual([]);
    expect(filterPurchaseProducts(products, "")).toEqual([]);
  });
});

describe("Standalone inventory entries", () => {
  const newProduct = { name: "Pañal nuevo", sku: " 07791234567890\t", barcode: "\u200B07791234567890", unit: "unidad" };
  it("mixes existing and new products and preserves zero-prefixed text identifiers", () => {
    const result = inventoryEntryItemsSchema.safeParse([item, { ...item, product_id: "33333333-3333-4333-8333-333333333333", new_product: newProduct }]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[1].new_product?.sku).toBe("07791234567890");
      expect(result.data[1].new_product?.barcode).toBe("07791234567890");
      expect(inventoryEntryItemsSchema.safeParse(result.data).success).toBe(true);
    }
  });
  it("rejects invalid new products and duplicate cross-field codes in a batch", () => {
    expect(entryNewProductSchema.safeParse({ ...newProduct, sku: "7.79E+12" }).success).toBe(false);
    expect(entryNewProductSchema.safeParse({ ...newProduct, sku: 779123 }).success).toBe(false);
    expect(entryNewProductSchema.safeParse({ ...newProduct, name: "", unit: "otro" }).success).toBe(false);
    expect(inventoryEntryItemsSchema.safeParse([
      { ...item, new_product: newProduct },
      { ...item, product_id: "33333333-3333-4333-8333-333333333333", new_product: { ...newProduct, sku: "DIFFERENT" } },
    ]).success).toBe(false);
  });
  it("detects codes already present as SKU or barcode without requiring a supplier", () => {
    const fields = { ...newProduct, unit: "unidad" as const };
    expect(entryIdentifierConflict(fields, [{ name: "Existente", sku: "OTRO", barcode: "07791234567890" }])).toBe("Existente");
    expect(entryIdentifierConflict({ ...fields, sku: "NUEVO", barcode: "" }, [])).toBeNull();
  });
});
