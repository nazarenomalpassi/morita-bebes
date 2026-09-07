import { describe, expect, it } from "vitest";

import {
  calculatePercentageDiscount,
  calculateSaleAmounts,
  isFullyDiscountedSale,
} from "./discount";

describe("calculatePercentageDiscount", () => {
  it("calculates a ten-percent sale discount", () => {
    expect(calculatePercentageDiscount(100_000, 10)).toEqual({ amount: 10_000, total: 90_000 });
  });

  it("allows a fully discounted sale", () => {
    expect(calculatePercentageDiscount(100_000, 100)).toEqual({ amount: 100_000, total: 0 });
  });

  it.each([-1, 101])("rejects an invalid percentage: %s", (percentage) => {
    expect(() => calculatePercentageDiscount(100_000, percentage)).toThrow();
  });
});

describe("calculateSaleAmounts", () => {
  it("adds a fixed surcharge after applying the percentage discount", () => {
    expect(calculateSaleAmounts(100_000, 10, 5_000)).toEqual({
      discountAmount: 10_000,
      discountedTotal: 90_000,
      paymentBaseTotal: 95_000,
    });
  });

  it("requires collecting only the surcharge on a fully discounted sale", () => {
    expect(calculateSaleAmounts(100_000, 100, 5_000).paymentBaseTotal).toBe(5_000);
  });

  it("rejects negative fixed surcharges", () => {
    expect(() => calculateSaleAmounts(100_000, 0, -1)).toThrow();
  });
});

describe("isFullyDiscountedSale", () => {
  it("does not treat an empty cart as a sale without payment", () => {
    expect(isFullyDiscountedSale(0, 0)).toBe(false);
  });

  it("recognizes a sale whose discount covers the complete subtotal", () => {
    expect(isFullyDiscountedSale(100_000, 0)).toBe(true);
  });
});
