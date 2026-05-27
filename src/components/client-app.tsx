"use client";

import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { Dashboard } from "@/components/dashboard/dashboard-page";

/**
 * Client-only wrapper that combines Providers + Dashboard + Toaster.
 * Imported via dynamic({ ssr: false }) in page.tsx so that NONE of
 * these components are server-rendered.  This eliminates the React
 * hydration mismatch (#418) that was caused by ThemeProvider /
 * I18nProvider / Toaster rendering different output on server vs
 * client.
 */
export default function ClientApp() {
  return (
    <Providers>
      <Dashboard />
      <Toaster richColors />
    </Providers>
  );
}
