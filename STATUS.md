# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-20 (iter 58 — P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 closed by WS removal)
> This file is the **single source of truth** for known bugs and refactoring priorities.
> Update it **before** fixing any issue. Cross-reference issue IDs in commits.
>
> **Iter 58 status:** WebSocket endpoints + frontend hook removed entirely. Real-time updates now handled exclusively by SSE (P0-1, iter 55) + REST polling. Closes 6 issues in one commit: P0-2 (event loop blocking), P1-1 (duplicate REST logic with reduced fields), P1-2 (2 parallel WS connections), P2-10 (path prefix mismatch), P3-1 (two anomaly detection paths), P3-6 (.env.example missing WS env). Backend: 375 pass / 4 skip. e2e: 30 pass / 4 skip. Jest: 291 pass. tsc: clean. **No P0 issues remain.**

---

## P0 — Critical (correctness, stability) — 0 active

(All P0 issues resolved. See §Fixed below.)

---

## P1 — Serious (performance, maintainability) — 8 items

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

### P1-11. `routes_events.create_event` doesn't invalidate `daily_stats` namespace
- **Solution:** Add `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()`.

---

## P2 — Medium (clean code, dev experience) — 9 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-2.** `pipeline_cache.py` / `daily_stats_cache.py` — shim modules (23 lines each). Delete, update imports.
- **P2-3.** `currency_names_ru.py` — 966 lines hardcoded dict. Move to JSON.
- **P2-4.** `routes_scanner.py` — duplicates `/flips`. Extend `/flips` query params or delete.
- **P2-5.** `routes_auth.py` comment in `main.py:516-519`. Delete.
- **P2-6.** Double circuit breaker not synchronized. Expose CB status in `/health`.
- **P2-7.** `usePriceStream` invalidates 6 query keys unconditionally. Backend now sends `pair` (P0-1 fixed) — targeted invalidation is possible.
- **P2-8.** `proxyWithFallback` swallows ALL 5xx → 200. Pass-through in dev, mark fallback in prod.
- **P2-9.** `lightgbm_min_data_points: 15` — adaptive fallback instead of hardcode.

---

## P3 — Low priority (nice-to-have) — 6 items

- **P3-2.** `_prune_old_records` — also chunked delete.
- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow.
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.
- **P3-8.** `asyncio.get_event_loop()` in `events.py:210` deprecated. Replace with `asyncio.get_running_loop()`.

---

## Fixed

### P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 (fixed in iter 58 — `refactor(P0-2): remove WS endpoints — close P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6`) — WebSocket removal
- **Decision:** Option (b) from iter 57 stopping point — completely remove WS endpoints instead of applying executor fix. Real-time updates are handled by SSE (`routes_sse.py`, P0-1 fixed iter 55); other channels use REST + React Query polling.
- **What was removed:**
  - `backend/api/routes_ws.py` (entire file — 722 lines, 5 WS endpoints: storage-value, forecast, anomalies, flips, events).
  - `src/hooks/use-websocket.ts` (entire file — 548 lines, `useWebSocket` + `useFlipperWebSocket`).
  - `src/app/api/flipper/ws/info/route.ts` (entire directory).
  - WS router registration in `backend/main.py` (replaced with explanatory comment).
  - `useFlipperWebSocket` usage in `dashboard-page.tsx` + `flips-tab.tsx`.
  - `wsStatus` prop + WS badge UI in `header.tsx`, `flipper-sticky-bar.tsx`, `flipper-backend-status-card.tsx`.
  - `NEXT_PUBLIC_FLIPPER_WS_ENABLED` / `NEXT_PUBLIC_FLIPPER_WS_URL` env vars from `.env.example`, `start.sh`, `start.bat`.
- **Issues closed:**
  - **P0-2** — `_push_loop` no longer blocks event loop (no WS endpoints to block).
  - **P1-1** — No more duplicate REST-with-reduced-fields code (WS code gone).
  - **P1-2** — No more 2 parallel WS connections (hook gone).
  - **P2-10** — Path prefix unification moot (only REST `/api/v1/*` remains).
  - **P3-1** — Only one anomaly detection path remains (`routes_anomalies._detect_anomalies_sync`).
  - **P3-6** — `.env.example` no longer needs WS env vars.
- **Files changed:** `backend/api/routes_ws.py` (DELETED), `backend/main.py`, `src/hooks/use-websocket.ts` (DELETED), `src/app/api/flipper/ws/info/route.ts` (DELETED), `src/components/dashboard/{dashboard-page,flips-tab,header,flipper-sticky-bar,flipper-backend-status-card}.tsx`, `.env.example`, `start.sh`, `start.bat`, `STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `docs/DATA_FLOW.md`, `worklog.md`.
- **Tests:** Backend: 375 pass / 4 skip. e2e: 30 pass / 4 skip. Jest: 291 pass. tsc: clean. No regressions. No new tests added — WS endpoints had no test coverage to begin with (P2-11 was open).
- **Follow-up:** Orphaned i18n keys `wsStatusConnected/Connecting/Disconnected` + `stickyBarWsConnected/Connecting/Disconnected` + `forecastLiveModeTooltip` remain in 4 locale files. Harmless (Record<TranslationKeys, string> still type-checks) — defer to a P3 i18n cleanup pass.

### P0-5 (fixed in iter 57 — `refactor(P0-5): unified pricing helper + remove dead prices param`) — Transitive prices
- **Was (3 parts):**
  1. **Maintainability:** Three different algorithms for "price of every currency in the base currency" — `_compute_transitive_prices` in `data_snapshot.py` (BFS, correct), `collect_price_snapshot` in `scheduler.py` (5-iter relaxation, buggy), and the dead `prices` parameter in `find_triangular_arbitrage` (passed but never read).
  2. **Correctness bug:** The 5-iteration relaxation in `scheduler.py` silently failed for currencies whose shortest path from the base currency exceeded 5 hops. With ~600 currencies and a sparse pair graph, 5-hop chains are real. The scheduler would then fall back to using `rate.raw_rate` as the price — a wrong value with no log warning.
  3. **Dead parameter:** `find_triangular_arbitrage(rates, prices, ...)` accepted a `prices` dict but the Bellman-Ford path never read it. The hardcode `prices["chaos"] = 1.0` (removed in iter 56, P0-6) only existed to keep the misleading parameter "consistent".
- **Now:**
  - New `backend/economy/pricing.py` exposes `compute_transitive_prices(prices_in_base, rates, base)` (single BFS) and `find_price_24h_ago(history, max_drift_hours)`.
  - `data_snapshot.py` and `scheduler.py` both import `compute_transitive_prices` — the two pricing paths can no longer diverge.
  - The 5-iter relaxation block in `scheduler.py` is deleted entirely.
  - `find_triangular_arbitrage` and `_find_triangular_arbitrage_sync` no longer accept `prices`.
- **Files changed:** `backend/economy/pricing.py` (NEW), `backend/api/data_snapshot.py`, `backend/scheduler.py`, `backend/api/routes_arbitrage.py`, `backend/api/routes_analyst.py`, `backend/arbitrage/triangular.py`, `tests/test_triangular.py`, `tests/test_pricing.py` (NEW).
- **Tests:** 15 new tests in `tests/test_pricing.py`. Backend: 375 pass / 4 skip. e2e: 30 pass / 4 skip.

### P0-6 (fixed in iter 56 — `fix(P0-6): remove chaos hardcode in triangular arbitrage`) — Triangular numeraire
- **Was:** `routes_arbitrage.py:753-770` contained chaos-normalization + hardcode `prices["chaos"] = 1.0; prices["Chaos Orb"] = 1.0` that ran unconditionally.
- **Now:** Single numeraire = `config.league.base_currency`. No chaos normalization, no hardcode.

### P0-1 (fixed in iter 55 — `fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`) — SSE price stream
- **Was:** Dead `_sse_monitor_loop`, ignored `threshold_pct`, contract mismatch (backend sent bulk payload, frontend expected per-currency `{pair, change_pct, new_price, old_price, timestamp}`).
- **Now:** Per-currency SSE events matching `SSEPriceUpdate` frontend interface. 4 tests in `tests/e2e/test_sse.py`.

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
| Event created but forecast stale | `daily_stats` namespace not invalidated (P1-11) | `routes_events.py:135` |
| After backend restart, some events missing | `create_event` fire-and-forget SQLite write (P1-7) | `events.py:212` |
