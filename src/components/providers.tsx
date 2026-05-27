"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, useEffect, type ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n";
import { useDashboardStore } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // 60 seconds
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <I18nProvider>
          <StoreRehydrator>{children}</StoreRehydrator>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * Triggers Zustand store rehydration from localStorage AFTER mount.
 * This avoids hydration mismatches because SSR always renders with
 * empty state, and the real data is loaded client-side only.
 */
function StoreRehydrator({ children }: { children: ReactNode }) {
  const rehydrate = useDashboardStore((s) => s.rehydrate);

  useEffect(() => {
    rehydrate();
  }, [rehydrate]);

  return <>{children}</>;
}
