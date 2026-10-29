import { describe, expect, it } from "vitest";
import { rankProducts, rankingLimit } from "./product-ranking";

describe("expanded product ranking", () => {
  const products = Array.from({ length: 60 }, (_, index) => ({ id: String(index), name: `Producto ${index}`, sku: `00${index}`, units: index + 1, revenue: 1000 - index }));
  it("supports 10, 20 and 50 distinct products", () => {
    for (const limit of [10, 20, 50]) expect(rankProducts(products, "units", limit)).toHaveLength(limit);
  });
  it("ranks by the selected metric without mutating the original dataset", () => {
    expect(rankProducts(products, "units", 50)[0].id).toBe("59");
    expect(rankProducts(products, "revenue", 50)[0].id).toBe("0");
    expect(products[0].id).toBe("0");
  });
  it("rejects unbounded and invalid limits", () => {
    expect(["10000", "0", "NaN", "-1"].map(rankingLimit)).toEqual([10, 10, 10, 10]);
  });
});
