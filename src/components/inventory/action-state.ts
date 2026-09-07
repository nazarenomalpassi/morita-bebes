export type InventoryActionState = {
  status: "idle" | "error" | "success";
  message: string;
  fieldErrors?: Record<string, string>;
};

export const initialInventoryActionState: InventoryActionState = {
  status: "idle",
  message: "",
};
