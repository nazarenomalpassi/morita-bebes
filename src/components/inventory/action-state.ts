import type { ProductPrices } from "@/lib/inventory/prices";

export type InventoryActionState = {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors?: Record<string, string>;
  prices?: ProductPrices;
};

export const initialInventoryActionState: InventoryActionState = {
  status: "idle",
  message: "",
};
