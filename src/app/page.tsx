"use client";

import dynamic from "next/dynamic";

// Skip SSR entirely for the whole client app to prevent React hydration
// mismatch (#418).  ThemeProvider / I18nProvider / Toaster all render
// differently on server vs client (theme class, locale from localStorage,
// etc.), so we avoid SSR completely.  The dashboard is a fully client-side
// app that fetches all data via API routes — there is no SEO benefit from
// SSR for the main page content.
const ClientApp = dynamic(
  () => import("@/components/client-app"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading PoE2 Market Dashboard...</p>
        </div>
      </div>
    ),
  }
);

export default function Page() {
  return <ClientApp />;
}
