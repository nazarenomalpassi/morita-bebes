import { describe, expect, it } from "vitest";

import { formatPriceInput, parsePriceInput } from "./prices";

describe("product price input", () => {
  it.each([
    ["25.000", 25000],
    ["$ 1.250.000,50", 1250000.5],
    ["1250000,50", 1250000.5],
    ["1250000.50", 1250000.5],
    ["0", 0],
    ["999.999.999.999,99", 999999999999.99],
  ])("parses %s as %s", (input, expected) => {
    expect(parsePriceInput(input)).toBe(expected);
  });

  it.each(["", "-10", "1.2.3", "1.000,999", "1e6", "1,250.00", "1000000000000"])(
    "rejects %s",
    (input) => expect(parsePriceInput(input)).toBeNull(),
  );

  it("formats prices for the Argentine editor", () => {
    expect(formatPriceInput(1250000.5)).toBe("1.250.000,5");
    expect(formatPriceInput(null)).toBe("");
  });
});
