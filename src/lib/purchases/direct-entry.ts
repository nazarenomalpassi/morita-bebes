import { z } from "zod";

import { parsePriceInput } from "../inventory/prices";
import { isScientificNotationIdentifier, normalizeProductIdentifier } from "../product-identifiers";
import { matchesManualSearch } from "../inventory/manual-search";

const money = z.number().min(0).max(999_999_999_999.99).refine((value) => value === Number(value.toFixed(2)));
export const directPurchaseItemsSchema = z.array(z.object({
  product_id: z.uuid(),
  quantity: z.number().positive().max(1_000_000).refine((value) => value === Number(value.toFixed(3))),
  unit_cost: money.max(999_999_999),
  retail_price: money,
  wholesale_price: money.nullable(),
  original_cost_price: money,
  original_retail_price: money,
  original_wholesale_price: money.nullable(),
}).strict()).min(1).max(500)
  .refine((items) => new Set(items.map((item) => item.product_id)).size === items.length)
  .refine((items) => items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0) <= 999_999_999_999.99);

export type DirectPurchaseItem = z.infer<typeof directPurchaseItemsSchema>[number];
export const entryProductUnits = ["unidad", "paquete", "caja", "bolsa", "kit", "par", "litro", "kilogramo"] as const;
const identifier = z.string().transform(normalizeProductIdentifier).refine((value) => value.length <= 80 && !isScientificNotationIdentifier(value));
export const entryNewProductSchema = z.object({
  name: z.string().trim().min(2).max(180),
  sku: identifier.refine((value) => value.length > 0),
  barcode: z.string().nullable().transform(normalizeProductIdentifier).refine((value) => value.length <= 80 && !isScientificNotationIdentifier(value)).transform((value) => value || null),
  unit: z.enum(entryProductUnits),
  category_id: z.union([z.uuid(), z.literal("")]).optional(),
  brand_id: z.union([z.uuid(), z.literal("")]).optional(),
}).strict();
export const inventoryEntryItemsSchema = z.array(z.object({
  product_id: z.uuid(),
  quantity: z.number().positive().max(1_000_000).refine((value) => value === Number(value.toFixed(3))),
  unit_cost: money.max(999_999_999),
  retail_price: money,
  wholesale_price: money.nullable(),
  original_cost_price: money,
  original_retail_price: money,
  original_wholesale_price: money.nullable(),
  new_product: entryNewProductSchema.optional(),
}).strict()).min(1).max(500)
  .refine((items) => new Set(items.map((item) => item.product_id)).size === items.length)
  .refine((items) => {
    const codes = new Set<string>();
    for (const item of items) {
      if (!item.new_product) continue;
      for (const code of new Set([item.new_product.sku, item.new_product.barcode].filter((value): value is string => Boolean(value)))) {
        if (codes.has(code)) return false;
        codes.add(code);
      }
    }
    return true;
  });
export type InventoryEntryItem = z.infer<typeof inventoryEntryItemsSchema>[number];
export type EntryNewProductFields = { name: string; sku: string; barcode: string; unit: typeof entryProductUnits[number]; category_id?: string; brand_id?: string };

export function entryIdentifierConflict(fields: EntryNewProductFields, products: { name: string; sku: string; barcode: string | null }[]) {
  const codes = [fields.sku, fields.barcode].map(normalizeProductIdentifier).filter(Boolean);
  return products.find((product) => codes.includes(normalizeProductIdentifier(product.sku)) || (product.barcode && codes.includes(normalizeProductIdentifier(product.barcode))))?.name ?? null;
}
export type DirectPurchaseFields = { quantity: string; cost: string; retail: string; wholesale: string };

export function parseDirectPurchaseFields(fields: DirectPurchaseFields) {
  const quantityText = fields.quantity.trim().replace(",", ".");
  const quantity = /^\d+(?:\.\d{1,3})?$/.test(quantityText) ? Number(quantityText) : null;
  const cost = parsePriceInput(fields.cost);
  const retail = parsePriceInput(fields.retail);
  const wholesale = parsePriceInput(fields.wholesale);
  const errors: Partial<Record<keyof DirectPurchaseFields, string>> = {};
  if (quantity === null || quantity <= 0 || quantity > 1_000_000) errors.quantity = "Ingresá una cantidad mayor a cero, con hasta 3 decimales.";
  if (cost === null || cost > 999_999_999) errors.cost = "Ingresá un costo válido, con hasta 2 decimales.";
  if (retail === null) errors.retail = "Ingresá un precio minorista válido.";
  if (fields.wholesale.trim() && wholesale === null) errors.wholesale = "Ingresá un precio mayorista válido o dejalo vacío.";
  return { quantity: errors.quantity ? null : quantity, cost: errors.cost ? null : cost, retail, wholesale, errors, valid: Object.keys(errors).length === 0 };
}

export function filterPurchaseProducts<T extends { name: string; sku: string; barcode: string | null }>(products: T[], search: string) {
  if (!search.trim()) return [];
  return products.filter((product) => matchesManualSearch([product.name, product.sku, product.barcode], search));
}
