export type PurchaseProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  currentStock: number;
  minStock: number;
  targetStock: number | null;
  costPrice: number;
  unit: string;
  needsRestock: boolean;
  supplierId: string | null;
  supplierName: string | null;
};

export type PurchaseSupplier = {
  id: string;
  name: string;
};

export type PurchaseOrderItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
};

export type PurchaseOrder = {
  id: string;
  reference: string | null;
  status: "draft" | "sent" | "partial" | "received" | "cancelled";
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  estimatedTotal: number;
  notes: string | null;
  createdAt: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseOrderItem[];
};
