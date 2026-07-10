# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-11 (iter 104 — fixed KI-17: `instrumentation.ts` build-break from premature `*/` inside JSDoc. Build + 569 jest tests pass.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### KI-13 — `/api/v1/prices/stream?threshold_pct=1` returns 400

**Symptom.** Backend log: `GET /api/v1/prices/stream?threshold_pct=1 → 400 Bad Request`. SSE endpoint invoked once on dashboard load.

**Cause (uncertain).** Route defines `threshold_pct: float = Query(0.5, ge=0.0, le=50.0)` so `1` should pass. Candidates: middleware rejecting `text/event-stream`; missing `Accept` header; exception in `_sse_event_generator` on empty snapshot.

**Severity.** Low — dashboard falls back to polling. Only clutters the log.

**Where to fix.** `backend/api/routes_sse.py:_sse_event_generator`, `backend/api/middleware_compression.py`.

---

## Known Issues — closed (recent)

- **KI-17** (closed iter 104): `instrumentation.ts` JSDoc comment contained the literal sequence `*/` (inside `/* turbopackIgnore: true */`), which prematurely closed the comment block. Everything after `*/` was parsed as TypeScript → build failed with `Expected ';', '}' or <eof>` at line 23. **Fix:** reworded the comment to avoid the `*/` sequence. Build now succeeds. Root cause of the iter-103 "build fails" report.
- **KI-15** (closed iter 103): `api.poe2scout.com` subdomain is DEAD — returns 404 for every endpoint. API moved to bare domain `poe2scout.com/api/*`. All runtime paths, configs, scripts, i18n, docs, test fixtures updated. `start.bat` / `start.sh` now WARN if `.env.local` still contains `api.` subdomain. **User action:** delete or edit `.env.local` to `POE2_API_BASE_URL=https://poe2scout.com/api`.
- **KI-16** (closed iter 103): iter 102 added `/* turbopackIgnore: true */` to silence the cosmetic NFT warning — this was a regression that fully excluded the bridge from the server bundle, causing `Cannot find module` at runtime. Magic comment removed. NFT warning is cosmetic only; build and runtime work. **Long-term fix (P2):** move `scripts/flipper-backend-bridge.ts` → `src/lib/` so Turbopack bundles it as a regular module (see TD backlog).
- **KI-11** (closed iter 102): 502 on `/api/poe2/uniques` & `/api/poe2/currencies` — route handlers now catch upstream 4xx and return empty `PaginatedResponse`.
- **KI-14** (closed iter 101): `leveling-uniques-widget.test.tsx` — fixed by regex match + mock count snapshot.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **KI-16-fix** | P2 | Move `scripts/flipper-backend-bridge.ts` → `src/lib/flipper-backend-bridge.ts` so Turbopack bundles it as a regular module (eliminates NFT warning permanently). |
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
| `[instrumentation] Flipper backend bridge failed to start: Cannot find module` | **KI-16** (fixed iter 103) — if still seen, delete `.next` and rebuild | `instrumentation.ts`, `scripts/flipper-backend-bridge.ts` |
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
