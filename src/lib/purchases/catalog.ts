import "server-only";

import type { ActionContext } from "@/lib/actions/context";
import type { PurchaseProduct } from "@/components/purchases/purchase-types";
import { fetchAllRows } from "@/lib/data/fetch-all-rows";

export async function getPurchaseCatalog(supabase: ActionContext["supabase"], organizationId: string, includeSuppliers = true) {
  const [rows, suppliers] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("products")
      .select("id, name, sku, barcode, current_stock, min_stock, target_stock, cost_price, retail_price, wholesale_price, unit, needs_restock, default_supplier_id, suppliers(business_name)")
      .eq("organization_id", organizationId).eq("is_active", true).order("name").order("id").range(from, to)),
    includeSuppliers ? fetchAllRows((from, to) => supabase.from("suppliers").select("id, business_name")
      .eq("organization_id", organizationId).eq("is_active", true).order("business_name").order("id").range(from, to)) : Promise.resolve([]),
  ]);
  const products: PurchaseProduct[] = rows.map((product) => ({
    id: product.id, name: product.name, sku: product.sku, barcode: product.barcode,
    currentStock: Number(product.current_stock), minStock: Number(product.min_stock),
    targetStock: product.target_stock === null ? null : Number(product.target_stock),
    costPrice: Number(product.cost_price), retailPrice: Number(product.retail_price),
    wholesalePrice: product.wholesale_price === null ? null : Number(product.wholesale_price),
    unit: product.unit, needsRestock: Boolean(product.needs_restock),
    supplierId: product.default_supplier_id, supplierName: product.suppliers?.business_name ?? null,
  }));
  return { products, suppliers: suppliers.map((supplier) => ({ id: supplier.id, name: supplier.business_name })) };
}
