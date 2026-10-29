import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function normalizeProductSearch(value: string) {
  return value.slice(0, 80).replace(/[^a-zA-Z0-9À-ÿ\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function productPageSize(value: string | undefined) {
  return value === "10" ? 10 : value === "20" ? 20 : 50;
}

export type ProductFilters = { q: string; category: string; supplier: string; status: string };
export type ProductSuggestion = { id: string; name: string; sku: string; stock: number };

export function queryManagementProducts(supabase: SupabaseClient<Database>, organizationId: string, filters: ProductFilters, count = false) {
  let query = supabase.from("products")
    .select("id, name, sku, barcode, cost_price, retail_price, wholesale_price, current_stock, min_stock, needs_restock, is_active, category_id, default_supplier_id, categories(name), brands(name), suppliers(business_name)", { count: count ? "exact" : undefined })
    .eq("organization_id", organizationId);
  const search = normalizeProductSearch(filters.q);
  if (search) {
    const terms = search.split(" ").map((word) => `or(name.ilike.%${word}%,sku.ilike.%${word}%,barcode.ilike.%${word}%)`);
    query = query.or(`and(${terms.join(",")})`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(filters.category)) query = query.eq("category_id", filters.category);
  if (uuid.test(filters.supplier)) query = query.eq("default_supplier_id", filters.supplier);
  if (filters.status === "active") query = query.eq("is_active", true);
  if (filters.status === "inactive") query = query.eq("is_active", false);
  if (filters.status === "low") query = query.eq("is_active", true).eq("needs_restock", true);
  if (filters.status === "unassigned") query = query.is("default_supplier_id", null);
  return query.order("name").order("id");
}
