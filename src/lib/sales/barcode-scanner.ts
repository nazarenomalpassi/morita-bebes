import { normalizeProductIdentifier } from "../product-identifiers";

export type SaleProduct = {
  barcode: string | null;
  current_stock: number;
  id: string;
  is_active: boolean;
  name: string;
  retail_price: number;
  sku: string;
  unit: string;
};

export type SaleCartLine = SaleProduct & { quantity: number };

export type ProductCodeIndex = {
  byBarcode: Map<string, SaleProduct>;
  bySku: Map<string, SaleProduct>;
};

export type AddProductResult =
  | { cart: SaleCartLine[]; status: "added" | "incremented" }
  | { cart: SaleCartLine[]; status: "inactive" | "without_stock" | "insufficient_stock" };

export function normalizeScannedCode(value: string) {
  return normalizeProductIdentifier(value);
}

export function createProductCodeIndex(products: SaleProduct[]): ProductCodeIndex {
  const byBarcode = new Map<string, SaleProduct>();
  const bySku = new Map<string, SaleProduct>();

  for (const product of products) {
    const barcode = normalizeProductIdentifier(product.barcode);
    const sku = normalizeProductIdentifier(product.sku);
    if (barcode) byBarcode.set(barcode, product);
    if (sku) bySku.set(sku, product);
  }

  return { byBarcode, bySku };
}

export function findProductByScannedCode(index: ProductCodeIndex, value: string) {
  const code = normalizeScannedCode(value);
  if (!code) return null;
  return index.byBarcode.get(code) ?? index.bySku.get(code) ?? null;
}

export function addProductUnit(cart: SaleCartLine[], product: SaleProduct): AddProductResult {
  if (!product.is_active) {
    return { cart, status: "inactive" };
  }

  if (product.current_stock <= 0) {
    return { cart, status: "without_stock" };
  }

  const existing = cart.find((line) => line.id === product.id);
  const nextQuantity = (existing?.quantity ?? 0) + 1;

  if (nextQuantity > product.current_stock) {
    return { cart, status: "insufficient_stock" };
  }

  if (!existing) {
    return { cart: [...cart, { ...product, quantity: 1 }], status: "added" };
  }

  return {
    cart: cart.map((line) => (
      line.id === product.id ? { ...line, quantity: nextQuantity } : line
    )),
    status: "incremented",
  };
}

export function isAccidentalDuplicateScan(
  previous: { code: string; occurredAt: number } | null,
  code: string,
  occurredAt: number,
  thresholdMs = 120,
) {
  return Boolean(
    previous
    && previous.code === code
    && occurredAt - previous.occurredAt >= 0
    && occurredAt - previous.occurredAt < thresholdMs,
  );
}
