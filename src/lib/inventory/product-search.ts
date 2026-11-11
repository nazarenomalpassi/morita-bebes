import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeManualSearch } from "./manual-search";

export function normalizeProductSearch(value: string) {
  return value.slice(0, 80).replace(/[^a-zA-Z0-9À-ÿ\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function productPageSize(value: string | undefined) {
  return value === "10" ? 10 : value === "20" ? 20 : 50;
}

export type ProductFilters = { q: string; category: string; supplier: string; status: string; brand?: string; pending?: string };
export type ProductSuggestion = { id: string; name: string; sku: string; stock: number };

export function queryManagementProducts(supabase: SupabaseClient<Database>, organizationId: string, filters: ProductFilters, count = false) {
  let query = supabase.from("products")
    .select("id, name, sku, barcode, cost_price, retail_price, wholesale_price, current_stock, min_stock, needs_restock, is_active, category_id, brand_id, inventory_attributes, default_supplier_id, categories(name), brands(name), suppliers(business_name)", { count: count ? "exact" : undefined })
    .eq("organization_id", organizationId);
  const search = normalizeManualSearch(normalizeProductSearch(filters.q));
  if (search) {
    for (const word of search.split(" ")) query = query.ilike("management_search_text", `%${word}%`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(filters.category)) query = query.eq("category_id", filters.category);
  if (uuid.test(filters.supplier)) query = query.eq("default_supplier_id", filters.supplier);
  if (filters.brand && uuid.test(filters.brand)) query = query.eq("brand_id", filters.brand);
  if (filters.pending === "category") query = query.is("category_id", null);
  if (filters.pending === "brand") query = query.is("brand_id", null);
  if (filters.pending === "cost") query = query.eq("cost_price", 0);
  if (filters.status === "active") query = query.eq("is_active", true);
  if (filters.status === "inactive") query = query.eq("is_active", false);
  if (filters.status === "low") query = query.eq("is_active", true).eq("needs_restock", true);
  if (filters.status === "zero") query = query.eq("is_active", true).lte("current_stock", 0);
  if (filters.status === "unassigned") query = query.is("default_supplier_id", null);
  return query.order("name").order("id");
}
