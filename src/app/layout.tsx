import type { Metadata, Viewport } from "next";
import "./globals.css";

import { PwaProvider } from "@/components/pwa/pwa-provider";

export const metadata: Metadata = {
  title: {
    default: "Morita Bebes",
    template: "%s | Morita Bebes",
  },
  applicationName: "Morita Bebés",
  description: "Sistema de gestión interna de Morita Bebés.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Morita Bebés",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/morita-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#5d506d",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head><meta content="yes" name="apple-mobile-web-app-capable" /></head>
      <body><PwaProvider>{children}</PwaProvider></body>
    </html>
  );
}
