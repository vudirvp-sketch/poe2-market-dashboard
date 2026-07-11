# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-11 (iter 105 — KI-16 long-term fix applied (bridge moved to `src/lib/`); KI-18 discovered and fixed (`tests/conftest.py`); cache-snapshot regenerated. Build + 569 jest + 1161 pytest + tsc all green.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### KI-13 — `/api/v1/prices/stream?threshold_pct=1` returns 400

**Symptom.** Backend log: `GET /api/v1/prices/stream?threshold_pct=1 → 400 Bad Request`. SSE endpoint invoked once on dashboard load.

**Cause (uncertain).** Route defines `threshold_pct: float = Query(0.5, ge=0.0, le=50.0)` so `1` should pass. Candidates: middleware rejecting `text/event-stream`; missing `Accept` header; exception in `_sse_event_generator` on empty snapshot.

**Severity.** Low — dashboard falls back to polling. Only clutters the log.

**Where to fix.** `backend/api/routes_sse.py:_sse_event_generator`, `backend/api/middleware_compression.py`.

---

### KI-16 — Turbopack NFT warning for `instrumentation.ts` → `flipper-backend-bridge.ts` (partially resolved)

**Symptom.** `next build` prints: `Encountered unexpected file in NFT list ... ./src/lib/flipper-backend-bridge.ts ... ./instrumentation.ts`. Build still succeeds; runtime works; warning is cosmetic.

**Root cause (confirmed iter 105).** Iter 105 moved the bridge from `scripts/` to `src/lib/` expecting Turbopack to bundle it as a regular module. The move did NOT eliminate the warning — NFT still flags the file because the bridge uses dynamic filesystem operations (`existsSync`, `path.join`, `appendFileSync`, `require("fs")` inside `logToFile`). NFT conservatively treats any file with such ops as "could trace the whole project" and emits the warning.

**What iter 105 changed.**
- Moved `scripts/flipper-backend-bridge.ts` → `src/lib/flipper-backend-bridge.ts` (cleaner organisation; bridge is app code, not a dev script).
- Updated `instrumentation.ts` import path to `./src/lib/flipper-backend-bridge`.
- Updated JSDoc in both files.

**What did NOT change.** The NFT warning still appears during `next build`. It is purely cosmetic — the bridge works correctly at runtime.

**How to fully eliminate the warning (future P3 work).** Either:
1. Refactor `getProjectRoot()` and `logToFile()` in the bridge to avoid `fs`/`path` operations that confuse NFT (e.g., resolve project root once at instrumentation.ts level and pass it in; replace `appendFileSync` with a lazy `require("fs")` guarded by `process.env.NEXT_RUNTIME`).
2. Move fs-ops into a separate module that's lazy-required inside `startBackendBridge()` rather than at module-eval time.

**Severity.** Cosmetic — no runtime impact.

---

## Known Issues — closed (recent)

- **KI-18** (closed iter 105): `pytest` hung indefinitely on `tests/test_triangular.py::TestTriangularArbitrageNoFees::test_simple_profitable_cycle_no_fees`. Root cause: `find_triangular_arbitrage` offloads CPU work to `ProcessPoolExecutor` (spawn start method); in the test environment the spawned worker was terminated abruptly (`BrokenProcessPool`), and `asyncio.wait_for(loop.run_in_executor(...))` + pytest-asyncio did not propagate the exception, so the test hung. **Fix:** added `tests/conftest.py` with an autouse fixture that patches `backend.main.get_process_pool` to return `None` for every test, forcing fallback to the default `ThreadPoolExecutor` (which is fast and spawn-free). Production code still uses `ProcessPoolExecutor`. All 1161 pytest tests now pass in ~6s.
- **KI-17** (closed iter 104): `instrumentation.ts` JSDoc comment contained the literal sequence `*/` (inside `/* turbopackIgnore: true */`), which prematurely closed the comment block. Everything after `*/` was parsed as TypeScript → build failed with `Expected ';', '}' or <eof>` at line 23. **Fix:** reworded the comment to avoid the `*/` sequence.
- **KI-15** (closed iter 103): `api.poe2scout.com` subdomain is DEAD — returns 404 for every endpoint. API moved to bare domain `poe2scout.com/api/*`. All runtime paths, configs, scripts, i18n, docs, test fixtures updated. `start.bat` / `start.sh` now WARN if `.env.local` still contains `api.` subdomain. **User action:** delete or edit `.env.local` to `POE2_API_BASE_URL=https://poe2scout.com/api`.
- **KI-11** (closed iter 102): 502 on `/api/poe2/uniques` & `/api/poe2/currencies` — route handlers now catch upstream 4xx and return empty `PaginatedResponse`.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **KI-16-deep** | P3 | Refactor `src/lib/flipper-backend-bridge.ts` to avoid fs/path operations that confuse Turbopack NFT — see KI-16 above for the two recommended approaches. Eliminates the cosmetic NFT warning permanently. |
| **TD-3** | P3 | Triangular arbitrage no persistence — cannot backtest `executable_estimate`. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. |
| **TD-9** | P3 | FlipsTable "Trend" sparkline uses derived `momentum × volatility` — switch to real `priceHistoryShort` when backend adds it. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| All API calls return 404; dashboard empty | **KI-15** — `.env.local` has dead `api.poe2scout.com`. Use `POE2_API_BASE_URL=https://poe2scout.com/api` | `.env.local`, `start.bat`, `start.sh` |
| Build fails: `Expected ';', '}' or <eof>` in instrumentation.ts | **KI-17** (fixed iter 104) — was caused by `*/` inside JSDoc comment. If it reappears, check for `*/` sequences inside comment blocks | `instrumentation.ts` |
| `next build` warns "Encountered unexpected file in NFT list ... flipper-backend-bridge.ts" | **KI-16** (open, cosmetic) — NFT flags the bridge because it uses dynamic fs operations. Build and runtime work fine. Deep fix requires refactoring bridge to avoid fs/path ops | `instrumentation.ts`, `src/lib/flipper-backend-bridge.ts` |
| `pytest` hangs on `test_triangular.py` (no output, no timeout) | **KI-18** (fixed iter 105) — `tests/conftest.py` autouse fixture patches `get_process_pool` → None. If it reappears, check that `tests/conftest.py` is present | `tests/conftest.py`, `backend/main.py:get_process_pool` |
| `test_scheduler.py` collection fails | `aiosqlite` not installed | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) | `backend/predictors/time_series.py:train` |
| Keyboard shortcut "5" goes to Flips, not Arbitrage | By design (iter 92 KI-7) — dead "arbitrage" tab removed from TAB_MAP | `dashboard-page.tsx:TAB_MAP` |
| Keyboard shortcut "0" goes to Circuits, not Liquid Chain | By design (iter 97 F7) | `dashboard-page.tsx:TAB_MAP` |
| FlipsTable "Trend" sparkline looks synthetic | By design (iter 94, Q5) — derived from `momentum × volatility`, NOT historical price data. Switches to real data when backend adds `priceHistoryShort` (TD-9) | `flips-helpers.ts:deriveTrendSparklineData` |
| `/api/poe2/uniques` or `/api/poe2/currencies` returns 200 with empty `items: []` | KI-11 (closed iter 102) — verify `config.yaml:league.league_name` is a valid current POE2Scout league slug (e.g. `runes`) | `src/lib/poe2api.ts:getUniquesByCategory / getCurrenciesByCategory` |
| `GET /api/v1/prices/stream?threshold_pct=1` returns 400 | **KI-13** (open) — low severity, dashboard falls back to polling | `backend/api/routes_sse.py`, `backend/api/middleware_compression.py` |
| Leveling Uniques widget shows "Day 0" or wrong phase | Check `config.yaml` → `league.league_start_date` | `backend/economy/lifecycle.py:PhaseDetector.__init__`, `config.yaml` |
