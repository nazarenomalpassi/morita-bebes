import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Morita Bebés - Gestión interna",
    short_name: "Morita Bebés",
    description: "Sistema de gestión interna de Morita Bebés.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#f8f7f4",
    theme_color: "#5d506d",
    lang: "es-AR",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/morita-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/morita-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/morita-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
