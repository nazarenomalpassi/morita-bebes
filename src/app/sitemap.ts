import type { MetadataRoute } from "next";

import { getStoreContext, listStoreProducts } from "@/lib/store/queries";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://morita-bebes.vercel.app";
  const context = await getStoreContext();
  const products = [];
  for (let offset = 0; offset < 1200; offset += 60) {
    const page = await listStoreProducts({ limit: 60, offset, sort: "name" });
    products.push(...page);
    if (page.length < 60) break;
  }
  const staticRoutes = ["", "/productos", "/mayoristas", "/registro"].map((path) => ({ url: `${base}/tienda${path}`, changeFrequency: "daily" as const, priority: path === "" ? 1 : .8 }));
  const categories = context.categories.map((category) => ({ url: `${base}/tienda/productos?categoria=${encodeURIComponent(category.slug)}`, changeFrequency: "daily" as const, priority: .65 }));
  const productRoutes = products.map((product) => ({ url: `${base}/tienda/productos/${product.slug}`, changeFrequency: "daily" as const, priority: .7 }));
  return [...staticRoutes, ...categories, ...productRoutes];
}
