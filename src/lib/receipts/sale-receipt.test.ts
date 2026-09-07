import { describe, expect, it } from "vitest";

import {
  parseSaleReceipt,
  receiptArs,
  receiptDateParts,
  receiptFileName,
  receiptNumberLabel,
  type SaleReceipt,
} from "./sale-receipt";

function receiptFixture(overrides: Partial<SaleReceipt> = {}): SaleReceipt {
  return {
    display_number: "000125",
    source: "system",
    status: "completed",
    occurred_at: "2026-08-10T19:30:00-03:00",
    original_time_known: true,
    item_detail_status: "complete",
    subtotal: 18500,
    discount: 0,
    vat_10_5: 0,
    vat_21: 0,
    rounding_adjustment: 0,
    manual_surcharge: 0,
    surcharge: 0,
    total: 18500,
    customer: { name: "María", phone: "3571 555555" },
    seller_name: "Sofía",
    payments: [{ method: "Efectivo", amount: 18500 }],
    business: { name: "Morita Bebés" },
    items: [{
      name: "Pampers Premium Care XXG",
      sku: "PAMP-XXG",
      quantity: 1,
      unit_price: 18500,
      discount: 0,
      line_total: 18500,
    }],
    ...overrides,
  };
}

describe("sale receipt contract", () => {
  it("preserves a real sale snapshot and formats Argentine pesos", () => {
    const receipt = parseSaleReceipt(receiptFixture());
    expect(receipt.items[0]).toMatchObject({ quantity: 1, unit_price: 18500, line_total: 18500 });
    expect(receiptArs.format(receipt.items[0].unit_price)).toMatch(/18\.500/);
    expect(receiptDateParts(receipt)).toEqual({ date: "10/08/2026", time: "19:30" });
  });

  it("supports discounts, quantities greater than one and split payments", () => {
    const receipt = parseSaleReceipt(receiptFixture({
      subtotal: 220000,
      discount: 10000,
      total: 210000,
      customer: null,
      payments: [
        { method: "Efectivo", amount: 50000 },
        { method: "Transferencia", amount: 160000 },
      ],
      items: [{
        name: "Pañales con un nombre deliberadamente largo para verificar el ajuste visual",
        sku: null,
        quantity: 10,
        unit_price: 22000,
        discount: 0,
        line_total: 220000,
      }],
    }));
    expect(receipt.customer).toBeNull();
    expect(receipt.payments).toHaveLength(2);
    expect(receipt.discount).toBe(10000);
  });

  it("preserves the historical card type, percentage and surcharge", () => {
    const receipt = parseSaleReceipt(receiptFixture({
      surcharge: 2405,
      total: 20905,
      payments: [{
        method: "Tarjeta de crédito",
        base_amount: 18500,
        amount: 20905,
        card_type: "credit",
        surcharge_percentage: 13,
        surcharge_amount: 2405,
      }],
    }));
    expect(receipt.payments[0]).toMatchObject({
      method: "Tarjeta de crédito",
      card_type: "credit",
      surcharge_percentage: 13,
      surcharge_amount: 2405,
    });
    expect(receipt.surcharge).toBe(2405);
  });

  it("preserves a fixed manual surcharge separately from the card surcharge", () => {
    const receipt = parseSaleReceipt(receiptFixture({
      manual_surcharge: 5000,
      total: 23500,
      payments: [{ method: "Efectivo", amount: 23500 }],
    }));
    expect(receipt.manual_surcharge).toBe(5000);
    expect(receipt.surcharge).toBe(0);
  });

  it("represents historical sales without inventing missing products or time", () => {
    const receipt = parseSaleReceipt(receiptFixture({
      display_number: "856",
      source: "legacy_import",
      original_time_known: false,
      item_detail_status: "missing_from_source",
      items: [],
    }));
    expect(receiptNumberLabel(receipt)).toBe("Hist. #856");
    expect(receiptDateParts(receipt).time).toBeNull();
    expect(receipt.items).toEqual([]);
  });

  it("creates a clear stable file name", () => {
    expect(receiptFileName(receiptFixture({ display_number: "V 125/26" })))
      .toBe("Morita-Bebes-Comprobante-V-125-26.pdf");
  });
});
