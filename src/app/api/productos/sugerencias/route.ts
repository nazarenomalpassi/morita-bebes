import { getCurrentOrganization } from "@/lib/data/current-organization";
import { normalizeProductSearch, queryManagementProducts } from "@/lib/inventory/product-search";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const organization = await getCurrentOrganization(supabase);
  if (!organization) return Response.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const q = normalizeProductSearch(params.get("q") ?? "");
  if (q.length < 2) return Response.json({ products: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const { data, error } = await queryManagementProducts(supabase, organization.id, {
    q, category: params.get("category") ?? "", supplier: params.get("supplier") ?? "", status: params.get("status") ?? "active",
  }).limit(8).abortSignal(request.signal);
  if (error) return Response.json({ error: "No pudimos buscar productos." }, { status: 500 });
  return Response.json({ products: (data ?? []).map((item) => ({ id: item.id, name: item.name, sku: item.sku, stock: Number(item.current_stock) })) }, { headers: { "Cache-Control": "private, no-store" } });
}
