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
  { ssr: false }
);

export default function Page() {
  return <ClientApp />;
}
