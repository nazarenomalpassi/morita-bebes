import { describe, expect, it } from "vitest";
import { normalizeProductSearch, productPageSize } from "./product-search";

describe("management product search", () => {
  it("preserves leading zeroes, accents and internal codes", () => {
    expect(normalizeProductSearch("  07791234567890  ")).toBe("07791234567890");
    expect(normalizeProductSearch("Pañales  bebé\tXXG-30")).toBe("Pañales bebé XXG-30");
  });
  it("cannot inject PostgREST expressions", () => {
    expect(normalizeProductSearch("abc%,name.eq.x()_'\"\\")).toBe("abc name eq x");
    expect(normalizeProductSearch("x".repeat(90))).toHaveLength(80);
  });
  it("only accepts bounded page sizes", () => {
    expect([undefined, "-1", "100000", "20.1", "constructor"].map(productPageSize)).toEqual([50, 50, 50, 50, 50]);
    expect(["10", "20", "50"].map(productPageSize)).toEqual([10, 20, 50]);
  });
});
