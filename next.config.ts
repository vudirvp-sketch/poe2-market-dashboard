import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Removed "output: standalone" — it breaks `next start` in local dev.
  // If you need Docker/standalone deployment, uncomment the line below
  // and use `node .next/standalone/server.js` instead of `next start`.
  // output: "standalone",

  // NOTE: In Next.js 16, the `eslint` key is no longer supported in next.config.
  // Use `next lint` CLI options or eslint.config.js instead.
  // Previously: eslint: { ignoreDuringBuilds: true } — REMOVED

  // ignoreBuildErrors removed — all TypeScript errors have been fixed.
  // If new TS errors appear during development, fix them rather than re-enabling this.
  typescript: {},
  reactStrictMode: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "poe2scout.com",
      },
      {
        protocol: "https",
        hostname: "web.poecdn.com",
      },
      {
        protocol: "https",
        hostname: "api.poe2scout.com",
      },
    ],
  },
};

export default nextConfig;
