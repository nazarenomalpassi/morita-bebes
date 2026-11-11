import { z } from "zod";
import type { ProductPrices } from "./prices";

const price = z.number().nonnegative().max(999_999_999_999.99).refine((value) => value === Number(value.toFixed(2)));
export const priceChangesSchema = z.array(z.object({ product_id: z.uuid(), cost_price: price, retail_price: price, wholesale_price: price.nullable(), original_cost_price: price, original_retail_price: price, original_wholesale_price: price.nullable() }).strict()).min(1).max(500).refine((items) => new Set(items.map((item) => item.product_id)).size === items.length);
export type PriceChange = z.infer<typeof priceChangesSchema>[number];
export function calculateBatchPrices(prices: ProductPrices, fields: (keyof ProductPrices)[], percentage: number, rounding: number): ProductPrices {
  const result = { ...prices };
  for (const field of fields) {
    if (result[field] === null) continue;
    const value = result[field]! * (1 + percentage / 100);
    result[field] = Math.round((rounding ? Math.round(value / rounding) * rounding : value) * 100) / 100;
  }
  return result;
}
export function productPriceWarnings(previous: ProductPrices, next: ProductPrices) {
  const warnings: string[] = [];
  if (next.retailPrice < next.costPrice) warnings.push("El precio minorista es menor que el costo.");
  if (next.wholesalePrice !== null && next.wholesalePrice < next.costPrice) warnings.push("El precio mayorista es menor que el costo.");
  for (const [field, label] of [["costPrice", "costo"], ["retailPrice", "precio minorista"], ["wholesalePrice", "precio mayorista"]] as const) {
    const before = previous[field], after = next[field];
    if (before !== null && before > 0 && after !== null && Math.abs(after - before) / before >= 0.5) warnings.push(`El ${label} cambia un 50% o más.`);
  }
  if (previous.costPrice > 0 && next.costPrice === 0) warnings.push("El costo quedará en cero.");
  return warnings;
}
