import type { NextConfig } from "next";
import { loadConfig } from "./src/lib/config";

// Validate the environment at build time: a bad value (say, budget shares that can't fit one run) fails
// the deploy, and the last good deploy keeps serving, instead of every request failing at runtime.
loadConfig(process.env);

/** OpenFreeMap serves the map style, tiles, glyphs and sprites. */
const TILES = "https://tiles.openfreemap.org";

/**
 * Security headers for every route. The CSP allows inline scripts and styles
 * because Next's prerendered bootstrap is inline (a nonce would force dynamic
 * rendering); dev additionally needs eval for fast refresh. MapLibre runs its
 * worker from a blob: URL.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${TILES}`,
  `connect-src 'self' ${TILES}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  },
};

export default nextConfig;
