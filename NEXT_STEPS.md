# PoE2 Market Dashboard — Next Steps

## Current Status (v0.1)

Working dashboard with:
- 3 tabs: Currencies, Uniques, Exchange
- Realm & League selection
- Currency cards with sparklines and % change
- Unique items table with mini-trends
- Exchange pairs with prices and volumes
- Detail view: click item -> price history chart + volume chart
- Search, category filters, pagination for uniques
- Dark theme, 60s server cache + React Query staleTime
- 6 API proxy routes (CORS bypass)

---

## Priority 1 — Core Improvements

### 1.1 Candlestick Charts (DailyStatsHistory)
- API endpoint: `GET /api/{Realm}/Leagues/{Name}/Items/{ItemId}/DailyStatsHistory?DayCount=30`
- Returns OHLCV data: `{ day, open, high, low, close, volume }`
- Implementation:
  - Add `getDailyStats` call to `src/lib/poe2api.ts` (already exists)
  - Add `action=daily` to `/api/poe2/items` proxy (already exists)
  - Use Recharts `ComposedChart` with custom candlestick rendering
  - Or use a library like `react-financial-charts` for proper candlestick support
  - Add toggle in detail dialog: "Hourly" vs "Daily (Candlestick)"

### 1.2 Auto-Refresh (Polling)
- Add React Query `refetchInterval: 60000` (60s) to all queries
- Or implement manual polling with a toggle button in header
- Show "Last updated: X seconds ago" indicator
- Pause polling when tab is not visible (`refetchIntervalInBackground: false`)

### 1.3 Table Sorting
- Add sort state for unique items table
- Sortable columns: Name, Price, Change, 7d Change, Volume
- Click column header to toggle asc/desc/none
- Use `@tanstack/react-table` (already installed) for proper sorting

### 1.4 Pagination Improvements
- Currencies tab: add pagination (currently shows all)
- Use `PaginatedResponse` page/totalPages from API
- Add "Per page" selector (25/50/100)
- Keyboard navigation (arrow keys for pages)

---

## Priority 2 — Analytics

### 2.1 Market Overview Page
- New tab: "Overview"
- Data sources:
  - `GET /api/{Realm}/Leagues/{Name}/ExchangeSnapshot` — current market state
  - `GET /api/{Realm}/Leagues/{Name}/SnapshotHistory?Limit=168` — hourly history
- Display:
  - Total market volume (24h)
  - Number of tracked items
  - Volume trend chart (7 days)
  - Top movers (biggest % changes)

### 2.2 Currency Pair Detail Page
- Click on exchange pair -> detailed view
- API: `GET /api/{Realm}/Leagues/{Name}/Currencies/Pairs/{Id1}/{Id2}/History?Limit=168`
- Chart: RelativePrice over time
- Show spread, min/max, average

### 2.3 Top Gainers / Losers
- Sort all items by changePercent
- Show top 10 gainers and top 10 losers in separate cards
- Timeframe selector: 24h / 7d

### 2.4 Item Comparison
- "Compare" button on items
- Select 2 items -> overlay their price histories on one chart
- Normalize to % change from start for fair comparison
- Store comparison list in Zustand store

---

## Priority 3 — Personalization

### 3.1 Favorites / Watchlist
- Store favorite item IDs in `localStorage`
- Add star icon on each item card/row
- New tab: "Watchlist" showing only favorited items
- Persist across sessions

### 3.2 Browser Notifications
- Use `Notification API` (requires user permission)
- Set price thresholds on favorited items
- Check thresholds on each data refresh
- Show notification when price crosses threshold

### 3.3 Export Data
- "Export CSV" button on tables
- Convert current view to CSV download
- Also support JSON export
- Use `Blob` + `URL.createObjectURL` for client-side generation

### 3.4 Base Currency Selection
- API supports `ReferenceCurrency` parameter
- Add dropdown to select base currency (Chaos Orb, Divine Orb, etc.)
- Data source: `GET /api/{Realm}/Leagues/{Name}/ReferenceCurrencies`
- Recalculate all prices relative to selected currency

---

## Priority 4 — Advanced Features

### 4.1 Arbitrage Calculator
- Data source: `GET /api/{Realm}/Leagues/{Name}/SnapshotPairs`
- Algorithm:
  - Build directed graph of currency pairs
  - Find cycles where product of exchange rates > 1
  - Calculate profit after factoring in volume constraints
- Display: "Route: A→B→C→A, Profit: +2.3%"
- Warning: market prices change fast, arbitrage windows are brief

### 4.2 Light/Dark Theme Toggle
- Use `next-themes` (already installed)
- Add toggle button in header
- Persist preference in `localStorage`

### 4.3 PWA (Offline Support)
- Add `manifest.json` to `public/`
- Register service worker for offline caching
- Cache API responses in IndexedDB
- Show "Offline mode" banner when disconnected

### 4.4 Telegram/Discord Bot
- Separate Node.js service (not in Next.js)
- Use the same API proxy logic
- Commands: `/price <item>`, `/top`, `/watchlist`
- Scheduled alerts via cron

---

## Technical Notes

### Adding a New API Endpoint

1. Add function in `src/lib/poe2api.ts`:
```typescript
export async function getNewData(realm: string, league: string): Promise<SomeType> {
  return cachedFetch<SomeType>(`${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/NewEndpoint`);
}
```

2. Add route handler in `src/app/api/poe2/<route>/route.ts`:
```typescript
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const realm = searchParams.get("realm");
  const league = searchParams.get("league");
  // ... call function, return NextResponse.json(data)
}
```

3. Add fetch in page.tsx:
```typescript
const { data } = useQuery({
  queryKey: ["newData", realm, league],
  queryFn: () => fetchApi("/api/poe2/<route>", { realm, league }),
  enabled: !!effectiveLeague,
});
```

### Component Architecture (Future)

For larger features, split page.tsx into components:
```
src/components/
  dashboard/
    header.tsx          — realm/league select, search, refresh
    currency-card.tsx   — single currency card
    currency-grid.tsx   — grid of currency cards
    unique-table.tsx    — uniques table with pagination
    exchange-grid.tsx   — exchange pairs grid
    detail-dialog.tsx   — item detail modal
    sparkline.tsx       — inline SVG sparkline
    chart-panel.tsx     — Recharts wrapper
```

### Performance Considerations

- **Memoization**: Use `React.memo` for card/row components when list exceeds 100 items
- **Virtualization**: Consider `@tanstack/react-virtual` for very large lists
- **Debouncing**: Debounce search input (300ms) to avoid excessive API calls
- **Prefetching**: Use `queryClient.prefetchQuery` on hover for detail views

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
