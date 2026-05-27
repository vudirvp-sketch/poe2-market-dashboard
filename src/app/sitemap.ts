// ============================================================================
// Sitemap for SEO (Priority: ISR/SEO improvement)
// Generates a dynamic sitemap from available realms and leagues
// ============================================================================
import type { MetadataRoute } from "next";

const BASE_URL = "https://poe2-market-dashboard.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1.0,
    },
  ];

  return staticPages;
}
