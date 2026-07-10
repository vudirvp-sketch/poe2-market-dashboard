# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-10 (iter 103 — KI-15 + KI-16 opened after deep investigation of "nothing works" report. Root cause: `api.poe2scout.com` subdomain is DEAD; the API now lives at the bare domain `poe2scout.com/api`. Also: iter 102's `turbopackIgnore` fix for KI-12 was a regression that broke the flipper bridge at runtime — reverted.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### KI-15 — `api.poe2scout.com` subdomain is DEAD, all API calls return 404

**Symptom.** Dashboard starts, but every upstream API call fails with `API 404: Not Found`. Browser shows empty data; Python backend cannot fetch snapshot. Logs look like:
```
[poe2api] getRealms: upstream API unreachable, using hardcoded fallback. API 404: Not Found — https://api.poe2scout.com/api/Realms
[poe2api] getLeagues: ... API 404: Not Found — https://api.poe2scout.com/api/poe2/Leagues
[poe2api] getItems: ... API 404: Not Found — https://api.poe2scout.com/api/poe2/Leagues/runes/Items
... (and ~20 more)
```

**Root cause (confirmed iter 103).** The `api.poe2scout.com` subdomain no longer serves the API — every endpoint returns HTTP 404 with an empty body. The API has moved to the bare domain `poe2scout.com/api/*`. All endpoints verified working:
- `https://poe2scout.com/api/Realms` → 200 (539 B)
- `https://poe2scout.com/api/poe2/Leagues` → 200 (13.5 KB)
- `https://poe2scout.com/api/poe2/Leagues/runes/Items` → 200 (455 KB)
- `https://poe2scout.com/api/poe2/Leagues/runes/Items/Categories` → 200 (5.9 KB)
- `https://poe2scout.com/api/poe2/Leagues/runes/SnapshotPairs` → 200 (2.4 MB)
- `https://poe2scout.com/api/poe2/Leagues/runes/SnapshotHistory?Limit=168` → 200
- `https://poe2scout.com/api/poe2/Leagues/runes/ReferenceCurrencies` → 200
- `https://poe2scout.com/api/poe2/Leagues/runes/Currencies/ByCategory?Category=currency&Page=1&PerPage=50` → 200
- `https://poe2scout.com/api/poe2/Leagues/runes/Uniques/ByCategory?Category=armour&Page=1&PerPage=50` → 200

**Why it took so long to find.** `start.bat` and `start.sh` actively created `.env.local` with the wrong URL (`https://api.poe2scout.com/api`) and printed a `[WARN]` telling users the bare domain "causes ECONNRESET/502 errors" — exactly backwards. The warning text was a stale assumption from before the API migration.

**Fix applied (iter 103).** Replaced `api.poe2scout.com` → `poe2scout.com` in all runtime paths:
- `config.yaml` (`data.poe2scout_base_url`)
- `backend/config.py` (`DataConfig.poe2scout_base_url` default)
- `src/lib/poe2api.ts` (`BASE_URL` default + header comment)
- `start.bat` / `start.sh` (`.env.local` auto-generation + warning text now flags the DEAD `api.` subdomain instead of recommending it)
- `next.config.ts` (image hostname — removed `api.poe2scout.com`, kept `poe2scout.com`)
- `cloudflare-worker/worker.js` (`UPSTREAM_BASE` + hostname check)
- `scripts/generate-cache-snapshot.ts`, `scripts/dump-live-data.ts`, `scripts/sync_currency_names_from_poe2db.py` (default URL)
- `src/data/cache-snapshot.json` (URL keys rewritten — 14 entries)
- `src/lib/i18n/locales/{en,ru,ko,zh}.ts` (user-facing error hints)
- `src/app/api/poe2/{health,leagues,realms}/route.ts` (hint strings)
- `backend/data/providers/poe2scout.py` (docstring)
- `docs/{DATA_FLOW,ARCHITECTURE,CORS_PROXY_GUIDE}.md`
- Test fixtures: `src/__tests__/poe2api-ki11-graceful-4xx.test.ts`

**Action required by user.** If `.env.local` already exists locally, delete it (or edit it) so `POE2_API_BASE_URL=https://poe2scout.com/api`. The new `start.bat`/`start.sh` will warn if the old `api.` subdomain is still present.

**Severity.** Critical — this was the root cause of the "nothing works" report.

---

### KI-16 — Flipper backend bridge broken at runtime (regression from iter 102 KI-12 fix)

**Symptom.** After `next start`, the instrumentation hook logs:
```
[instrumentation] Flipper backend bridge failed to start: Cannot find module
'C:\...\poe2-market-dashboard\.next\server\chunks\scripts\flipper-backend-bridge'
imported from C:\...\poe2-market-dashboard\.next\server\chunks\instrumentation_ts_0zq9-xz._.js
[instrumentation] Dashboard will work without analytics.
```
The Python backend never starts. Flipper features (scoring, triangular arbitrage, forecasts, content pulse, etc.) are unavailable.

**Root cause (confirmed iter 103).** In iter 102, KI-12 added `/* turbopackIgnore: true */` to the dynamic `import("./scripts/flipper-backend-bridge")` in `instrumentation.ts` to silence the cosmetic `Encountered unexpected file in NFT list` build warning. The magic comment told Turbopack to **fully exclude** the bridge from the server bundle — so at runtime the `import()` call had no chunk to resolve. The warning was cosmetic; the "fix" was a regression that broke the bridge.

**Fix applied (iter 103).** Removed the `/* turbopackIgnore: true */` magic comment. The NFT warning will reappear during `next build` but is purely cosmetic — the build still succeeds and the bridge works at runtime.

**Long-term fix (not yet done).** Move `scripts/flipper-backend-bridge.ts` into `src/lib/flipper-backend-bridge.ts` so Turbopack treats it as a regular in-source module and bundles it normally — no NFT warning, no special-casing. Tracked as P2 follow-up.

**Severity.** High — without the bridge, all Flipper analytics tabs are dead. The dashboard's PoE2 tabs (currencies, uniques, exchange) still work via the Next.js route handlers, but the analytics layer (flips, speculation, content pulse, etc.) needs the Python backend.

**Workaround if the bridge still fails.** Start the Python backend manually in a separate terminal:
```
PYTHONPATH=. .venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000
```
Then set `FLIPPER_BRIDGE_DISABLED=true` in `.env.local` so the bridge doesn't try to compete.

---

### KI-13 — `/api/v1/prices/stream?threshold_pct=1` returns 400 Bad Request

**Symptom.** Backend log shows `GET /api/v1/prices/stream?threshold_pct=1 HTTP/1.1` → `400 Bad Request`. The SSE endpoint is invoked once on dashboard load.

**Cause (uncertain — needs investigation).** Route handler `backend/api/routes_sse.py:sse_price_stream` defines `threshold_pct: float = Query(0.5, ge=0.0, le=50.0, ...)` — so `threshold_pct=1` SHOULD pass validation. Likely candidates:
1. Middleware rejecting `text/event-stream` (`middleware_compression.py` or CORS).
2. Missing `Accept: text/event-stream` header.
3. Exception in `_sse_event_generator` when snapshot is empty (cascades from a stale `league_name`).

**Severity.** Low — dashboard falls back to polling. The 400 only clutters the log.

**Where to fix.** Add explicit logging at top of `_sse_event_generator`; check `middleware_compression.py` skips `text/event-stream`; verify frontend `EventSource('/api/flipper/prices/stream?threshold_pct=1')` uses the proxy path.

---

## Known Issues — closed (recent)

- **KI-11** (closed iter 102): 502 Bad Gateway on `/api/poe2/uniques` & `/api/poe2/currencies` when upstream returned 404 for the configured league slug. Next.js route handlers now catch `API 4xx` and return an empty `PaginatedResponse` (200 with `items: []`).
- **KI-12** (REOPENED as KI-16 in iter 103): the `turbopackIgnore: true` "fix" was a regression — see KI-16 above.
- **KI-14** (closed iter 101): `leveling-uniques-widget.test.tsx` 2 failing tests — fixed by switching to regex match and snapshotting mock call count.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **KI-16-fix** | P2 | Move `scripts/flipper-backend-bridge.ts` → `src/lib/flipper-backend-bridge.ts` so Turbopack bundles it as a regular module (no NFT warning, no special-casing). |
| **TD-3** | P3 | Triangular arbitrage no persistence. Cannot backtest `executable_estimate`. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. |
| **TD-6** | P3 | `highest_stock` + `current_quantity` not used for Wall detection. |
| **TD-7** | P3 | `PriceMomentumTracker` momentum + volatility computed but not shown. |
| **TD-8** | P3 | Tier classification (T1-T5) not shown anywhere. |
| **TD-9** | P3 | FlipsTable "Trend" sparkline uses derived `momentum × volatility`. Switch to real `priceHistoryShort` when backend adds it. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| All API calls return 404; dashboard empty | **KI-15** — `.env.local` has dead `api.poe2scout.com`. Use `POE2_API_BASE_URL=https://poe2scout.com/api` | `.env.local`, `start.bat`, `start.sh` |
| `[instrumentation] Flipper backend bridge failed to start: Cannot find module` | **KI-16** — iter 102 regression. Reverted in iter 103. If still seen, rebuild `.next` | `instrumentation.ts`, `scripts/flipper-backend-bridge.ts` |
| `test_scheduler.py` collection fails | `aiosqlite` not installed | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) | `backend/predictors/time_series.py:train` |
| Keyboard shortcut "5" goes to Flips, not Arbitrage | By design (iter 92 KI-7) — dead "arbitrage" tab removed from TAB_MAP | `dashboard-page.tsx:TAB_MAP` |
| Keyboard shortcut "0" goes to Circuits, not Liquid Chain | By design (iter 97 F7) | `dashboard-page.tsx:TAB_MAP` |
| Exchange tab shows "Best Payment" strip at the top | By design (iter 93) — top-10 cards strip with savings ≥1%. Hidden when no opportunities exist | `exchange-tab-content.tsx`, `best-payment-top-list.tsx` |
| Best Payment badge doesn't appear on a pair | By design (iter 93, Q3) — pairs with `savingsPct < 1` are hidden | `best-payment-badge.tsx:40`, `use-optimal-payment.ts:BEST_PAYMENT_MIN_SAVINGS_PCT` |
| Craft items (Ritual Omens, Soul Cores) appear in Best Payment | By design (iter 93, Q2) — hook groups by `currency1Id`, covers all priced items | `use-optimal-payment.ts:bestPaymentTopList` |
| FlipsTable "Trend" sparkline looks synthetic | By design (iter 94, Q5) — derived from `momentum × volatility`, NOT historical price data. Tooltip states this. Switches to real data when backend adds `priceHistoryShort` (TD-9) | `flips-helpers.ts:deriveTrendSparklineData` |
| FlipsTable Spread cell color changes | By design (iter 94, Q4) — emerald ≥5% (wide), amber 2-5%, muted <2% | `flips-helpers.ts:classifySpreadTier` |
| Content Pulse shows orange "Overheated" / amber "Warming up" badge | By design (iter 95, Q13) — Overheat Index = volume spike (today > 2x rolling 7d) AND price drop (< -5%) | `backend/economy/content_pulse.py:_overheat_signal` |
| Intraday/Weekly heatmap shows "No data" cells | By design (iter 98/99) — hours/days with no `price_logs` show as muted cells | `backend/economy/{intraday,weekly}_patterns.py` |
| `/api/poe2/uniques` or `/api/poe2/currencies` returns 200 with empty `items: []` | KI-11 (closed iter 102) — Next.js catches upstream 4xx. Verify `config.yaml:league.league_name` is a valid current POE2Scout league slug (ShortName, e.g. `runes`) | `src/lib/poe2api.ts:getUniquesByCategory / getCurrenciesByCategory` |
| `GET /api/v1/prices/stream?threshold_pct=1` returns 400 | **KI-13** (open) — cause uncertain. Low severity — dashboard falls back to polling | `backend/api/routes_sse.py`, `backend/api/middleware_compression.py` |
| Leveling Uniques widget shows "Day 0" or wrong phase | Check `config.yaml` → `league.league_start_date`. If unset/zero, widget shows Day 0 | `backend/economy/lifecycle.py:PhaseDetector.__init__`, `config.yaml` |
