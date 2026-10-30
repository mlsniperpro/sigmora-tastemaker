import type { Metadata, Viewport } from "next";
import "./globals.css";

/** The absolute origin for link-preview images: the configured site, else Vercel's production domain, else local. */
function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const candidate = explicit || (vercel ? `https://${vercel}` : "");
  try {
    if (candidate) return new URL(candidate);
  } catch {
    // A malformed value falls back to the local origin rather than failing the build.
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "Tastemaker by Sigmora — don't guess the culture, query it",
  description:
    "A marketing agent that plans a launch campaign and checks every cultural choice against Qloo before it ships. Every pick carries a receipt; a Without-Qloo toggle shows what the plain LLM got wrong.",
};

export const viewport: Viewport = { themeColor: "#0b0b10", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
