"use client";

import dynamic from "next/dynamic";

// Skip SSR entirely for the Dashboard to prevent React hydration mismatch (#418).
// The dashboard is a fully client-side app that fetches all data via API routes,
// so there is no SEO benefit from SSR — and SSR causes hydration errors because
// ThemeProvider / I18nProvider / Zustand store render differently on server vs client.
const Dashboard = dynamic(
  () => import("@/components/dashboard/dashboard-page").then((mod) => mod.Dashboard),
  { ssr: false }
);

export default function Page() {
  return <Dashboard />;
}
