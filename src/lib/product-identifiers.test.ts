import { describe, expect, it } from "vitest";

import {
  isScientificNotationIdentifier,
  isValidGtin,
  normalizeProductIdentifier,
  productIdentifierWarning,
} from "./product-identifiers";

describe("product identifiers", () => {
  it("preserves leading zeroes and internal spaces", () => {
    expect(normalizeProductIdentifier("  07791234567890\r\n")).toBe("07791234567890");
    expect(normalizeProductIdentifier(" WD 00235 ")).toBe("WD 00235");
  });

  it("removes control and invisible characters", () => {
    expect(normalizeProductIdentifier("779\t123\u200B456\r\n")).toBe("779123456");
  });

  it("detects scientific notation without converting it", () => {
    expect(isScientificNotationIdentifier("7.79123E+12")).toBe(true);
    expect(productIdentifierWarning("7.79123E+12")).toContain("notación científica");
  });

  it("validates GTIN check digits only for supported numeric lengths", () => {
    expect(isValidGtin("7790250042068")).toBe(true);
    expect(isValidGtin("7790250042067")).toBe(false);
    expect(isValidGtin("WD 00235")).toBe(false);
    expect(productIdentifierWarning("WD 00235")).toBeNull();
    expect(productIdentifierWarning("7790250042067")).toContain("verificador EAN");
  });
});
