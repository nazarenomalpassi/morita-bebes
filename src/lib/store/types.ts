import type { Database, Tables } from "@/types/database";

import type { StoreManagementRole } from "@/lib/store/admin";

export const STORE_ORGANIZATION_SLUG = "morita-bebes";
export const RETAIL_MINIMUM_DEFAULT = 20_000;
export const WHOLESALE_MINIMUM_DEFAULT = 500_000;

export type StoreProduct = Database["public"]["Functions"]["list_store_products"]["Returns"][number];
export type StoreCategory = Pick<
  Tables<"categories">,
  "id" | "name" | "slug" | "image_path" | "store_description" | "is_featured_online"
>;
export type StoreBrand = Pick<Tables<"brands">, "id" | "name" | "logo_path" | "is_featured_online">;
export type StoreBanner = Tables<"store_banners">;
export type StoreSettings = Tables<"site_settings">;
export type StoreCustomerProfile = Tables<"store_customer_profiles">;
export type WebOrder = Tables<"web_orders">;
export type WebOrderItem = Tables<"web_order_items">;
export type WebOrderStatus = Database["public"]["Enums"]["web_order_status"];

export type CartItem = {
  productId: string;
  slug: string;
  name: string;
  imagePath: string | null;
  price: number | null;
  priceKind: string;
  quantity: number;
  minimumQuantity: number;
  stock: number;
  unit: string;
  available: boolean;
  issue?: string;
};

export type CartSnapshot = {
  id: string;
  slug: string;
  name: string;
  display_price: number | null;
  price_kind: string;
  wholesale_available: boolean;
  minimum_quantity: number;
  current_stock: number;
  unit: string;
  category_slug: string | null;
  cover_image_path: string | null;
  is_available: boolean;
};

export type StoreContext = {
  accountType: "guest" | "retail" | "wholesale";
  banners: StoreBanner[];
  brands: StoreBrand[];
  categories: StoreCategory[];
  managementName: string | null;
  managementRole: StoreManagementRole | null;
  profile: StoreCustomerProfile | null;
  settings: StoreSettings;
};
