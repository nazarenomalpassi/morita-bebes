import { getSupabaseEnv } from "@/lib/supabase/env";

export function resolveStoreImage(path: string | null | undefined) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("/")) return path;
  const { supabaseUrl } = getSupabaseEnv();
  return `${supabaseUrl}/storage/v1/object/public/store-media/${path}`;
}

export function productPlaceholderTone(categorySlug: string | null | undefined) {
  const tones: Record<string, string> = {
    panales: "lavender",
    higiene: "mint",
    alimentacion: "peach",
    mamaderas: "sky",
    chupetes: "rose",
    juguetes: "sun",
    accesorios: "lilac",
  };
  return tones[categorySlug ?? ""] ?? "neutral";
}
