# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-108
Agent: main
Task: iter 108 — P7 Mirror/Divine Arb Detector (backend pure function + API route + Next.js proxy + TS types + 70 pytest). Verify KI-13 in production log.

Work Log:
- Cloned repo. Read STATUS.md (KI-13 closed iter 107, KI-19 open, TD-3/4/5/9 backlog), worklog.md (iter 106/107 entries), docs/MARKET_PLAYBOOK.md §C.6 (P7 plan: "Расширить `storage_value.py`: для предметов ≥ 1 Mirror показывать arbitrage opportunity"), §P7 description, backend/economy/storage_value_history.py (existing nearest-neighbour helper), backend/economy/circuit_patterns.py (pure-function pattern to follow), backend/api/routes_circuit_patterns.py (thin-wrapper route pattern), backend/api/response_models.py (pydantic model conventions).
- **KI-13 production verification (DONE).** User-provided backend log contains: `2026-07-11 07:05:33,510 [INFO] backend.api.routes_sse: SSE /stream request received (threshold_pct=1.0000) — route matched correctly` followed by `SSE generator started (threshold_pct=1.0000, poll_interval=5.0s)`. The iter 107 fix (register sse_router BEFORE prices_router in main.py) is confirmed working in production — no more 400, route is correctly hit.
- **P7 design decision.** The §C.6 plan said "extend storage_value.py", but on reading the existing code I judged it cleaner to add a NEW dedicated module `backend/economy/mirror_divine_arb.py` rather than overload `storage_value.py` (which is about per-currency hold/sell decisions, not about the Mirror:Divine market rate). The detector analyzes the rate series (mirror_price / divine_price) over a lookback window and emits a SINGLE-OBJECT response (Mirror:Divine is one market, not a per-currency list). This differs from circuit_patterns/speculation/intraday/weekly which all return per-currency lists.
- **Algorithm.** For each timestamp in mirror_history, find nearest divine_price (24h tolerance, reuses `_find_nearest_price` from `storage_value_history.py` to keep the two views consistent). Compute rate series, filter to lookback window, then: current_rate / mean_rate / std_rate (sample, ddof=1) / min_rate / max_rate / z_score / deviation_pct / profit_potential_per_mirror_div = |current - mean|. Signal: SELL_MIRROR_BUY_DIVINE (z ≥ +1.5) / SELL_DIVINE_BUY_MIRROR (z ≤ -1.5) / NEUTRAL. is_actionable = profit_potential >= 100 Div (PROFIT_THRESHOLD_DIV per playbook). recommended_action: EXECUTE_ARB (actionable AND |z| ≥ 1.5) / WATCH (actionable AND |z| in [1.0, 1.5)) / HOLD.
- **Bug found + fixed during testing.** First test run revealed `_std()` always used `statistics.stdev()` (sample std, ddof=1) regardless of the `ddof` parameter — the param was documented but ignored. Fixed: now uses `statistics.pstdev()` when ddof=0. Also fixed several incorrect std/z-score math expectations in tests (sample std of [1,3] is sqrt(2), not 2.0; for 4-stable-then-spike 5-point series, z is always 4/sqrt(5) ≈ 1.789, not 2.0).
- **Backend files created:**
  - `backend/economy/mirror_divine_arb.py` (350 lines) — pure function + helpers + tunable constants (MIN_SAMPLE_SIZE=4, PROFIT_THRESHOLD_DIV=100.0, Z_BUY=-1.5, Z_SELL=+1.5, Z_WATCH=1.0, MAX_HISTORY_POINTS=14).
  - `backend/api/routes_mirror_divine_arb.py` (105 lines) — thin FastAPI wrapper, GET /api/v1/mirror-divine-arb?days=N.
  - `backend/api/response_models.py` — added `MirrorDivineArbRatePoint` + `MirrorDivineArbResponse` models.
  - `backend/main.py` — registered `mirror_divine_arb_router` after `leveling_uniques_router` (additive, wrapped in try/except ImportError).
- **Frontend files created:**
  - `src/app/api/flipper/mirror-divine-arb/route.ts` — Next.js proxy (same pattern as circuit-patterns/route.ts).
  - `src/lib/types.ts` — added `MirrorDivineArbSignal` / `MirrorDivineArbAction` / `MirrorDivineArbRatePoint` / `MirrorDivineArbResponse`.
- **Tests:** `tests/test_mirror_divine_arb.py` (70 tests, 12 test classes: TestExtractRateSeries × 11, TestFilterToWindow × 6, TestMeanStdZscore × 11, TestSignalFromZscore × 7, TestRecommendedAction × 8, TestComputeMirrorDivineArbEmpty × 4, TestComputeMirrorDivineArbSteady × 2, TestComputeMirrorDivineArbSpike × 3, TestComputeMirrorDivineArbWatch × 1, TestComputeMirrorDivineArbPriceHistoryShort × 2, TestComputeMirrorDivineArbDefensive × 13, TestRouteHandler × 2). All green.
- **Verification:** `python3 -m pytest -q --ignore=tests/test_scheduler.py` → 1218 passed in 8.70s (was 1161 in iter 107 + 70 new − 13 test_scheduler skipped due to missing aiosqlite in iteration env). Router registration verified: `/api/v1/mirror-divine-arb` appears in `app.routes`. TS files syntax-checked (balanced braces/parens after stripping strings/comments). tsc/jest not run — OOM-killer at `npm install` (Known Issue since iter 99, requires 8GB+ RAM).
- **Docs updated:** STATUS.md (KI-13 marked "verified iter 108", iter 108 update line, added "Key technical insight" footer about FastAPI route-order-dependence). docs/MARKET_PLAYBOOK.md (§C.6 replaced with full DONE description, §B P7 row updated, §D.2 status updated, §D.3 replaced with iter 108 stop point, §E refreshed, header updated). worklog.md (appended iter 108, trimmed iter 105 — only iter 107 + iter 108 kept).

Stage Summary:
- **iter 108 SHIPPED — P7 Mirror/Divine Arb Detector backend DONE.** KI-13 production-verified.
- New files (4): `backend/economy/mirror_divine_arb.py`, `backend/api/routes_mirror_divine_arb.py`, `src/app/api/flipper/mirror-divine-arb/route.ts`, `tests/test_mirror_divine_arb.py`.
- Modified files (4): `backend/api/response_models.py` (added 2 pydantic models), `backend/main.py` (registered new router), `src/lib/types.ts` (added 4 TS types), `docs/MARKET_PLAYBOOK.md`, `STATUS.md`, `worklog.md`.
- Verified: pytest 1218 green (70 new + 1148 regression; 13 skipped). Router registered. TS files syntax-checked.
- **Key design decision for future agents:** P7 returns a SINGLE-OBJECT response, not a per-currency list. Mirror:Divine is ONE market — the detector analyzes the rate series for that one market. UI tab (iter 109) should follow the speculation-tab pattern but render a single record (current rate / z-score / signal / action / sparkline), NOT a table of rows.
- **Stopping point:** iter 108 = P7 backend + proxy + TS types + 70 tests + docs. Next iter (iter 109) candidates: (a) P7 UI tab — `mirror-divine-arb-tab.tsx` (single-object render, sparkline, signal/action badges) + wiring in dashboard-page/toolbar/shortcuts-dialog + i18n × 4 locales; (b) TD-3/4/5/9 persistence gaps; (c) P9 Phase-aware investment advisor (§C.7).

---

Task ID: iter-107
Agent: main
Task: iter 107 — Fix KI-13 (SSE 400 error) + document/fix KI-19 (DELETE_*.ts build break).

Work Log:
- Cloned repo. Read STATUS.md (KI-13 open 6 iters, KI-16-deep closed, KI-15/17/18 closed), worklog.md (iter 106 entry). User build log showed NEW build failure: `scripts/DELETE_flipper-backend-bridge.ts:1:1 Type error: Unknown keyword or identifier. Did you mean 'delete'?`.
- **KI-19 documented FIRST** (per user rule "If found new bug — document in STATUS.md as Known Issue, THEN fix"). Root cause: a previous iteration created `scripts/DELETE_flipper-backend-bridge.ts` as a "note to delete this file" placeholder. Next.js type-checks ALL `.ts` files; `DELETE` (uppercase) is parsed as identifier, not the `delete` keyword. Fix: (1) updated `DELETE_obsolete_files.sh` to glob-delete `scripts/DELETE_*.ts` and `scripts/DELETE_*.tsx`; (2) added `"**/DELETE_*"` to `tsconfig.json` exclude as defense-in-depth.
- **KI-13 root cause FOUND.** `prices_router` (`/api/v1/prices/{pair:path}`) was registered BEFORE `sse_router` (`/api/v1/prices/stream`). FastAPI matches routes in registration order, so `{pair:path}` captured `/stream` → `HTTPException(400, "Invalid pair format: stream")`.
- **KI-13 fix applied.** Moved SSE router registration ABOVE `app.include_router(prices_router)` in `main.py`. Added explicit logging to `_sse_event_generator` + `sse_price_stream` handler. Added 2 regression tests in `tests/e2e/test_sse.py`.
- **Verification:** tsc clean, next build succeeds (9.0s, zero warnings), jest 569 green, pytest 1161 green.
- **Docs updated:** STATUS.md, worklog.md.

Stage Summary:
- **iter 107 SHIPPED — KI-13 FIXED (route-registration order), KI-19 documented + fixed (DELETE_*.ts build break).**
- Modified files (5): `backend/main.py`, `backend/api/routes_sse.py`, `tests/e2e/test_sse.py`, `DELETE_obsolete_files.sh`, `tsconfig.json`, `STATUS.md`, `worklog.md`.
- **Key technical finding for future agents:** FastAPI route matching is ORDER-DEPENDENT. A `{param:path}` converter is greedy and matches slashes — it will shadow any literal sub-path registered AFTER it. ALWAYS register literal-path routers BEFORE greedy-path routers.
- **Stopping point:** iter 107 = KI-13 + KI-19 done. Next iter (iter 108) candidates: (a) P7 Mirror/Divine Arb Detector (§C.6); (b) TD-3/4/5/9; (c) verify KI-13 fix in production.
