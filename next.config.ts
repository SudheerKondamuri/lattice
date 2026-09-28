import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: { root: process.cwd() },
  async headers() {
    return [
      {
        source: "/widget",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          {
            key: "Content-Security-Policy",
            value: "object-src 'none'; base-uri 'self'; form-action 'self'",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/app/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
      {
        source: "/auth/:path*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};
export default config;
