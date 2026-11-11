import { describe, expect, it } from "vitest";
import { matchesManualSearch } from "./manual-search";
import { calculateBatchPrices, priceChangesSchema, productPriceWarnings } from "./batch-prices";
import { inventoryAttributesSchema } from "./attributes";
import { completePaymentRemainder } from "../payments/allocation";
import { decodeManagementDraft } from "../ui/use-management-draft";
import { restoreSaleCart, validateSaleDraft } from "../sales/draft";
import { restoreInventoryLines, validateInventoryDraft } from "../purchases/draft";
import { expenseAmountForMethod } from "../expenses/filters";
import { expenseDetailsHref } from "../reports/drilldown";
import { paginationHref, requestedPage } from "../data/pagination";

const id = "11111111-1111-4111-8111-111111111111";
const saleDraft = { cart: [{ id, quantity: 3 }], customerId: "", notes: "", occurredAt: "", discountInput: "10", manualSurchargeInput: "", combinedPayment: false, selectedPaymentMethod: "", selectedCardType: "" as const, paymentAmounts: {}, paymentCardTypes: {}, idempotencyKey: id };
const product = { id, name: "Pañales Bebé Premium XXG", sku: "0770123", barcode: "0770123", current_stock: 2, retail_price: 25000, unit: "unidad", is_active: true };

describe("management workflow improvements", () => {
  it("matches separate words and accents without changing identifiers", () => {
    expect(matchesManualSearch([product.name, product.sku], "panales xxg bebe")).toBe(true);
    expect(matchesManualSearch([product.name, product.sku], "0770123")).toBe(true);
    expect(matchesManualSearch([product.name], "bebe chupete")).toBe(false);
  });
  it.each([[717663.95, { cash: "300000" }, "transfer", "417663.95"], [10, { cash: "0.10", transfer: "4" }, "transfer", "9.90"], [10, { cash: "11" }, "transfer", "0.00"]] as const)("completes remaining cents without double counting", (total, amounts, method, expected) => {
    expect(completePaymentRemainder(total, amounts, method)).toBe(expected);
  });
  it("rounds chosen prices only and never creates a missing wholesale price", () => {
    const original = { costPrice: 100, retailPrice: 151.25, wholesalePrice: null };
    expect(calculateBatchPrices(original, ["retailPrice", "wholesalePrice"], 10, 0)).toEqual({ costPrice: 100, retailPrice: 166.38, wholesalePrice: null });
    expect(calculateBatchPrices(original, ["retailPrice"], 10, 10).retailPrice).toBe(170);
    expect(original.retailPrice).toBe(151.25);
    expect(calculateBatchPrices(original, ["retailPrice"], -100, 0).retailPrice).toBe(0);
  });
  it("rejects invalid batches and repeated product IDs", () => {
    const change = { product_id: id, cost_price: 10, retail_price: 20, wholesale_price: null, original_cost_price: 5, original_retail_price: 15, original_wholesale_price: null };
    expect(priceChangesSchema.safeParse([change]).success).toBe(true);
    for (const invalid of [[change, change], [{ ...change, retail_price: -1 }], [{ ...change, cost_price: 1.005 }], []]) expect(priceChangesSchema.safeParse(invalid).success).toBe(false);
  });
  it("warns about large variations and prices below cost without inventing a price", () => {
    const original = { costPrice: 100, retailPrice: 200, wholesalePrice: null };
    expect(productPriceWarnings(original, { ...original, retailPrice: 608400 })).toContain("El precio minorista cambia un 50% o más.");
    expect(productPriceWarnings(original, { ...original, wholesalePrice: 90 })).toContain("El precio mayorista es menor que el costo.");
  });
  it("accepts optional product attributes, not arbitrary or oversized fields", () => {
    expect(inventoryAttributesSchema.safeParse({ size: "XXG", age: "6-18 meses", presentation: "30 unidades" }).success).toBe(true);
    expect(inventoryAttributesSchema.safeParse({ stock: "20" }).success).toBe(false);
    expect(inventoryAttributesSchema.safeParse({ size: "x".repeat(81) }).success).toBe(false);
  });
  it("restores only active sale products with current prices and available quantities", () => {
    expect(restoreSaleCart(saleDraft, [product])).toEqual([{ ...product, quantity: 2 }]);
    expect(restoreSaleCart(saleDraft, [{ ...product, current_stock: 0 }])).toEqual([]);
    expect(restoreSaleCart({ cart: [saleDraft.cart[0], saleDraft.cart[0]] }, [product])).toHaveLength(1);
  });
  it("retains request identifiers, validates drafts and ignores corrupt or expired data", () => {
    const now = Date.now();
    expect(decodeManagementDraft(JSON.stringify({ version: 1, savedAt: now, value: saleDraft }), validateSaleDraft)?.idempotencyKey).toBe(id);
    expect(decodeManagementDraft("not-json", validateSaleDraft)).toBeNull();
    expect(decodeManagementDraft(JSON.stringify({ version: 1, savedAt: now - 8 * 86400000, value: saleDraft }), validateSaleDraft)).toBeNull();
    expect(validateSaleDraft({ ...saleDraft, cart: [{ id, quantity: -1 }] })).toBeNull();
  });
  it("refreshes untouched ingress prices while retaining conflict snapshots for edited prices", () => {
    const draft = validateInventoryDraft({ requestId: id, notes: "", lines: [{ productId: id, originalCost: 100, originalRetail: 200, originalWholesale: null, fields: { quantity: "3", cost: "150", retail: "200", wholesale: "" } }] })!;
    const fresh = { id, name: "Pañal", sku: "0770", barcode: null, currentStock: 7, minStock: 0, targetStock: null, costPrice: 120, retailPrice: 240, wholesalePrice: null, unit: "unidad", needsRestock: false, supplierId: null, supplierName: null };
    const restored = restoreInventoryLines(draft, [fresh])[0];
    expect(restored.fields).toEqual({ quantity: "3", cost: "150", retail: "240", wholesale: "" });
    expect(restored.product.costPrice).toBe(100);
    expect(restored.product.currentStock).toBe(7);
    expect(restored.product.retailPrice).toBe(240);
    expect(restoreInventoryLines(draft, [])).toEqual([]);
  });
  it("does not sum a mixed expense twice and supports historical single payments", () => {
    const expense = { amount: 100, payment_method_id: null, payment_allocations: [{ payment_method_id: id, amount: 40 }, { payment_method_id: "22222222-2222-4222-8222-222222222222", amount: 60 }] };
    expect(expenseAmountForMethod(expense, id)).toBe(40);
    expect(expenseAmountForMethod(expense, "")).toBe(100);
    expect(expenseAmountForMethod({ ...expense, payment_allocations: [], payment_method_id: id }, id)).toBe(100);
  });
  it("preserves the complete report period and category, employee and payment filters", () => {
    const url = new URL(expenseDetailsHref("2026-10-15", "2026-11-10", { gasto_categoria: "none", gasto_empleado: "unassigned", gasto_pago: id }), "https://example.com");
    expect(Object.fromEntries(url.searchParams)).toEqual({ desde: "2026-10-15", hasta: "2026-11-10", estado: "posted", categoria: "none", empleado: "unassigned", pago: id });
  });
  it("paginates independent histories without discarding filters", () => {
    expect(requestedPage("-1")).toBe(1);
    expect(requestedPage("NaN")).toBe(1);
    expect(requestedPage("3")).toBe(3);
    expect(paginationHref("/app/caja", { buscar: "Sueldo", pagina: "2", cierres: "1" }, "cierres", 3, "#historial-cierres")).toBe("/app/caja?buscar=Sueldo&pagina=2&cierres=3#historial-cierres");
  });
});
