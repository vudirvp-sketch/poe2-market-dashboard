# STATUS.md — Known Issues & Product Features Backlog

> **Last updated:** 2026-07-10 (iter 101 — fixed 2 jest test bugs in leveling-uniques-widget.test.tsx; KI-14 closed in same iter)
> Single source of truth for known bugs, refactoring priorities, and product-feature progress.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## Known Issues — open

### KI-11 — Upstream POE2Scout API returns 404 for league "runes" (all endpoints)

**Symptom.** Backend logs show ~20 sequential 404 errors from `https://api.poe2scout.com/api/poe2/Leagues/runes/...` for every endpoint:
- `SnapshotPairs`, `Items`, `Items/Categories`
- `Currencies/ByCategory?Category=<X>` for all 16 categories (currency, fragments, runes, essences, ultimatum, expedition, ritual, vaultkeys, breach, abyss, uncutgems, lineagesupportgems, delirium, incursion, idol, verisium, vaal)
- `SnapshotHistory?Limit=168`, `ReferenceCurrencies`

Result: `DataSnapshot refreshed: 0 exchange rates, 0 currencies`. Frontend `/api/poe2/currencies` and `/api/poe2/uniques` return **502 Bad Gateway** to the browser. The FastAPI backend itself responds 200 OK on `/api/v1/*` routes (it falls back to empty data).

**Likely cause.** League slug `"runes"` is not a valid league in the upstream POE2Scout API (probably the user's local `.env.local` has `POE2_DEFAULT_LEAGUE=runes`, but upstream uses a different slug for the current Temporium League season). The fallback path in `poe2scout.py` correctly logs "upstream unreachable, returning empty/fallback" — but the Next.js `/api/poe2/currencies` route surfaces this as 502 instead of an empty 200.

**Where to fix (next iter).**
1. **User-side workaround:** edit `.env.local` → set `POE2_DEFAULT_LEAGUE` to a valid current league slug (check `https://api.poe2scout.com/api/poe2/Leagues` for the canonical list).
2. **Code-side fix (next iter):** `backend/data/providers/poe2scout.py:_fetch_json` should return an empty list (not raise) on 404 for the league-scope endpoints, so the proxy at `src/app/api/poe2/currencies/route.ts` returns 200 with empty data instead of 502. Today the proxy transforms a backend "empty" response into 502 because the snapshot manager logs `WARNING: refresh returned invalid snapshot, keeping previous` (previous = also empty), and the route handler treats this as degraded.

**Not blocking iter 100.** P3 widget only depends on PhaseDetector (which uses `league_start_datetime` from `config.yaml`, not the upstream API). The widget renders correctly even when the snapshot is empty.

---

### KI-12 — Turbopack NFT list warning (instrumentation → flipper-backend-bridge → next.config)

**Symptom.** During `next build`, Turbopack emits a warning:
```
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
Import trace:
  Instrumentation:
    ./next.config.ts
    ./scripts/flipper-backend-bridge.ts
    ./instrumentation.ts
```

**Cause.** `next.config.ts` imports `scripts/flipper-backend-bridge.ts` (used by the startup bridge), and `instrumentation.ts` imports next.config — so Turbopack traces the whole project as a runtime dependency of the NFT (Node File Trace) for serverless bundling. The suggested fix in the warning message is `path.join(/*turbopackIgnore: true*/ process.cwd(), bar)` or moving the bridge to a dev-only path.

**Severity.** Cosmetic only — build still succeeds (`✓ Compiled successfully in 3.0s`), `next start` works fine. Doesn't affect runtime.

**Where to fix (next iter).** Either:
1. Inline the `turbopackIgnore: true` comment around the bridge import in `next.config.ts`, OR
2. Move `flipper-backend-bridge.ts` to `scripts/dev/` and gate the import behind `process.env.NODE_ENV === 'development'`.

---

### KI-13 — `/api/v1/prices/stream?threshold_pct=1` returns 400 Bad Request

**Symptom.** Backend log shows `GET /api/v1/prices/stream?threshold_pct=1 HTTP/1.1` → `400 Bad Request`. The SSE endpoint is invoked once on dashboard load (presumably by an EventSource in the frontend).

**Cause (uncertain — needs investigation).** Route handler `backend/api/routes_sse.py:sse_price_stream` defines `threshold_pct: float = Query(0.5, ge=0.0, le=50.0, ...)` — so `threshold_pct=1` SHOULD pass validation (1.0 ≤ 50.0). The 400 must be coming from somewhere else. Likely candidates:
1. **Middleware rejecting SSE** — the `middleware_compression.py` or CORS middleware may not handle `text/event-stream` correctly and returns 400 before the route handler runs.
2. **Missing `Accept: text/event-stream` header** — FastAPI may reject the connection if the client doesn't send the right Accept header.
3. **Exception in `_sse_event_generator`** — the generator polls the DataSnapshot, and when the snapshot is empty (see KI-11), it may throw an exception that FastAPI converts to a 400.

**Severity.** Low — SSE is a "nice to have" price-change stream; the dashboard falls back to polling. But the 400 clutters the log on every page load.

**Where to fix (next iter).**
1. Add explicit logging at the top of `_sse_event_generator` to capture the actual exception message (currently it's swallowed by FastAPI's 400 response).
2. Check `middleware_compression.py` — it may need to skip `text/event-stream` responses.
3. Verify the frontend EventSource is correctly configured (`new EventSource('/api/flipper/prices/stream?threshold_pct=1')` — note the proxy path, not the direct backend path).

---

## Known Issues — closed

All previously open KIs (KI-1 through KI-10) closed in iter 88-95. See git log for details.

- **KI-14** (closed iter 101): `leveling-uniques-widget.test.tsx` had 2 failing jest tests after iter 100. (a) `renders item count with uniques.length` used exact-match `getByText("3 items")` but the JSX renders `"· 3 items"` inside one span (separator + count) — fixed by switching to regex `/3 items/`. (b) `calls fetchApi again when refresh button clicked after error` expected 2 calls but got 3 — root cause: widget has per-query `retry: 1` (overrides test client's `retry: false`) AND `I18nProvider` hydrates from localStorage after mount (DEFAULT_LOCALE `"ru"` → stored `"en"`), changing the queryKey `["levelingUniques","ru"]` → `["levelingUniques","en"]` and triggering an extra fetch. Fixed by snapshotting `mockFetchApi.mock.calls.length` after error UI appears (≥2 expected), then asserting `toHaveBeenCalledTimes(callsBeforeRefresh + 1)` after refresh click + verifying error UI is gone. **Verified:** `npx tsc --noEmit` clean, `npx jest` 24 suites / 532 tests green, `pytest tests/test_leveling_uniques.py` 86 tests green. See `MERGE_INSTRUCTIONS_iter101.md`.

---

## Technical-debt backlog — open

| ID | Priority | Notes |
|----|----------|-------|
| **TD-3** | P3 | Triangular arbitrage no persistence. Cannot backtest executable_estimate. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. |
| **TD-6** | P3 | `highest_stock` + `current_quantity` not used for Wall detection. |
| **TD-7** | P3 | `PriceMomentumTracker` momentum + volatility computed but not shown. |
| **TD-8** | P3 | Tier classification (T1-T5) not shown anywhere. |
| **TD-9** | P3 | FlipsTable "Trend" sparkline uses a derived `momentum × volatility` indicator. When backend adds `priceHistoryShort` to `FlipOpportunity`, switch to real data — only `flips-helpers.ts:deriveTrendSparklineData` needs replacing with a passthrough. |

TD-1 closed in iter 92. TD-2 closed in iter 95. TD-10 closed in iter 97 (Circuit Patterns fully wired up).

---

## Product Features (F1–F7) — see `PRODUCT_VISION.md`

| Feature | Status | Notes |
|---------|--------|-------|
| **F1** — Translate remaining items | ✅ Done (iter 85 + 86) | |
| **F2** — Storage Value UI tab | ✅ Done (iter 74 + 75) | |
| **F3** — `content_pulse` module | ✅ Done (iter 75) + iter 95 Overheat Index | |
| **F4** — «Что фармить сегодня» widget | ✅ Done (iter 76) | |
| **F5** — Speculation tab | ✅ Done (iter 77 + 79 + 80 + 88) | |
| **F6** — Phase-aware hints | ✅ Done (iter 78 + 87) | |
| **F7** — Market Playbook + Circuit Patterns (P8) | ✅ Done (iter 96 + 97) | Pure function + API + UI tab + i18n × 4 + tests. See `docs/MARKET_PLAYBOOK.md` §C.1 + §C.2. |
| **P4** — Time-of-Day Pattern Detector | ✅ Done (iter 98) | Pure function `compute_intraday_patterns()` + API `/api/v1/intraday-patterns` + Next.js proxy + UI heatmap tab + i18n × 4 (43 keys × 4) + 23 jest + 89 pytest. See `docs/MARKET_PLAYBOOK.md` §C.3. |
| **P5** — Weekday/Weekend Pattern Detector | ✅ Done (iter 99) | Pure function `compute_weekly_patterns()` + API `/api/v1/weekly-patterns` + Next.js proxy + UI heatmap tab (rows = currencies, cols = 7 weekdays Mon-Sun) + i18n × 4 (50 keys × 4) + 25 jest + 99 pytest. See `docs/MARKET_PLAYBOOK.md` §C.4. |
| **P3** — Leveling Uniques Lifecycle | ✅ Done (iter 100) | Pure function `compute_leveling_uniques_lifecycle()` + API `/api/v1/leveling-uniques` + Next.js proxy + UI widget on Overview (between PhaseHints and MarketOverview) + i18n × 4 (24 keys × 4) + 14 jest + 50 pytest. Static table of well-known leveling uniques (10 items) with `peak_day` / `peak_price_exalted` / `decay_pct` / lifecycle stage (PRE_PEAK / AT_PEAK / POST_PEAK) + recommendation (BUY/HOLD / SELL NOW / AVOID BUYING). Depends on PhaseDetector only — no upstream API calls (immune to KI-11). See `docs/MARKET_PLAYBOOK.md` §C.5. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) | `backend/predictors/time_series.py:train` |
| Keyboard shortcut "5" goes to Flips, not Arbitrage | By design (iter 92 KI-7) — dead "arbitrage" tab removed from TAB_MAP. | `dashboard-page.tsx:TAB_MAP`, `shortcuts-dialog.tsx` |
| Keyboard shortcut "0" goes to Circuits, not Liquid Chain | By design (iter 97 F7) — circuit-patterns inserted at idx 9 (shortcut 0). Intraday Patterns (idx 10) + Liquid Chain (idx 11) + Watchlist (idx 12) are click-only. | `dashboard-page.tsx:TAB_MAP`, `shortcuts-dialog.tsx` |
| Watchlist P&L shows same value as Change | Pre-iter 92 behavior. After iter 92, new entries track entry price. Old entries still show changePercent as fallback. | `watchlist-tab.tsx`, `store.ts:WatchlistEntry.entryPrice` |
| Exchange tab shows "Best Payment" strip at the top | By design (iter 93) — top-10 cards strip with savings ≥1%. Hidden when no opportunities exist. | `exchange-tab-content.tsx`, `best-payment-top-list.tsx` |
| Best Payment badge doesn't appear on a pair | By design (iter 93, Q3) — pairs with `savingsPct < 1` are hidden in both `BestPaymentBadge` and the top-list. | `best-payment-badge.tsx:40`, `use-optimal-payment.ts:BEST_PAYMENT_MIN_SAVINGS_PCT` |
| Craft items (Ritual Omens, Soul Cores) appear in Best Payment | By design (iter 93, Q2) — the hook groups by `currency1Id`, which covers all priced items including `ritual` / `ultimatum` / `idol` / `vaultkeys` / `delirium` categories. | `use-optimal-payment.ts:bestPaymentTopList`, `currency-optimal.ts:ITEM_CATEGORIES` |
| FlipsTable "Trend" sparkline looks synthetic | By design (iter 94, Q5) — derived from `momentum × volatility` (NOT historical price data). Tooltip explicitly states this. Switches to real data when backend adds `priceHistoryShort` (TD-9). | `flips-helpers.ts:deriveTrendSparklineData`, `flips-table.tsx:Trend column` |
| FlipsTable Spread cell color changes | By design (iter 94, Q4) — emerald ≥5% (wide), amber 2-5% (medium), muted <2% (tight). Same thresholds power the "Spread tier" filter dropdown. | `flips-helpers.ts:classifySpreadTier`, `flips-tab.tsx:spreadTierFilter` |
| Content Pulse shows orange "Overheated" / amber "Warming up" badge | By design (iter 95, Q13) — Overheat Index = volume spike (today > 2x rolling 7d) AND price drop (< -5%) → "hot"; only one condition → "warm"; neither → "cool" (no badge). Tooltip shows the breakdown. | `backend/economy/content_pulse.py:_overheat_signal`, `content-pulse-widget.tsx:Overheat badge` |
| Content Pulse `today_volume` differs from before iter 95 | By design (iter 95, TD-2 fix) — was `current_quantity` (supply metric), now `volume_traded` (activity metric, summed across all `snapshot.exchange_rates` pairs containing the currency). Semantically consistent with `rolling_7d`/`rolling_30d` (also activity metrics). | `backend/economy/content_pulse.py:_category_today_volume` |
| Circuit Patterns sparkline empty for some currencies | By design (iter 97) — sparkline needs ≥2 price points in the lookback window. Backend filters currencies with < `MIN_SAMPLE_SIZE` (4) points before classification, but the sparkline slice is the last 14 — so even classified currencies can show fewer points if the window is short. When the slice has < 2 points, the empty-sparkline fallback renders. | `backend/economy/circuit_patterns.py:recent_points`, `circuit-patterns-tab.tsx:Sparkline` |
| Intraday heatmap shows "No data" cells | By design (iter 98) — the heatmap renders all 24 UTC hours per currency. Hours with no price_logs in the lookback window show as muted "No data" cells (count=0, mean=null). This is expected when the snapshot scheduler hasn't collected data at that hour yet. | `backend/economy/intraday_patterns.py:_hourly_stats`, `intraday-patterns-tab.tsx:cellColor` |
| Intraday tab not reachable via keyboard shortcut | By design (iter 98) — only 10 shortcut slots (1-9 + 0). Intraday Patterns is at TAB_MAP idx 10, so it's click-only. Liquid Chain (idx 11) + Watchlist (idx 12) are also click-only. | `dashboard-page.tsx:TAB_MAP`, `shortcuts-dialog.tsx` |
| Weekly heatmap shows "No data" cells | By design (iter 99) — the heatmap renders all 7 weekdays (Mon-Sun) per currency. Days with no price_logs in the lookback window show as muted "No data" cells (count=0, mean=null). Expected for fresh leagues or weekdays with no snapshot collection. | `backend/economy/weekly_patterns.py:_daily_stats`, `weekly-patterns-tab.tsx:cellColor` |
| Weekly tab not reachable via keyboard shortcut | By design (iter 99) — only 10 shortcut slots (1-9 + 0). Weekly Patterns is at TAB_MAP idx 11, so it's click-only. Intraday (idx 10) + Liquid Chain (idx 12) + Watchlist (idx 13) are also click-only. | `dashboard-page.tsx:TAB_MAP`, `shortcuts-dialog.tsx` |
| Weekly tab `weekday_delta_pct` shows 0% even when weekends look different | By design (iter 99) — delta is computed as `(weekend_mean - weekday_mean) / overall_mean × 100`. Returns 0 when either group (Mon-Fri or Sat-Sun) has no data points. The badge is shown only for context — the buy/sell day badges and range_pct are the actionable signals. | `backend/economy/weekly_patterns.py:_weekday_delta_pct` |
| Browser shows 502 Bad Gateway on `/api/poe2/currencies` and `/api/poe2/uniques` | KI-11 — upstream POE2Scout API returns 404 for the configured league slug (likely "runes" in `.env.local`). Workaround: edit `.env.local` → set `POE2_DEFAULT_LEAGUE` to a valid current league slug. | `backend/data/providers/poe2scout.py:_fetch_json`, `src/app/api/poe2/currencies/route.ts` |
| Backend log full of `HTTP error 404 on poe2/Leagues/<X>/...` lines | KI-11 — same root cause as the 502 above. The fallback path correctly returns empty data, but the snapshot refresh keeps the previous (also empty) snapshot. The dashboard's analytics endpoints (`/api/v1/*`) still respond 200 OK with empty `data_available: false` responses. | `backend/data/providers/poe2scout.py`, `backend/api/data_snapshot.py` |
| `next build` emits "Encountered unexpected file in NFT list" warning | KI-12 — cosmetic only. `instrumentation.ts` → `next.config.ts` → `scripts/flipper-backend-bridge.ts` import chain causes Turbopack to trace the whole project. Build still succeeds. Fix: add `/*turbopackIgnore: true*/` to the bridge import. | `next.config.ts`, `scripts/flipper-backend-bridge.ts` |
| `GET /api/v1/prices/stream?threshold_pct=1` returns 400 | KI-13 — cause uncertain (validation `ge=0.0, le=50.0` should accept `1`). Likely middleware rejecting SSE or exception in `_sse_event_generator` when snapshot is empty (cascades from KI-11). Low severity — dashboard falls back to polling. | `backend/api/routes_sse.py`, `backend/api/middleware_compression.py` |
| Leveling Uniques widget shows "Day 0" or wrong phase | Check `config.yaml` → `league.league_start_datetime`. The widget depends on PhaseDetector, which uses this timestamp to compute `days_since_reference`. If unset/zero, the widget shows Day 0 with all uniques in PRE_PEAK stage. | `backend/economy/lifecycle.py:PhaseDetector.__init__`, `config.yaml` |
