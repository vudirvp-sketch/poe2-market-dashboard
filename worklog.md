# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤5 latest entries.

---

## Task 58 — P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6 closed by WS removal
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per iter 57 stopping point: choose between (a) applying ProcessPoolExecutor fix to `_compute_anomalies` / `_compute_flips` in `routes_ws.py`, OR (b) completely removing WS endpoints. The note explicitly said option (b) would close P0-2 + P1-1 + P1-2 in one commit. After code review, chose **option (b)** because WS is already disabled by default in production (`NEXT_PUBLIC_FLIPPER_WS_ENABLED=false`), SSE (P0-1, iter 55) already provides push-based price invalidation, REST + polling covers all other needs, and the WS code was duplicating REST logic with reduced fields (P1-1) — a maintenance burden with no upside.

**Work Log:**
- Re-read STATUS.md, REFACTOR_PLAN.md v22, AGENT_NAVIGATION.md, worklog.md (iter 57 entry).
- Verified P0-2 source: `backend/api/routes_ws.py:_push_loop` (line 364) calls `await compute_fn()` every 30s where `compute_fn` is `_compute_anomalies` (600+ currencies × STL+MACD+RSI) or `_compute_flips` — both run **synchronously in the event loop** without ProcessPoolExecutor. One WS client = 30s event loop block. Cascade with multiple clients.
- Verified P1-1 source: `_compute_storage_value`, `_compute_forecast`, `_compute_anomalies`, `_compute_flips` in `routes_ws.py` all duplicate REST logic with reduced fields (e.g. WS `/flips` doesn't include `profit_per_unit_base`).
- Verified P1-2 source: `useFlipperWebSocket` in `src/hooks/use-websocket.ts:507-518` opens **2 parallel WS connections** (`/ws/flips` + `/ws/anomalies`) per component instance. Used by both `dashboard-page.tsx` and `flips-tab.tsx` simultaneously.
- Verified WS already opt-in: `resolveWsBaseUrl()` in `use-websocket.ts:119-122` returns `''` (disabled) unless `NEXT_PUBLIC_FLIPPER_WS_ENABLED === 'true'`. Production default is `false`.
- Verified SSE provides push-based invalidation: `routes_sse.py` (P0-1, iter 55) emits per-currency `{pair, change_pct, new_price, old_price, timestamp}` events that drive `usePriceStream` invalidation in `dashboard-page.tsx`.
- Verified no tests reference WS: `grep -r "routes_ws\|useWebSocket\|useFlipperWebSocket\|/v1/ws" tests/ e2e/` → no matches.
- Established baseline: backend 375 pass / 4 skip, e2e 30 pass / 4 skip, Jest 291 pass, tsc clean.
- **Backend cleanup:**
  - `git rm backend/api/routes_ws.py` (722 lines deleted — 5 WS endpoints + 4 compute helpers + 2 shared loops).
  - `backend/main.py:478-483`: removed WS router registration; replaced with 3-line comment explaining the removal.
  - Sanity check: `python -c "from backend.main import app"` → OK (no broken imports).
- **Frontend cleanup — deleted files:**
  - `git rm src/hooks/use-websocket.ts` (548 lines deleted — `useWebSocket`, `useFlipperWebSocket`, types).
  - `git rm -r src/app/api/flipper/ws` (1 file: `info/route.ts`).
- **Frontend cleanup — edited components (5 files):**
  - `src/components/dashboard/dashboard-page.tsx`: removed `useFlipperWebSocket` + `WebSocketStatus` imports (lines 157-158), removed `useFlipperWebSocket({ ... })` call (lines 319-335), removed `wsStatus={wsStatus}` prop on `<FlipperStickyBar>` (line 1040).
  - `src/components/dashboard/flips-tab.tsx`: removed `useFlipperWebSocket` import (line 57), removed `useFlipperWebSocket({ ... })` call (lines 99-114), removed now-unused `useQueryClient` import + `queryClient` declaration. `invalidateFlips` still used by `autoRefresh` polling effect (lines 284, 287).
  - `src/components/dashboard/header.tsx`: removed `WebSocketStatus` import, removed `wsStatus?: WebSocketStatus` prop, removed `wsStatus` from destructured props, removed 30-line WS badge rendering block (lines 381-411).
  - `src/components/dashboard/flipper-sticky-bar.tsx`: removed `WebSocketStatus` import, removed `wsStatus?` prop, removed `wsStatus` from destructured props, removed 35-line WS Status Badge block. Removed unused `WifiHigh, Wifi, Loader2` imports from `lucide-react`.
  - `src/components/dashboard/flipper-backend-status-card.tsx`: removed `WebSocketStatus` import, removed `wsStatus?` prop, removed `wsStatus` from destructured props, removed `wsBadgeConfig` IIFE (27 lines), removed WS badge rendering block. Removed unused `AlertTriangle, Wifi, WifiHigh, Loader2, Badge` imports.
- **Config / build cleanup:**
  - `.env.example`: removed `NEXT_PUBLIC_FLIPPER_WS_URL` + `NEXT_PUBLIC_FLIPPER_WS_ENABLED` + their comments (12 lines).
  - `start.sh`: removed WS env var creation in `.env.local` setup section (replaced 50-line WS-aware block with 17-line minimal version that only sets `POE2_API_BASE_URL` + `FLIPPER_API_URL`).
  - `start.bat`: same as `start.sh` (CRLF line endings handled via Python script — direct Edit tool failed due to CRLF mismatch). `UVICORN_AVAILABLE` detection preserved (still used for backend startup).
- **i18n strings NOT touched:** `wsStatusConnected/Connecting/Disconnected`, `stickyBarWsConnected/Connecting/Disconnected`, `forecastLiveModeTooltip` remain orphaned in 4 locale files (`en`, `ru`, `ko`, `zh`). They are harmless — `Record<TranslationKeys, string>` still type-checks. Deferred to a future P3 i18n cleanup pass to avoid risk of breaking the 4-file key parity constraint.
- **Test runs:**
  - `pytest tests/ -q --ignore=tests/e2e` → 375 pass / 4 skip / 0 fail.
  - `pytest tests/e2e/ -q` → 30 pass / 4 skip / 0 fail.
  - `./node_modules/.bin/tsc --noEmit` → exit 0 (clean).
  - `./node_modules/.bin/jest --silent` → 291 pass / 0 fail.
- No new tests added — WS endpoints had zero test coverage to begin with (P2-11 was open). Nothing to delete, nothing to add.

**Stage Summary:**
- 6 issues closed in one commit: P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6.
- ~1270 lines of code deleted (722 backend + 548 frontend), ~50 lines of config/scripts simplified.
- `STATUS.md`: rewritten cleanly. P0 bucket 1 → 0. P1 bucket 10 → 8 (P1-1, P1-2 removed). P2 bucket 11 → 9 (P2-10 removed). P3 bucket 8 → 6 (P3-1, P3-6 removed). Quick Reference table trimmed (only 4 symptoms remain — WS-related rows removed). Fixed section: new iter 58 entry; older entries kept brief.
- `REFACTOR_PLAN.md`: v22 → v23. Iter 58 marked DONE. P0 bucket 1 → 0. Estimation: 20 → 15 iterations remaining.
- `AGENT_NAVIGATION.md`: removed `routes_ws.py` row from §1, removed `use-websocket.ts` row from §1 (replaced with note "14 hooks — `use-websocket.ts` removed iter 58"), updated §3 rules #2 + #6 (WS no longer mentioned as violation), §4 Quick Reference table trimmed (only 4 symptoms remain — WS rows removed), §5 API endpoints (WS endpoints section removed). Added new rule #18: "Real-time updates = SSE + REST polling only — do NOT re-introduce WS."
- `docs/DATA_FLOW.md`: removed WS channels table (replaced with SSE-only table), removed `ws/info/route.ts` from API route list, removed `routes_ws.py` from backend routes list (added to "deleted" note alongside `routes_auth.py`), updated `FlipperBackendStatusCard` row.
- `worklog.md`: this entry replaces iter 55 entry (≤5 rule). Iter 55-57 entries retained.

**Stopping point:**
- Iter 58 done. **No P0 issues remain** (P0-1 through P0-6 all fixed across iter 54-58).
- Ready for iter 59 = P1-11 (daily_stats invalidation — 2-line fix, can be batched with P1-7) OR P2-7 (targeted invalidation — now unblocked by P0-1 SSE `pair` field) per REFACTOR_PLAN.md §"Recommended Fix Order".
- Suggested commit message: `refactor(P0-2): remove WS endpoints — close P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6`
- Changed files for archive: `backend/api/routes_ws.py` (DELETED), `backend/main.py`, `src/hooks/use-websocket.ts` (DELETED), `src/app/api/flipper/ws/info/route.ts` (DELETED), `src/components/dashboard/dashboard-page.tsx`, `src/components/dashboard/flips-tab.tsx`, `src/components/dashboard/header.tsx`, `src/components/dashboard/flipper-sticky-bar.tsx`, `src/components/dashboard/flipper-backend-status-card.tsx`, `.env.example`, `start.sh`, `start.bat`, `STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `docs/DATA_FLOW.md`, `worklog.md`.

---

## Task 57 — P0-5 transitive prices helper + dead `prices` param cleanup
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md iter 57: extract `compute_transitive_prices` (BFS) to `backend/economy/pricing.py`, swap 2 remaining call sites (`data_snapshot.py`, `scheduler.py`), extract `_find_price_24h_ago` to the same helper, remove dead `prices` param from `find_triangular_arbitrage`.

**Work Log:**
- Verified P0-5 source: 3 different transitive-price implementations. The `scheduler.py` 5-iter relaxation was **buggy** (silently misses >5-hop chains).
- Created `backend/economy/pricing.py` with `compute_transitive_prices(prices_in_base, rates, base)` (BFS) + `find_price_24h_ago(history, max_drift_hours)`.
- Swapped call sites in `data_snapshot.py`, `scheduler.py`, `routes_arbitrage.py`, `routes_analyst.py`.
- Removed dead `prices` param from `find_triangular_arbitrage` + `_find_triangular_arbitrage_sync` + 7 test calls in `tests/test_triangular.py`.
- **Tests added — `tests/test_pricing.py` (15 tests):** 7 for `compute_transitive_prices` (incl. **7-hop chain regression** that the old 5-iter relaxation would have missed), 8 for `find_price_24h_ago`.
- Test runs: backend 375 pass / 4 skip; e2e 30 pass / 4 skip.

**Stage Summary:**
- P0-5 fixed: `refactor(P0-5): unified pricing helper + remove dead prices param`.
- P1-3 also closed as a side effect (BFS in `compute_transitive_prices` is already O(V+E)).
- New module `backend/economy/pricing.py` is the single source of truth for transitive pricing + 24h-ago lookup.

**Stopping point:**
- Iter 57 done. Ready for iter 58 = P0-2 (WS removal).

---

## Task 56 — P0-6 triangular hardcode fix
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md iter 56: remove `prices["chaos"] = 1.0; prices["Chaos Orb"] = 1.0` hardcode + redundant chaos-normalization block in `routes_arbitrage.py:753-770`. Use single numeraire = `config.league.base_currency`.

**Work Log:**
- Verified P0-6 source: `backend/api/routes_arbitrage.py:753-770` confirmed two redundant blocks: chaos-normalization conditional conversion + unconditional hardcode `prices["chaos"] = 1.0`.
- Replaced 16 lines with: `prices = dict(snapshot.prices_in_base)` + 9-line comment. Single numeraire = base_currency.
- Tests: `pytest tests/test_triangular.py -x` → 7/7 pass. `pytest tests/e2e/test_api_e2e.py::test_arbitrage_triangular` → 1/1 pass. No regressions.
- No new tests: deleted code was dead (no observable behavior to assert).

**Stage Summary:**
- P0-6 fixed: `fix(P0-6): remove chaos hardcode in triangular arbitrage`.
- Dead `prices` param cleanup deferred to P0-5 (iter 57).

**Stopping point:**
- Iter 56 done. Ready for iter 57 = P0-5 (transitive prices helper).

---

## Task 55 — P0-1 SSE fix (remove dead monitor, add change_pct, align contract)
**Agent:** Main Agent
**Date:** 2026-06-20

**Task:** Per REFACTOR_PLAN.md recommended fix order iter 55: fix P0-1 (SSE — dead monitor, no threshold filtering, contract mismatch), add regression tests, run full test suite, update docs.

**Work Log:**
- Verified P0-1 source: `routes_sse.py` confirmed 3 bugs: (1) `_sse_monitor_loop` = empty `asyncio.sleep(60)`, (2) `threshold_pct` passed but not used, (3) backend sent `{type, changes_count, changes: [{api_id, price}], timestamp}` but frontend expected `{pair, change_pct, new_price, old_price, timestamp}`.
- Full rewrite of `routes_sse.py`: removed dead monitor + module-level state, rewrote `_sse_event_generator` to store `previous_prices`, compute `change_pct`, filter by `threshold_pct`, emit one SSE message per qualifying currency.
- Updated `main.py` (removed start/stop calls) + `src/hooks/use-price-stream.ts` (interface fields made required).
- **Tests added:** `tests/e2e/test_sse.py` (4 tests): event format, threshold filter, no-event on first snapshot, multiple currencies.
- All tests pass: backend 377 / e2e 30 / Jest 291 / tsc clean.

**Stage Summary:**
- P0-1 fixed: `fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`.
- P2-7 (targeted invalidation) unblocked — backend now sends `pair` field.

**Stopping point:**
- Iter 55 done. Ready for iter 56 = P0-6 (triangular hardcode).
