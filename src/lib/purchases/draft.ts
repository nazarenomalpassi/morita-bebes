import { z } from "zod";
import { parsePriceInput, formatPriceInput } from "../inventory/prices";
import type { PurchaseProduct } from "@/components/purchases/purchase-types";
import { entryProductUnits } from "./direct-entry";

const schema = z.object({
  requestId: z.union([z.uuid(), z.literal("")]), notes: z.string().max(500),
  lines: z.array(z.object({
    productId: z.uuid(), originalCost: z.number().nonnegative(), originalRetail: z.number().nonnegative(), originalWholesale: z.number().nonnegative().nullable(),
    fields: z.object({ quantity: z.string().max(20), cost: z.string().max(20), retail: z.string().max(20), wholesale: z.string().max(20) }),
    newProduct: z.object({ name: z.string().max(180), sku: z.string().max(80), barcode: z.string().max(80), unit: z.enum(entryProductUnits), category_id: z.string().max(36).optional(), brand_id: z.string().max(36).optional() }).optional(),
  })).max(500),
});
export type InventoryDraft = z.infer<typeof schema>;
export function validateInventoryDraft(value: unknown): InventoryDraft | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function restoreInventoryLines(draft: InventoryDraft, products: PurchaseProduct[]) {
  const seen = new Set<string>();
  return draft.lines.flatMap((line) => {
    if (seen.has(line.productId)) return [];
    seen.add(line.productId);
    const fresh = products.find((product) => product.id === line.productId);
    if (!fresh && !line.newProduct) return [];
    const original = { cost: line.originalCost, retail: line.originalRetail, wholesale: line.originalWholesale };
    const product: PurchaseProduct = fresh ?? { id: line.productId, name: line.newProduct!.name || "Nuevo producto", sku: line.newProduct!.sku, barcode: line.newProduct!.barcode || null, unit: line.newProduct!.unit, currentStock: 0, costPrice: line.originalCost, retailPrice: line.originalRetail, wholesalePrice: line.originalWholesale, minStock: 0, targetStock: null, needsRestock: false, supplierId: null, supplierName: null };
    const fields = { ...line.fields };
    const baseline = { ...product };
    for (const [field, property] of [["cost", "costPrice"], ["retail", "retailPrice"], ["wholesale", "wholesalePrice"]] as const) {
      if (!line.newProduct && parsePriceInput(fields[field]) === original[field]) fields[field] = formatPriceInput(product[property]);
      else Object.assign(baseline, { [property]: original[field] });
    }
    return [{ product: baseline, fields, ...(line.newProduct ? { newProduct: line.newProduct } : {}) }];
  });
}
