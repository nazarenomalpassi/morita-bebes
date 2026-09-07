import "server-only";

import { cache } from "react";

import { isStoreManagementRole } from "@/lib/store/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  STORE_ORGANIZATION_SLUG,
  type StoreContext,
  type StoreProduct,
} from "@/lib/store/types";

export const getStoreContext = cache(async (): Promise<StoreContext> => {
  const supabase = await createServerSupabaseClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  const { data: settingsRows, error: settingsError } = await supabase
    .from("site_settings")
    .select("*")
    .limit(1);
  const settings = settingsRows?.[0];
  const organizationId = settings?.organization_id;
  if (settingsError || !settings || !organizationId) throw settingsError ?? new Error("La tienda todavía no está configurada.");

  const userId = claimsData?.claims?.sub;
  const [categoriesResult, brandsResult, bannersResult, profileResult, membershipResult, managementProfileResult] = await Promise.all([
    supabase.from("categories").select("id, name, slug, image_path, store_description, is_featured_online").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("brands").select("id, name, logo_path, is_featured_online").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("store_banners").select("*").eq("organization_id", organizationId).eq("is_active", true).order("sort_order"),
    userId
      ? supabase.from("store_customer_profiles").select("*").eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    userId
      ? supabase.from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", userId).eq("is_active", true).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    userId
      ? supabase.from("user_profiles").select("display_name").eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const error = categoriesResult.error ?? brandsResult.error ?? bannersResult.error ?? profileResult.error ?? membershipResult.error ?? managementProfileResult.error;
  if (error) throw error;

  const profile = profileResult.data;
  const managementRole = isStoreManagementRole(membershipResult.data?.role)
    ? membershipResult.data.role
    : null;
  const claimsEmail = claimsData?.claims?.email;
  const accountType = profile?.customer_type === "wholesale" && profile.wholesale_status === "approved"
    ? "wholesale"
    : profile ? "retail" : "guest";

  return {
    accountType,
    banners: bannersResult.data ?? [],
    brands: brandsResult.data ?? [],
    categories: categoriesResult.data ?? [],
    managementName: managementRole
      ? managementProfileResult.data?.display_name
        ?? (typeof claimsEmail === "string" ? claimsEmail : null)
      : null,
    managementRole,
    profile,
    settings,
  };
});

export async function listStoreProducts(options: {
  search?: string;
  category?: string;
  brandId?: string;
  availability?: string;
  sort?: string;
  slug?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<StoreProduct[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_store_products", {
    p_organization_slug: STORE_ORGANIZATION_SLUG,
    p_search: options.search || undefined,
    p_category_slug: options.category || undefined,
    p_brand_id: options.brandId || undefined,
    p_availability: options.availability || "all",
    p_sort: options.sort || "featured",
    p_product_slug: options.slug || undefined,
    p_limit: options.limit ?? 24,
    p_offset: options.offset ?? 0,
  });
  if (error) throw error;
  return data ?? [];
}
