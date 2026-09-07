export function GET() {
  return Response.json({
    name: "Morita Bebés - Tienda online",
    short_name: "Morita Bebés",
    description: "Tienda minorista y mayorista de Morita Bebés.",
    start_url: "/tienda",
    scope: "/tienda",
    display: "standalone",
    background_color: "#fbfaf8",
    theme_color: "#66547a",
    lang: "es-AR",
    categories: ["shopping", "lifestyle"],
    icons: [
      { src: "/icons/morita-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/morita-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/morita-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "Cache-Control": "public, max-age=0, must-revalidate", "Content-Type": "application/manifest+json" } });
}
