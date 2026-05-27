import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
