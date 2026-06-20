# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-20 (iter 62 — P2-12 closed: 16 orphan files actually removed from repo)
> Single source of truth for known bugs and refactoring priorities.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Critical (correctness, stability) — 0 active

All P0 issues resolved in iter 54-58.

---

## P1 — Serious (performance, maintainability) — 6 items

### P1-4. Clustering duplicated between routes_prices and routes_arbitrage
- **Solution:** Single cache key `cluster_labels`, shared helper function.

### P1-5. `compute_quantized_analysis` — O(lot_sizes × max_lot_search) per pair
- **Solution:** Binary search instead of linear scan.

### P1-6. `HistoricalStore._prune_old_league_data` — DELETE without limits
- **Solution:** Chunked delete with `await db.commit()` between iterations.

### P1-8. `routes_optimizer._bellman_ford` — loses profitable arbitrage
- **Solution:** After max_hops relaxations — check for negative cycle.

### P1-9. Spread model — magic numbers without theoretical basis
- **Solution:** Move to `config.yaml:scoring.spread_model.*`.

### P1-10. `flipper-proxy.ts` circuit breaker — global, not per-endpoint
- **Solution:** Per-endpoint CB (`Map<path, CircuitBreaker>`).

---

## P2 — Medium (clean code, dev experience) — 8 items

- **P2-1.** `dashboard-page.tsx` — 1705 lines, god-component. Split into tab-specific subcomponents.
- **P2-2.** `pipeline_cache.py` / `daily_stats_cache.py` — shim modules (23 lines each). Delete, update imports.
- **P2-3.** `currency_names_ru.py` — 966-line hardcoded dict. Move to JSON.
- **P2-4.** `routes_scanner.py` — duplicates `/flips`. Extend `/flips` query params or delete.
- **P2-5.** `routes_auth.py` comment in `main.py:516-519`. Delete.
- **P2-6.** Double circuit breaker not synchronized. Expose CB status in `/health`.
- **P2-8.** `proxyWithFallback` swallows ALL 5xx → 200. Pass-through in dev, mark fallback in prod.
- **P2-9.** `lightgbm_min_data_points: 15` — adaptive fallback instead of hardcode.

---

## P3 — Low priority (nice-to-have) — 5 items

- **P3-2.** `_prune_old_records` — also chunked delete.
- **P3-3.** `EventManager` not thread-safe for multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap non-atomic for iterators.
- **P3-5.** No integration test for full `/flips` flow.
- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all issues.

---

## Fixed (recent — older history in git log)

### P2-12 (fixed in iter 62) — Orphan files actual cleanup
- **Was:** iter 60 commit `9ee73ae` updated docs claiming 10 orphan root files were `git rm`'d, but the script was never executed — files remained in repo. Additionally, 3 WebSocket file remnants from iter 58 (`backend/api/routes_ws.py` 721 lines, `src/hooks/use-websocket.ts` 547 lines, `src/app/api/flipper/ws/info/route.ts` 31 lines) plus their 3 `.DELETED.txt` markers were never actually deleted either.
- **Now:** All 16 files removed via `git rm` in a single commit. Zero code changes — only deletions. Verified safe: no source code imports any of the removed files (canonical copies under `src/`, `backend/`, `tests/`, `e2e/` are unchanged).
- **Tests after fix:** `tsc --noEmit` → **0 errors** (was 2 — false baseline in iter 60). `jest` → **291 pass / 14 suites, 0 failures** (was 13 + 1 failing — false baseline in iter 60). `pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_lifecycle.py` → 56 pass / 0 fail.

### P1-7 + P3-8 (fixed in iter 61) — EventManager async refactor
- 4 sync methods (`create_event`, `delete_event`, `deactivate_event`, `clear_all`) in `backend/economy/events.py` converted to `async def`. Fire-and-forget `asyncio.ensure_future(...)` replaced with `await self._store.<op>(...)`. 3 endpoints in `routes_events.py` updated. 25 tests in `test_events.py` + 3 stub methods in `test_routes_events_invalidation.py` + 1 test in `test_scheduler.py` converted to async (pytest-asyncio auto mode).
- **Design decision:** `_prune_expired` left sync intentionally — called from 8 sync read-only methods. SQLite prune already done by scheduler (`backend/scheduler.py:145`) + on startup (`backend/main.py:174`).
- **Side effect:** all 4 `asyncio.get_event_loop()` calls in `events.py` were part of the fire-and-forget pattern that P1-7 deleted → P3-8 auto-closed.

### P1-11 + P2-7 (fixed in iter 59) — Cache invalidation cleanup
- P1-11: `daily_stats_cache.invalidate()` after `pipeline_cache.invalidate()` in 3 event endpoints. 4 regression tests.
- P2-7: `usePriceStream.invalidateCaches(pair)` drops over-eager `crossRates` invalidation, adds per-pair `benchmark` invalidation.

### P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 (fixed in iter 58) — WebSocket removal
- Removed `backend/api/routes_ws.py` (722 lines, 5 WS endpoints), `src/hooks/use-websocket.ts` (548 lines), `src/app/api/flipper/ws/info/route.ts`. Real-time updates handled exclusively by SSE (P0-1) + REST polling. (Orphan file remnants cleaned in iter 62 — see above.)

### Earlier P0 fixes (iter 54-57)
- **P0-1** (iter 55): SSE price stream contract — per-currency `{pair, change_pct, new_price, old_price, timestamp}`.
- **P0-3 + P0-4** (iter 54): analyst 24h change uses `find_price_24h_ago`; PhaseDetector `_reference_date` returns `patch_reset_date` unconditionally.
- **P0-5** (iter 57): unified `compute_transitive_prices` + `find_price_24h_ago` in `backend/economy/pricing.py`. P1-3 closed as side effect.
- **P0-6** (iter 56): removed `prices["chaos"] = 1.0` hardcode + redundant chaos-normalization in triangular arbitrage. Single numeraire = `config.league.base_currency`.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| Backend "alive" but `/flips` hangs 5-15s | Clustering cold-start (P1-4) | `routes_prices.py:259-274` |
| 500 from backend becomes "no data" | `proxyWithFallback` swallows 5xx (P2-8) | `flipper-proxy.ts:480-485` |
| `test_triangular.py` fails in full-suite mode but passes alone | Pre-existing test pollution (NOT a tracked issue — discovered iter 60). Investigate during P1-4 or P1-8 pass. | `tests/test_triangular.py` |
| `test_compression.py` fails | Pre-existing — `brotli` not installed in env | `pip install brotli` or skip |
