# PoE2 Market Dashboard — Next Steps

## Current Status (v0.5)

Working dashboard with all core features + stability/resilience + i18n + critical bug fixes:
- **6 tabs**: Overview, Currencies, Uniques, Exchange, Arbitrage, Watchlist
- **Full i18n (RU/EN)**: Complete Russian and English interface with language switcher (Globe icon in header)
- All features from v0.4 (error boundaries, retry with backoff, virtual currencies, ARIA labels, type consolidation)
- **Fixed React #418 hydration error**: Root cause was `output: "standalone"` in next.config.ts breaking `next start`, combined with I18nProvider and Zustand reading localStorage during SSR initialization
- **Fixed hydration mismatch in I18nProvider**: Locale now always initializes as "ru" (default), then updates from localStorage in useEffect after mount
- **Fixed hydration mismatch in Zustand store**: Favorites/alerts/pairComparison now start empty, rehydrated from localStorage via explicit `rehydrate()` call in useEffect
- **Added i18n pluralization**: `tp()` function with Intl.PluralRules for Russian plural forms (1 предмет / 2 предмета / 5 предметов)
- **Added a11y skip-to-content link**: WCAG 2.1 AA compliant skip navigation link

---

## Completed in v0.5

| # | Feature | Status |
|---|---------|--------|
| 5.6 | Fix React #418 Hydration Error | Done — Removed `output: "standalone"` from next.config.ts (was breaking `next start`). Fixed I18nProvider and Zustand store to avoid reading localStorage during SSR. |
| 5.7 | Fix start.bat Compatibility | Done — start.bat now works correctly with `next start` (no more standalone warning). Added comment about Docker standalone option. |
| 5.8 | i18n Pluralization | Done — Added `tp()` function using Intl.PluralRules. Supports Russian 3-form plural (1 предмет / 2 предмета / 5 предметов) and English 2-form (1 item / 2 items). Pipe-separated template format: `"key|form0|form1|form2"`. |
| 5.9 | a11y: Skip-to-Content Link | Done — Added `<a href="#main-content">` skip link in layout.tsx. Main content has `id="main-content"`. Visually hidden by default, visible on focus. |
| 5.10 | Store Hydration Fix | Done — Zustand store no longer reads localStorage during initialization. Uses `rehydrate()` method called in useEffect via `<StoreRehydrator>` wrapper. Eliminates SSR/client state mismatch. |

---

## What Remains Unimplemented

| Feature | Reason |
|---------|--------|
| **Telegram/Discord Bot** (4.4) | Out of scope for Next.js dashboard. Requires a separate Node.js service. Not planned for this repo. |
| **Full SSR/ISR** | Current page is fully client-rendered ("use client"). True ISR would require significant refactoring: splitting into server/client components, prefetching data server-side. The pragmatic SEO improvements (metadata, sitemap, OG tags) are already in place. Full SSR/ISR is a major architectural change. |
| **Comprehensive Tests** | Basic test setup with Jest + React Testing Library is now in place with unit tests for `types.ts`, `store.ts`. Integration tests for components and E2E tests (Playwright/Cypress) are still needed. Tests may need updates for i18n mock context. Store now needs rehydrate() mock. |
| **Advanced arbitrage refinements** | The current slippage model uses a square-root impact model which is a reasonable approximation. Real-world improvements would include: order-book depth analysis, real-time graph updates via WebSocket, time-decay weighting, cross-league arbitrage. These require significant backend infrastructure. |
| **Formal a11y Audit** | ARIA labels added for major interactive elements. Skip-to-content link added. A formal WCAG 2.1 AA audit is still recommended. Remaining gaps: focus management in dialogs (trap focus, return focus on close), color contrast verification, screen reader testing, reduced-motion media query. |
| **Focus trapping in dialogs** | Radix Dialog (used by shadcn/ui) already handles focus trapping. Verify that all custom dialogs properly trap focus and return focus on close. |
| **More languages** | Current i18n supports Russian and English. Adding more languages (e.g., Chinese, Korean, Portuguese) requires creating new locale files in `src/lib/i18n/locales/`. The system is designed to make this easy. |
| **Reduced motion** | Respect `prefers-reduced-motion` media query for chart animations and transitions. |

---

## Technical Debt

1. **`usePriceAlerts` hook in page.tsx**: The hook is called with `effectiveLeagueRaw` before it's declared in some code paths. This works because of hoisting but is confusing. Consider restructuring.

2. ~~**Duplicate type definitions**: Types are defined in both `src/lib/types.ts` and `src/lib/poe2api.ts`.~~ FIXED — Types consolidated into `types.ts`, `poe2api.ts` imports from it.

3. ~~**`start.bat` Windows compatibility**:~~ FIXED in v0.5 — Now works with standard `next start` (standalone output removed).

4. **Bundle size**: Package.json cleaned up. Removed invalid `next/jest` alias. Further audit of devDependencies recommended.

5. **Candlestick chart rendering**: The custom CandlestickShape in DetailDialog uses a fixed `chartHeight` value which may not match the actual rendered height. Consider using Recharts' internal scale or a ref-based approach.

6. **VirtualCurrencyGrid column layout**: The virtual currency grid uses a simplified layout approach. For complex responsive grid layouts with virtualization, a more sophisticated approach may be needed for very large datasets (200+).

7. ~~**i18n: ErrorBoundary class component**:~~ The ErrorBoundary uses React context directly (static contextType) instead of hooks because it's a class component. If migrated to a functional component with error boundary library, this could use the standard `useI18n()` hook. Low priority.

8. **i18n: Pluralization in existing strings**: The `tp()` function has been added but most existing `t()` calls still use simple interpolation `{0}` for counts. These should be gradually migrated to `tp()` for correct Russian plural forms. Key candidates: `alertsCount`, `compare`, `pairCompare`, `scannedPairs`, `opportunitiesFound`, `pageOf`, etc.

---

## Files Changed in v0.5

| File | Changes |
|------|---------|
| `next.config.ts` | **CRITICAL FIX**: Removed `output: "standalone"` — was causing React #418 error with `next start` |
| `src/lib/i18n/index.tsx` | **CRITICAL FIX**: Locale initializes as DEFAULT_LOCALE ("ru") to avoid hydration mismatch. Added `tp()` pluralization function with Intl.PluralRules. Added `hydrated` state. Real locale loaded in useEffect after mount. |
| `src/lib/store.ts` | **CRITICAL FIX**: Deferred localStorage reads. State starts empty on SSR/first render. Added `rehydrate()` method and `_hydrated` flag. Called via `StoreRehydrator` in providers. |
| `src/components/providers.tsx` | Added `<StoreRehydrator>` wrapper that calls `store.rehydrate()` in useEffect after mount |
| `src/app/layout.tsx` | Added skip-to-content link (`<a href="#main-content">`) for WCAG 2.1 AA a11y |
| `src/app/page.tsx` | Added `id="main-content"` to main element. Uses `tp()` for pluralized button labels |
| `start.bat` | Added comments about standalone mode removal. Works correctly with `next start` now |
| `NEXT_STEPS.md` | Updated to v0.5 status |

---

## API Endpoints Reference

| Group | Endpoint | Parameters | Returns |
|---|---|---|---|
| Realms | `GET /api/Realms` | — | List of realms |
| Realms | `GET /api/Realms/{Realm}/Filters` | Realm | Search filters |
| Realms | `GET /api/Realms/{Realm}/LandingSplashInfo` | Realm | Top items |
| Leagues | `GET /api/{Realm}/Leagues` | Realm | Leagues list |
| Leagues | `GET /api/{Realm}/Leagues/{Name}/ExchangeSnapshot` | Realm, Name | Exchange snapshot |
| Leagues | `GET /api/{Realm}/Leagues/{Name}/ReferenceCurrencies` | Realm, Name | Base currencies |
| Leagues | `GET /api/{Realm}/Leagues/{Name}/SnapshotHistory` | Realm, Name, Limit | Market history |
| Leagues | `GET /api/{Realm}/Leagues/{Name}/SnapshotPairs` | Realm, Name | All pairs |
| Items | `GET /api/{Realm}/Leagues/{Name}/Items` | Realm, Name | All items |
| Items | `GET /api/{Realm}/Leagues/{Name}/Items/Categories` | Realm, Name | Categories |
| Items | `GET /api/{Realm}/Leagues/{Name}/Items/{ItemId}` | Realm, Name, ItemId | Single item |
| Items | `GET /api/{Realm}/Leagues/{Name}/Items/{ItemId}/History` | Realm, Name, ItemId, LogCount | Hourly price history |
| Items | `GET /api/{Realm}/Leagues/{Name}/Items/{ItemId}/DailyStatsHistory` | Realm, Name, ItemId, DayCount | Daily OHLCV |
| Uniques | `GET /api/{Realm}/Leagues/{Name}/Uniques/ByCategory` | Realm, Name, Category, Page, PerPage, Search | Paginated uniques |
| Currencies | `GET /api/{Realm}/Leagues/{Name}/Currencies/ByCategory` | Realm, Name, Category, Page, PerPage | Paginated currencies |
| Currencies | `GET /api/{Realm}/Leagues/{Name}/Currencies/{ApiId}` | Realm, Name, ApiId | Single currency |
| Currencies | `GET /api/{Realm}/Leagues/{Name}/Currencies/Pairs/{Id1}/{Id2}/History` | Realm, Name, Id1, Id2, Limit | Pair price history |
| Health | `GET /api/health/live` | — | API health check |

Base URL: `https://poe2scout.com/api`
All requests MUST go through Next.js API proxy routes (CORS restriction).
