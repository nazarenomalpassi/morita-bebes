import { z } from "zod";

export const inventoryAttributeLabels = { family: "Familia / línea", size: "Talle", age: "Edad", capacity: "Capacidad", presentation: "Presentación / unidades" } as const;
export const inventoryAttributesSchema = z.object({ family: z.string().trim().max(80).optional(), size: z.string().trim().max(80).optional(), age: z.string().trim().max(80).optional(), capacity: z.string().trim().max(80).optional(), presentation: z.string().trim().max(80).optional() }).strict();
export type InventoryAttributes = z.infer<typeof inventoryAttributesSchema>;
export function readInventoryAttributes(value: unknown): InventoryAttributes {
  const parsed = inventoryAttributesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
