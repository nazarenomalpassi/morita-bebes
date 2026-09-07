import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://morita-bebes.vercel.app";
  return {
    rules: [{ userAgent: "*", allow: "/tienda", disallow: ["/app", "/api", "/login", "/tienda/cuenta", "/tienda/carrito"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
