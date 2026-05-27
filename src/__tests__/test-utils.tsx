// ============================================================================
// Test Utilities — renderWithProviders for integration tests
// Wraps components with I18nProvider, QueryClientProvider, and
// optionally pre-seeds localStorage for store rehydration tests.
// ============================================================================
import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement } from "react";
import { I18nProvider, type Locale } from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface RenderWithProvidersOptions extends RenderOptions {
  locale?: Locale;
  /** Pre-seed localStorage keys before mounting (e.g. poe2-locale, poe2-favorites) */
  localStorageData?: Record<string, string>;
}

/**
 * Create a fresh QueryClient for each test to prevent shared state.
 * Disables retries to keep tests fast and deterministic.
 */
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

/**
 * Render a component wrapped with all required providers.
 * Use this instead of raw `render()` for any component that
 * depends on i18n, react-query, or other context.
 */
export function renderWithProviders(
  ui: ReactElement,
  { locale, localStorageData, ...renderOptions }: RenderWithProvidersOptions = {}
) {
  // Pre-seed localStorage BEFORE mounting, so I18nProvider and
  // StoreRehydrator can read the values during their first useEffect.
  if (localStorageData) {
    Object.entries(localStorageData).forEach(([key, value]) => {
      window.localStorage.setItem(key, value);
    });
  }

  // If a locale is explicitly provided, we seed it so the I18nProvider
  // will pick it up during hydration (its useEffect reads localStorage).
  if (locale) {
    window.localStorage.setItem("poe2-locale", locale);
  }

  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient,
  };
}

/**
 * Re-export commonly used testing utilities for convenience.
 */
export { screen, fireEvent, waitFor, act } from "@testing-library/react";
