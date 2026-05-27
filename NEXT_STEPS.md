# PoE2 Market Dashboard — Next Steps

## Current Status (v0.4)

Working dashboard with all core features + stability/resilience + i18n improvements:
- **6 tabs**: Overview, Currencies, Uniques, Exchange, Arbitrage, Watchlist
- **Full i18n (RU/EN)**: Complete Russian and English interface with language switcher (Globe icon in header)
- All features from v0.3 (error boundaries, retry with backoff, virtual currencies, ARIA labels, type consolidation)
- **Fixed build detection**: start.bat now checks `.next/BUILD_ID` instead of `.next\` directory
- **Fixed jest config**: Replaced non-existent `next/jest` alias with standard `ts-jest`

---

## ✅ Completed in v0.4

| # | Feature | Status |
|---|---------|--------|
| 5.1 | Internationalization (i18n) | ✅ Done — Custom i18n context with RU/EN locales, language switcher, all UI text translated |
| 5.2 | Build Error Fix | ✅ Done — start.bat now checks BUILD_ID file, not just directory existence |
| 5.3 | Jest Config Fix | ✅ Done — Replaced invalid `next/jest` package alias with `ts-jest` |
| 5.4 | Language Switcher | ✅ Done — Globe icon button in header toggles RU/EN, persisted in localStorage |
| 5.5 | Layout Lang Attribute | ✅ Done — HTML lang attribute updates dynamically with locale |

---

## ❌ What Remains Unimplemented

| Feature | Reason |
|---------|--------|
| **Telegram/Discord Bot** (4.4) | Out of scope for Next.js dashboard. Requires a separate Node.js service. Not planned for this repo. |
| **Full SSR/ISR** | Current page is fully client-rendered ("use client"). True ISR would require significant refactoring: splitting into server/client components, prefetching data server-side. The pragmatic SEO improvements (metadata, sitemap, OG tags) are already in place. Full SSR/ISR is a major architectural change. |
| **Comprehensive Tests** | Basic test setup with Jest + React Testing Library is now in place with unit tests for `types.ts`, `store.ts`. Integration tests for components and E2E tests (Playwright/Cypress) are still needed. Tests may need updates for i18n mock context. |
| **Advanced arbitrage refinements** | The current slippage model uses a square-root impact model which is a reasonable approximation. Real-world improvements would include: order-book depth analysis, real-time graph updates via WebSocket, time-decay weighting, cross-league arbitrage. These require significant backend infrastructure. |
| **Full Accessibility (a11y) Audit** | ARIA labels have been added for major interactive elements (tabs, buttons, grids, alerts). A formal WCAG 2.1 AA audit is still recommended. Remaining gaps: focus management in dialogs, skip-to-content link, color contrast verification, screen reader testing. |
| **Performance: Bundle size** | The package.json was cleaned up — removed the invalid `next/jest` alias. Some rarely-used devDependencies could still be audited for removal. |
| **More languages** | Current i18n supports Russian and English. Adding more languages (e.g., Chinese, Korean, Portuguese) requires creating new locale files in `src/lib/i18n/locales/`. The system is designed to make this easy. |
| **i18n: Pluralization** | The current i18n system uses simple string interpolation `{0}`, `{1}`. For full pluralization support (e.g., "1 item" vs "5 items" in Russian with its complex plural rules), a more sophisticated system like `Intl.PluralRules` or icu message format would be needed. |

---

## Technical Debt

1. **`usePriceAlerts` hook in page.tsx**: The hook is called with `effectiveLeagueRaw` before it's declared in some code paths. This works because of hoisting but is confusing. Consider restructuring.

2. ~~**Duplicate type definitions**: Types are defined in both `src/lib/types.ts` and `src/lib/poe2api.ts`.~~ ✅ FIXED — Types consolidated into `types.ts`, `poe2api.ts` imports from it.

3. **`start.bat` Windows compatibility**: Fixed in v0.4 — now checks `.next\BUILD_ID` for reliable build detection.

4. **Bundle size**: Package.json cleaned up. Removed invalid `next/jest` alias. Further audit of devDependencies recommended.

5. **Candlestick chart rendering**: The custom CandlestickShape in DetailDialog uses a fixed `chartHeight` value which may not match the actual rendered height. Consider using Recharts' internal scale or a ref-based approach.

6. **VirtualCurrencyGrid column layout**: The virtual currency grid uses a simplified layout approach. For complex responsive grid layouts with virtualization, a more sophisticated approach may be needed for very large datasets (200+).

7. **i18n: ErrorBoundary class component**: The ErrorBoundary uses React context directly (static contextType) instead of hooks because it's a class component. If migrated to a functional component with error boundary library, this could use the standard `useI18n()` hook.

---

## New Files Added in v0.4

| File | Purpose |
|------|---------|
| `src/lib/i18n/index.tsx` | I18n context provider, useI18n hook, locale management |
| `src/lib/i18n/locales/en.ts` | English translations (all UI strings) |
| `src/lib/i18n/locales/ru.ts` | Russian translations (all UI strings) |

## Modified Files in v0.4

| File | Changes |
|------|---------|
| `src/components/providers.tsx` | Added I18nProvider wrapper |
| `src/components/dashboard/header.tsx` | Added Globe language switcher, i18n for all text, timeAgo i18n |
| `src/app/page.tsx` | All tab labels, button text, error messages, aria-labels → i18n |
| `src/app/layout.tsx` | Changed default lang from "en" to "ru" |
| `src/components/dashboard/market-overview.tsx` | All text → i18n |
| `src/components/dashboard/currency-card.tsx` | Vol, Low Confidence, comparison tooltip → i18n |
| `src/components/dashboard/unique-table.tsx` | Column headers, comparison tooltip → i18n |
| `src/components/dashboard/exchange-pair-card.tsx` | Vol, comparison tooltip → i18n |
| `src/components/dashboard/virtual-currency-grid.tsx` | Aria-labels, Vol, Low Confidence → i18n |
| `src/components/dashboard/detail-dialog.tsx` | All labels, chart titles, tooltips → i18n |
| `src/components/dashboard/pair-detail-dialog.tsx` | Stats labels, chart title → i18n |
| `src/components/dashboard/comparison-dialog.tsx` | Dialog title, table headers, messages → i18n |
| `src/components/dashboard/pair-comparison-dialog.tsx` | Dialog title, table headers, messages → i18n |
| `src/components/dashboard/price-alert-dialog.tsx` | All labels, descriptions, buttons → i18n |
| `src/components/dashboard/arbitrage-tab.tsx` | All labels, descriptions, settings, footer → i18n |
| `src/components/dashboard/watchlist-tab.tsx` | Empty state messages → i18n |
| `src/components/dashboard/error-boundary.tsx` | Error messages, retry button → i18n (via I18nContext) |
| `src/components/dashboard/api-error-fallback.tsx` | All error messages, retry button → i18n |
| `src/components/dashboard/offline-banner.tsx` | Offline message, dismiss label → i18n |
| `src/components/dashboard/pagination.tsx` | Per page, items, page of → i18n |
| `start.bat` | Fixed build detection: `.next\BUILD_ID` instead of `.next\` |
| `package.json` | Fixed `next/jest` alias → `ts-jest` |
| `jest.config.ts` | Simplified: removed `next/jest`, using plain ts-jest config |
| `NEXT_STEPS.md` | Updated to v0.4 status |

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
