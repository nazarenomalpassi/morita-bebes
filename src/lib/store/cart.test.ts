import { describe, expect, it } from "vitest";

import { reconcileCartItems } from "./cart";
import type { CartItem, CartSnapshot } from "./types";

const item: CartItem = {
  productId: "product-1",
  slug: "producto",
  name: "Producto",
  imagePath: null,
  price: 10_000,
  priceKind: "retail",
  quantity: 5,
  minimumQuantity: 1,
  stock: 10,
  unit: "unidad",
  available: true,
};

const snapshot: CartSnapshot = {
  id: "product-1",
  slug: "producto",
  name: "Producto",
  display_price: 7_000,
  price_kind: "wholesale",
  wholesale_available: true,
  minimum_quantity: 2,
  current_stock: 3,
  unit: "unidad",
  category_slug: null,
  cover_image_path: null,
  is_available: true,
};

describe("store cart reconciliation", () => {
  it("updates account pricing and clamps quantity to the current stock", () => {
    expect(reconcileCartItems([item], [snapshot])).toEqual([
      expect.objectContaining({ price: 7_000, priceKind: "wholesale", quantity: 3, stock: 3, available: true }),
    ]);
  });

  it("blocks checkout when a product is unpublished or missing", () => {
    expect(reconcileCartItems([item], [{ ...snapshot, is_available: false }])[0]).toMatchObject({ available: false, issue: "Este producto ya no está publicado." });
    expect(reconcileCartItems([item], [])[0]).toMatchObject({ available: false, issue: "Este producto ya no está publicado." });
  });

  it("blocks checkout when wholesale minimum exceeds available stock", () => {
    expect(reconcileCartItems([item], [{ ...snapshot, minimum_quantity: 4, current_stock: 3 }])[0])
      .toMatchObject({ available: false, issue: "El stock disponible no alcanza el mínimo de 4." });
  });
});
