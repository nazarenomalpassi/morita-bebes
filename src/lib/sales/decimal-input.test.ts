import { describe, expect, it } from "vitest";

import { sanitizeDecimalInput } from "./decimal-input";

describe("sanitizeDecimalInput", () => {
  it("accepts empty, integer and decimal values", () => {
    expect(sanitizeDecimalInput("")).toBe("");
    expect(sanitizeDecimalInput("25")).toBe("25");
    expect(sanitizeDecimalInput("10,50")).toBe("10.50");
  });

  it("rejects characters, multiple separators and excessive precision", () => {
    expect(sanitizeDecimalInput("10a")).toBeNull();
    expect(sanitizeDecimalInput("1.2.3")).toBeNull();
    expect(sanitizeDecimalInput("10.123")).toBeNull();
  });

  it("supports three decimal quantity precision when requested", () => {
    expect(sanitizeDecimalInput("1.125", { maxFractionDigits: 3 })).toBe("1.125");
    expect(sanitizeDecimalInput("1.1259", { maxFractionDigits: 3 })).toBeNull();
  });

  it("preserves the separator while entering payroll cents character by character", () => {
    let current = "";
    for (const character of "417663,95") {
      const next = sanitizeDecimalInput(current + character);
      expect(next).not.toBeNull();
      current = next!;
      if (character === ",") expect(current).toBe("417663.");
    }
    expect(current).toBe("417663.95");
    expect(Number(current)).toBe(417663.95);
    expect(sanitizeDecimalInput("300000.05")).toBe("300000.05");
  });

  it("rejects negative amounts, exponent notation and more than two payroll cents", () => {
    for (const value of ["-1", "1e6", "417663,951", "417663.951", "10,5,0", "1000000000"]) {
      expect(sanitizeDecimalInput(value)).toBeNull();
    }
  });
});
