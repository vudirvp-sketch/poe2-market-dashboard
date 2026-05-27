import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Removed "output: standalone" — it breaks `next start` in local dev.
  // If you need Docker/standalone deployment, uncomment the line below
  // and use `node .next/standalone/server.js` instead of `next start`.
  // output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
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
    ],
  },
};

export default nextConfig;
