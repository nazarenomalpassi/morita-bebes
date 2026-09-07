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
});
