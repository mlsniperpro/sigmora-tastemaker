import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
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
