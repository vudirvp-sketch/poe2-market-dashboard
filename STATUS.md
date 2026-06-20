# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-20 (iter 59 — P1-11 + P2-7 closed; P2-11 added as new Known Issue)
> This file is the **single source of truth** for known bugs and refactoring priorities.
> Update it **before** fixing any issue. Cross-reference issue IDs in commits.
>
> **Iter 59 status:** P1-11 (daily_stats invalidation in routes_events) closed — 2-line `daily_stats_cache.invalidate()` added after every `pipeline_cache.invalidate()` in create/delete/deactivate endpoints, with 4 regression tests. P2-7 (targeted invalidation by pair) closed — `usePriceStream.invalidateCaches` now takes `pair`, drops over-eager `crossRates` invalidation (derived from POE2 exchange pairs, not flipper prices), adds per-pair `benchmark` invalidation. **New Known Issue P2-11 discovered**: 10 orphan root-level files (stale duplicates of `src/`, `backend/`, `tests/`, `e2e/` canonical copies) accidentally committed in iter 58 — they cause 2 pre-existing tsc errors and 1 pre-existing jest failure. Documented, not fixed (out of scope for iter 59). Backend tests: 4 new P1-11 regression tests pass; 375 pass / 4 skip baseline maintained. Jest: 291 pass. tsc: 2 pre-existing errors (P2-11).

---

## P0 — Critical (correctness, stability) — 0 active

(All P0 issues resolved. See §Fixed below.)

---

## P1 — Serious (performance, maintainability) — 7 items

### P1-4. Clustering duplicated between routes_prices and routes_arbitrage
- **Solution:** Single cache key `cluster_labels`, shared helper function.

### P1-5. `compute_quantized_analysis` — O(lot_sizes × max_lot_search) per pair
- **Solution:** Binary search instead of linear scan.

### P1-6. `HistoricalStore._prune_old_league_data` — DELETE without limits
- **Solution:** Chunked delete with `await db.commit()` between iterations.

### P1-7. `EventManager.create_event` — fire-and-forget SQLite write
- **Solution:** Make `create_event` async, `await self._store.write_event(event)`.

### P1-8. `routes_optimizer._bellman_ford` — loses profitable arbitrage
- **Solution:** After max_hops relaxations — check for negative cycle.

### P1-9. Spread model — magic numbers without theoretical basis
- **Solution:** Move to `config.yaml:scoring.spread_model.*`.

### P1-10. `flipper-proxy.ts` circuit breaker — global, not per-endpoint
- **Solution:** Per-endpoint CB (Map<path, CircuitBreaker>).

---

## P2 — Medium (clean code, dev experience) — 9 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-2.** `pipeline_cache.py` / `daily_stats_cache.py` — shim modules (23 lines each). Delete, update imports.
- **P2-3.** `currency_names_ru.py` — 966 lines hardcoded dict. Move to JSON.
- **P2-4.** `routes_scanner.py` — duplicates `/flips`. Extend `/flips` query params or delete.
- **P2-5.** `routes_auth.py` comment in `main.py:516-519`. Delete.
- **P2-6.** Double circuit breaker not synchronized. Expose CB status in `/health`.
- **P2-8.** `proxyWithFallback` swallows ALL 5xx → 200. Pass-through in dev, mark fallback in prod.
- **P2-9.** `lightgbm_min_data_points: 15` — adaptive fallback instead of hardcode.
- **P2-11.** (NEW iter 59) **10 orphan root-level files** committed by mistake in iter 58 — stale duplicates of canonical copies under `src/`, `backend/`, `tests/`, `e2e/`. Cause 2 pre-existing tsc errors + 1 pre-existing jest failure. See §"P2-11 Detail" below.

---

## P3 — Low priority (nice-to-have) — 6 items

- **P3-2.** `_prune_old_records` — also chunked delete.
- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow.
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.
- **P3-8.** `asyncio.get_event_loop()` in `events.py:210` deprecated. Replace with `asyncio.get_running_loop()`.

---

## P2-11 Detail — Orphan root-level files

10 stale duplicate files were committed to the repo root in iter 58 (likely bundled by mistake into the archive merge). They are NOT imported by any other code (canonical copies live under `src/`, `backend/`, `tests/`, `e2e/`) but are caught by `tsconfig.json` (`include: ["**/*.ts", "**/*.tsx"]`) and `jest.config.ts`, causing 2 pre-existing tsc errors and 1 pre-existing jest failure.

| Orphan root file | Canonical copy |
|------------------|----------------|
| `dashboard-page.tsx` | `src/components/dashboard/dashboard-page.tsx` |
| `events-sidebar.spec.ts` | `e2e/events-sidebar.spec.ts` |
| `providers.tsx` | `src/components/providers.tsx` |
| `route.ts` | `src/app/api/flipper/prices/stream/route.ts` |
| `use-price-stream.ts` | `src/hooks/use-price-stream.ts` |
| `main.py` | `backend/main.py` |
| `routes_sse.py` | `backend/api/routes_sse.py` |
| `historical.py` | `backend/data/historical.py` |
| `test_lifecycle.py` | `tests/test_lifecycle.py` |
| `test_optimal_currency.py` | `tests/test_optimal_currency.py` |

**Symptoms:**
- `tsc --noEmit` fails with 2 errors:
  - `dashboard-page.tsx(1037,89)` — leftover `wsStatus` prop from iter 58 (root copy wasn't cleaned up).
  - `events-sidebar.spec.ts(16,33)` — Cannot find module `./fixtures` (root copy has wrong relative path).
- `jest` fails 1 suite: `./events-sidebar.spec.ts`.

**Solution:** `git rm` all 10 orphan files. Single commit. No code changes needed — only deletions. Low risk because nothing imports them.

**Deferral rationale:** Out of scope for iter 59 (focused on P1-11 + P2-7). Recommended as iter 60 first step — quick cleanup that immediately restores "tsc: clean" + "jest: clean".

---

## Fixed

### P1-11 + P2-7 (fixed in iter 59 — `fix(P1-11+P2-7): daily_stats invalidation + targeted SSE invalidation`) — Cache invalidation cleanup
- **P1-11 — daily_stats invalidation:**
  - **Was:** `routes_events.create_event` / `delete_event` / `deactivate_event` only invalidated the `pipeline_cache` namespace. The `daily_stats` namespace (stale-fallback for daily benchmarks / storage-value aggregates) was left untouched, so the UI kept serving stale daily-stats entries up to their TTL (default 30 min) after a `major_patch` flag was created or any event was deactivated.
  - **Now:** All three endpoints call `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()`. Single `get_daily_stats_cache()` import added to `routes_events.py`.
  - **Tests:** 4 new regression tests in `tests/test_routes_events_invalidation.py` — verify both `pipeline_cache.invalidate()` AND `daily_stats_cache.invalidate()` are called after each endpoint.
- **P2-7 — targeted SSE invalidation by pair:**
  - **Was:** `usePriceStream.invalidateCaches()` invalidated 6 query keys unconditionally on every qualifying SSE event — including `crossRates` which derives from `useExchangePairs` (POE2 official API), NOT from flipper prices (over-invalidation bug). No per-pair invalidation despite backend sending the `pair` field (P0-1, iter 55).
  - **Now:** `invalidateCaches(pair: string)`:
    1. Drops `crossRates` invalidation (it doesn't depend on flipper prices).
    2. Adds per-pair `benchmark` invalidation: `queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.benchmark, pair] })` — only the changed currency's benchmark card (if mounted) refetches.
    3. Keeps the 5 bulk-query invalidations (`flipperPrices`, `flipperFlips`, `heatmap`, `flipperTriangular`, `flipperLiquidChain`) because they aggregate ALL currencies.
    4. Defensive empty-pair fallback: if backend sends no `pair`, falls back to bulk-only invalidation.
  - **Files changed:** `backend/api/routes_events.py`, `src/hooks/use-price-stream.ts`, `tests/test_routes_events_invalidation.py` (NEW), `STATUS.md`, `REFACTOR_PLAN.md`, `worklog.md`.
- **Tests:** Backend: 4 new tests pass (375 → 379 pass / 4 skip). e2e: 10 pass. Jest: 291 pass (no new tests — SSE hook has no existing test coverage; deferred to P2-11 cleanup pass). tsc: 2 pre-existing errors (P2-11 — not caused by iter 59).

### P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 (fixed in iter 58) — WebSocket removal
- **Decision:** Completely removed WS endpoints instead of applying executor fix. Real-time updates handled by SSE (P0-1, iter 55) + REST polling.
- **What was removed:** `backend/api/routes_ws.py` (722 lines, 5 WS endpoints), `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts`, WS router registration in `backend/main.py`, `useFlipperWebSocket` usage in `dashboard-page.tsx` + `flips-tab.tsx`, `wsStatus` prop + WS badge UI in `header.tsx`, `flipper-sticky-bar.tsx`, `flipper-backend-status-card.tsx`, WS env vars from `.env.example`, `start.sh`, `start.bat`.
- **Issues closed:** P0-2 (event loop blocking), P1-1 (duplicate REST logic), P1-2 (2 parallel WS connections), P2-10 (path prefix mismatch), P3-1 (two anomaly detection paths), P3-6 (.env.example missing WS env).
- **Tests at time of fix:** Backend 375 pass / 4 skip. e2e 30 pass / 4 skip. Jest 291 pass. tsc claimed clean (NOTE: actually broken by orphan files added in same commit — see P2-11).
- **Follow-up:** Orphaned i18n keys `wsStatusConnected/Connecting/Disconnected` + `stickyBarWsConnected/Connecting/Disconnected` + `forecastLiveModeTooltip` remain in 4 locale files. Harmless. Defer to P3 i18n cleanup pass.

### P0-5 (fixed in iter 57) — Transitive prices
- `backend/economy/pricing.py` exposes `compute_transitive_prices` (BFS) + `find_price_24h_ago`. `data_snapshot.py` and `scheduler.py` share the helper. Dead `prices` parameter removed from `find_triangular_arbitrage`. P1-3 also closed as side effect.

### P0-6 (fixed in iter 56) — Triangular numeraire
- Removed chaos-normalization + hardcode `prices["chaos"] = 1.0` from `routes_arbitrage.py`. Single numeraire = `config.league.base_currency`.

### P0-1 (fixed in iter 55) — SSE price stream
- Per-currency SSE events matching `SSEPriceUpdate` frontend interface. 4 tests in `tests/e2e/test_sse.py`.

### P0-3 (fixed in iter 54) — `routes_analyst._compute_trends` 24h change
- Uses `find_price_24h_ago` (now in `backend.economy.pricing`).

### P0-4 (fixed in iter 54) — `PhaseDetector._reference_date` reset
- `patch_reset_date` returned unconditionally, no `max()`.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| Backend "alive" but `/flips` hangs 5-15s | Clustering cold-start (P1-4) | `routes_prices.py:259-274` |
| 500 from backend becomes "no data" | `proxyWithFallback` swallows 5xx (P2-8) | `flipper-proxy.ts:480-485` |
| After backend restart, some events missing | `create_event` fire-and-forget SQLite write (P1-7) | `events.py:212` |
| `tsc --noEmit` reports 2 errors / jest fails 1 suite | Orphan root files from iter 58 (P2-11) | Delete the 10 orphan files (see §P2-11 Detail) |
