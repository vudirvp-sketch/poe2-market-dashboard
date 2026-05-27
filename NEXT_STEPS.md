# PoE2 Market Dashboard — Next Steps

## Current Status (v0.2)

Working dashboard with all core features:
- **6 tabs**: Overview, Currencies, Uniques, Exchange, Arbitrage, Watchlist
- Realm & League selection
- Currency cards with sparklines and % change
- Unique items table with mini-trends, sorting, virtualization
- Exchange pairs with prices and volumes
- Detail view: click item -> price history chart + volume chart
- **Candlestick chart** (Daily OHLCV) with toggle in detail dialog
- **Auto-refresh** (60s polling) with toggle and "last updated" indicator
- **Table sorting** via @tanstack/react-table (Name, Price, Change, 7d, Volume)
- **Pagination** with per-page selector (25/50/100) and keyboard navigation
- **Market Overview**: total volume, tracked items, exchange pairs, volume trend chart, top gainers/losers (24h/7d)
- **Currency Pair Detail**: click exchange pair -> history chart + stats (min/max/avg/spread)
- **Item Comparison**: compare 2-4 items on normalized % chart
- **Pair Comparison**: compare 2-4 exchange pairs
- **Favorites / Watchlist**: star items, persisted in localStorage
- **Browser Notifications**: price alerts with above/below thresholds
- **Export Data**: CSV/JSON export from any tab
- **Base Currency Selection**: ReferenceCurrency dropdown
- **Arbitrage Calculator**: cycle detection with slippage model, fees, volume constraints, settings panel
- **Light/Dark Theme Toggle**: via next-themes
- **PWA**: manifest.json, service worker, offline banner, icons (192px, 512px)
- **Skeleton Loading**: shimmer UI replacing Loader2 spinners
- **SEO**: metadata, OpenGraph, Twitter cards, sitemap, robots.txt
- Dark theme, 60s server cache + React Query staleTime
- 6 API proxy routes (CORS bypass)
- Search with debounce (300ms)
- Prefetch on hover for detail views
- React.memo on card components

---

## ✅ Completed from Original NEXT_STEPS.md

| # | Feature | Status |
|---|---------|--------|
| 1.1 | Candlestick Charts | ✅ Done — ComposedChart with custom shapes + toggle |
| 1.2 | Auto-Refresh | ✅ Done — 60s polling toggle + "last updated" |
| 1.3 | Table Sorting | ✅ Done — @tanstack/react-table with SortHeader |
| 1.4 | Pagination Improvements | ✅ Done — Per-page selector, keyboard nav |
| 2.1 | Market Overview | ✅ Done — Stats, volume chart, top movers |
| 2.2 | Currency Pair Detail | ✅ Done — PairDetailDialog with stats |
| 2.3 | Top Gainers / Losers | ✅ Done — In MarketOverview with 24h/7d toggle |
| 2.4 | Item Comparison | ✅ Done — ComparisonDialog normalized % chart |
| 3.1 | Favorites / Watchlist | ✅ Done — localStorage persistence |
| 3.2 | Browser Notifications | ✅ Done — PriceAlertDialog + usePriceAlerts |
| 3.3 | Export Data | ✅ Done — CSV/JSON from any tab |
| 3.4 | Base Currency Selection | ✅ Done — ReferenceCurrency dropdown |
| 4.1 | Arbitrage Calculator | ✅ Done — Advanced with slippage/fees/volume |
| 4.2 | Light/Dark Theme | ✅ Done — next-themes toggle |
| 4.3 | PWA | ✅ Done — manifest, SW, offline banner, icons |
| — | Skeleton Loading | ✅ Done — Shimmer UI for all tabs |
| — | SEO Improvements | ✅ Partial — Metadata, OG, sitemap, robots |

---

## ❌ What Remains Unimplemented

| Feature | Reason |
|---------|--------|
| **Telegram/Discord Bot** (4.4) | Out of scope for Next.js dashboard. Requires a separate Node.js service. Not planned for this repo. |
| **Full SSR/ISR** | Current page is fully client-rendered ("use client"). True ISR would require significant refactoring: splitting into server/client components, prefetching data server-side. The pragmatic SEO improvements (metadata, sitemap, OG tags) are already in place. Full SSR/ISR is a major architectural change. |
| **Tests (comprehensive)** | Basic test setup with Jest + React Testing Library is now in place with unit tests for `types.ts` (fmt, fmtChange, export), `store.ts` (favorites, comparison, alerts, pair comparison), and `poe2api.ts` (type validation). Integration tests for components and E2E tests (Playwright/Cypress) are still needed. |
| **Advanced arbitrage refinements** | The current slippage model uses a square-root impact model which is a reasonable approximation. Real-world improvements would include: order-book depth analysis, real-time graph updates via WebSocket, time-decay weighting, cross-league arbitrage. These require significant backend infrastructure. |
| **Performance: Virtual scrolling for currencies** | Currency grid currently renders all items. For leagues with 100+ currencies, virtual scrolling (react-window/react-virtual) would improve performance. Uniques table already uses virtualization. |
| **Accessibility (a11y)** | No formal a11y audit done. Keyboard navigation exists for pagination, but screen reader support, ARIA labels, and focus management need attention. |
| **Internationalization (i18n)** | All UI text is in English. next-intl is installed but not configured. |
| **Error boundaries** | No React error boundaries. A single component crash could break the entire dashboard. |
| **Rate limiting / API fallbacks** | No client-side rate limiting. If poe2scout API is down or rate-limited, there's no fallback UI beyond the error state. Could add retry logic with exponential backoff. |

---

## Technical Debt

1. **`usePriceAlerts` hook in page.tsx**: The hook is called with `effectiveLeagueRaw` before it's declared in some code paths. This works because of hoisting but is confusing. Consider restructuring.

2. **Duplicate type definitions**: Types are defined in both `src/lib/types.ts` and `src/lib/poe2api.ts`. Consider consolidating into a single source of truth.

3. **`start.bat` Windows compatibility**: The `package.json` start script uses `bun` and Unix-style env vars. The `start.bat` now uses `npx next start` as a portable alternative.

4. **Bundle size**: Many unused dependencies in package.json (prisma, next-auth, mdxeditor, etc.) from the project template. Consider removing them to reduce build size.

5. **Candlestick chart rendering**: The custom CandlestickShape in DetailDialog uses a fixed `chartHeight` value which may not match the actual rendered height. Consider using Recharts' internal scale or a ref-based approach.

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
