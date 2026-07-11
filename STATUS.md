# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-11 (iter 108 — P7 Mirror/Divine Arb Detector shipped: backend pure function + FastAPI route + Next.js proxy + 70 pytest green. KI-13 confirmed working in production log. Build + 1218 pytest green; tsc/jest not run locally due to OOM-killer at `npm install` — see iter 100 notes.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### KI-19 — `scripts/DELETE_*.ts` placeholder files break `next build`

**Symptom.** `next build` fails during TypeScript check:
```
./scripts/DELETE_flipper-backend-bridge.ts:1:1
Type error: Unknown keyword or identifier. Did you mean 'delete'?
> 1 | DELETE this file: scripts/flipper-backend-bridge.ts
```

**Cause.** A previous iteration created `scripts/DELETE_flipper-backend-bridge.ts` as a human-readable "note to delete this file" placeholder. Next.js type-checks ALL `.ts` files (per `tsconfig.json` `include: ["**/*.ts"]`). The file content starts with `DELETE` (uppercase), which TypeScript parses as an identifier — not the `delete` keyword — and fails.

**Severity.** High — blocks build entirely. But only affects working copies that have the placeholder file; the remote repo does NOT contain it.

**Fix (iter 107).** Two-layer defense:
1. `DELETE_obsolete_files.sh` now deletes `scripts/DELETE_*.ts` and `scripts/DELETE_*.tsx` glob patterns.
2. `tsconfig.json` `exclude` now includes `"**/DELETE_*"` — even if a DELETE_* file slips in, tsc won't type-check it.

**Where to fix.** `DELETE_obsolete_files.sh`, `tsconfig.json`.

---

## Known Issues — closed (recent)

- **KI-13** (closed iter 107, **verified iter 108**): `GET /api/v1/prices/stream?threshold_pct=1` returned 400. **Root cause:** route-registration order in `backend/main.py`. The greedy route `/api/v1/prices/{pair:path}` (in `routes_prices.py`) was registered BEFORE the SSE route `/api/v1/prices/stream` (in `routes_sse.py`). FastAPI matches routes in registration order, so `{pair:path}` captured `/stream` as a pair name → `HTTPException(400, "Invalid pair format: stream. Expected 'from/to'.")`. **Fix:** moved SSE router registration ABOVE prices router registration in `main.py`. **Production verification (iter 108):** backend log shows `SSE /stream request received (threshold_pct=1.0000) — route matched correctly` followed by `SSE generator started` — route is correctly hit, no more 400.
- **KI-16-deep** (closed iter 106): Turbopack NFT warning permanently eliminated. Fix: replaced all `spawn`/`spawnSync` with `exec`/`execSync` in `src/lib/flipper-backend-bridge.ts`.
- **KI-18** (closed iter 105): `pytest` hung on `test_triangular.py`. Fix: `tests/conftest.py` autouse fixture patches `get_process_pool` → None.
- **KI-17** (closed iter 104): `instrumentation.ts` JSDoc contained `*/` sequence. Fix: reworded comment.
- **KI-15** (closed iter 103): `api.poe2scout.com` dead. Use `POE2_API_BASE_URL=https://poe2scout.com/api`.
- **KI-11** (closed iter 102): 502 on `/api/poe2/uniques` & `/api/poe2/currencies`. Fix: route handlers catch upstream 4xx.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **TD-3** | P3 | Triangular arbitrage no persistence — cannot backtest `executable_estimate`. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. |
| **TD-9** | P3 | FlipsTable "Trend" sparkline uses derived `momentum × volatility` — switch to real `priceHistoryShort` when backend adds it. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| All API calls return 404; dashboard empty | **KI-15** — `.env.local` has dead `api.poe2scout.com`. Use `POE2_API_BASE_URL=https://poe2scout.com/api` | `.env.local`, `start.bat`, `start.sh` |
| `next build` fails with "Unknown keyword or identifier. Did you mean 'delete'?" on a `DELETE_*.ts` file | **KI-19** (fixed iter 107) — run `DELETE_obsolete_files.sh` to remove placeholder files. `tsconfig.json` now excludes `**/DELETE_*` as defense-in-depth. | `DELETE_obsolete_files.sh`, `tsconfig.json` |
| `GET /api/v1/prices/stream?threshold_pct=1` returns 400 | **KI-13** (fixed iter 107, verified iter 108) — SSE router must be registered before prices router in `main.py` | `backend/main.py`, `backend/api/routes_sse.py` |
| `next build` warns "Encountered unexpected file in NFT list ... flipper-backend-bridge.ts" | **KI-16-deep** (fixed iter 106) — bridge must use `exec`/`execSync`, not `spawn`/`spawnSync`. No `fs`/`path` imports. | `instrumentation.ts`, `src/lib/flipper-backend-bridge.ts` |
| `pytest` hangs on `test_triangular.py` | **KI-18** (fixed iter 105) — check `tests/conftest.py` patches `get_process_pool` → None | `tests/conftest.py` |
| `test_scheduler.py` collection fails | `aiosqlite` not installed | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) | `backend/predictors/time_series.py:train` |
| Keyboard shortcut "5" goes to Flips, not Arbitrage | By design (iter 92 KI-7) | `dashboard-page.tsx:TAB_MAP` |
| Keyboard shortcut "0" goes to Circuits, not Liquid Chain | By design (iter 97 F7) | `dashboard-page.tsx:TAB_MAP` |
| FlipsTable "Trend" sparkline looks synthetic | By design (iter 94, Q5) — derived from `momentum × volatility` (TD-9) | `flips-helpers.ts:deriveTrendSparklineData` |
| `/api/poe2/uniques` or `/api/poe2/currencies` returns 200 with empty `items: []` | KI-11 (closed iter 102) — verify `config.yaml:league.league_name` is valid | `src/lib/poe2api.ts` |
| Leveling Uniques widget shows "Day 0" or wrong phase | Check `config.yaml` → `league.league_start_date` | `backend/economy/lifecycle.py:PhaseDetector`, `config.yaml` |
| `flipper-bridge.log` file no longer created | By design (iter 106, KI-16-deep) — redirect: `npm run start > flipper-bridge.log 2>&1` | `src/lib/flipper-backend-bridge.ts` |

---

## Key technical insight for future agents

**FastAPI route matching is ORDER-DEPENDENT.** A `{param:path}` converter is greedy and matches slashes — it will shadow any literal sub-path registered AFTER it. Always register literal-path routers BEFORE greedy-path routers. The KI-13 bug (SSE `/api/v1/prices/stream` shadowed by `/api/v1/prices/{pair:path}`) survived 6 iterations because the SSE router was registered after the prices router.
