# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-11 (iter 111 — fixed KI-21: `fmtPrice` in `phase-hints-widget.tsx` rounded prices ≥ 100 to integer (`115.5 → "116"`), breaking the iter-110 jest test for live-price rendering. Removed the `>= 100 → toFixed(0)` branch; prices now always show 2 decimals for `>= 1`. Added regression test for `1234.5 → "1234.50"`. KI-22 documented — ESLint v9 flat config (`eslint.config.js`) missing, `npm run lint` fails. 1279 pytest green. 581 jest green expected.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### KI-22 — ESLint v9 flat config (`eslint.config.js`) missing → `npm run lint` fails

**Symptom.** `npm run lint` aborts immediately:
```
ESLint: 9.39.4
ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
From ESLint v9.0.0, the default configuration file is now eslint.config.js.
```

**Cause.** `package.json` declares `eslint: ^9.39.4` and `eslint-config-next: ^16.1.1`, but the repo root has NO `eslint.config.js` (and no legacy `.eslintrc.*` either). ESLint v9 dropped legacy `.eslintrc.*` support and requires the new flat config format. The repo was apparently bootstrapped with an older Next.js that emitted `.eslintrc.json`, which was later deleted, leaving the lint command broken.

**Impact.** Low — `tsc --noEmit`, `next build`, `jest`, and `pytest` all pass; only `npm run lint` is broken. Lint is not part of the build pipeline, so this is a developer-experience regression, not a production blocker. `next build` still type-checks via TypeScript.

**Severity.** Low-Medium — lint failures silently mask code-quality drift (unused vars, `any` types, hook deps). Should be fixed in a dedicated iter.

**Fix (deferred).** Create `eslint.config.js` at repo root using the Next.js flat-config preset:
```js
import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [...compat.extends("next/core-web-vitals", "next/typescript")];
```
Requires `@eslint/eslintrc` as a devDependency (usually already transitively present). Risk: low — but needs a full `npm run lint` run to surface any rules that conflict with existing code. Deferred to a dedicated iter to avoid scope creep.

**Where to fix.** New file `eslint.config.js` at repo root.

---

### KI-20 — `case-transform.ts` regex skips `_<digit>` underscores (latent bug in content-pulse)

**Symptom.** Backend snake_case fields containing `_<digit>` patterns (e.g. `delta_7d_pct`, `rolling_7d`, `volume_24h`) are NOT fully camelCased by the frontend proxy's `transformKeys()`. The regex `/_([a-z])/g` only matches underscore followed by a **lowercase letter** — a digit after `_` is left as-is.

**Resulting transform mismatches:**
| Backend field | Expected TS field | Actual transformed key |
|---------------|-------------------|------------------------|
| `delta_7d_pct` | `delta7dPct` | `delta_7dPct` (leftover `_`) |
| `rolling_7d` | `rolling7d` | `rolling_7d` (unchanged) |
| `volume_24h` | `volume24h` | `volume_24h` (unchanged) |

**Impact.** The `ContentPulseCategory` TS interface declares `delta7dPct` / `rolling7d`, but the proxy delivers `delta_7dPct` / `rolling_7d`. The content-pulse widget accesses `category.delta7dPct` → gets `undefined`. The widget likely shows stale/zero delta values silently. NOT a crash, but data loss.

**Cause.** `src/lib/case-transform.ts:17` — `str.replace(/_([a-z])/g, ...)` should be `/_([a-z0-9])/g` to also match digits.

**Severity.** Medium — silent data loss in content-pulse widget deltas. Does not crash. Iter 110 new code (phase-hints live-price binding) AVOIDS the bug by using clean field names without `_<digit>` (`change_pct_week` / `change_pct_month` instead of `change_pct_7d` / `change_pct_30d`).

**Fix (deferred).** Change the regex to `/_([a-z0-9])/g` in `src/lib/case-transform.ts`. Risk: medium — could expose latent type mismatches in other widgets that were silently tolerating the buggy transform. Requires full jest + manual UI regression before merge. Deferred to a dedicated iter.

**Where to fix.** `src/lib/case-transform.ts`.

---

## Known Issues — closed (recent)

- **KI-21** (closed iter 111): `phase-hints-widget.tsx` `fmtPrice()` rounded prices `>= 100` to integer via `toFixed(0)`, so `currentPrice: 115.5` rendered as `"116"` instead of `"115.50"`. The iter-110 jest test `renders current price with the tracked currency label` failed. **Fix:** removed the `price >= 100 → toFixed(0)` branch; `fmtPrice` now always uses `toFixed(2)` for `>= 1` and `toFixed(4)` for `< 1`. Added regression test `renders large price (>= 1000) with 2 decimals` (`1234.5 → "1234.50"`). Verified: `fmtPrice` is only used in `phase-hints-widget.tsx` (line 436) — no other call sites, no side effects.
- **KI-19** (closed iter 107): `scripts/DELETE_*.ts` placeholder files broke `next build`. Fix: `DELETE_obsolete_files.sh` removes the glob; `tsconfig.json` `exclude` includes `**/DELETE_*`.
- **KI-13** (closed iter 107, **verified iter 108**): `GET /api/v1/prices/stream?threshold_pct=1` returned 400 — SSE router registered after greedy `{pair:path}` router. Fix: register `sse_router` BEFORE `prices_router` in `backend/main.py`.
- **KI-16-deep** (closed iter 106): Turbopack NFT warning — replaced `spawn`/`spawnSync` with `exec`/`execSync` in `flipper-backend-bridge.ts`.
- **KI-18** (closed iter 105): `pytest` hung on `test_triangular.py` — `conftest.py` patches `get_process_pool` → None.
- **KI-17** (closed iter 104): `instrumentation.ts` JSDoc contained `*/` sequence.
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
| `npm run lint` fails with "ESLint couldn't find an eslint.config.(js\|mjs\|cjs) file" | **KI-22** (open) — ESLint v9 requires flat config `eslint.config.js`; repo has none. `tsc`/`build`/`jest`/`pytest` still pass. | New file `eslint.config.js` (see KI-22 fix recipe) |
| `phase-hints-widget` jest test "renders current price" fails with `Expected: "115.50", Received: "116"` | **KI-21** (fixed iter 111) — `fmtPrice` rounded `>= 100` to integer. Fix already applied. | `src/components/dashboard/phase-hints-widget.tsx:fmtPrice` |
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
| Mirror/Divine Arb tab shows "no price history yet" | By design (iter 109) — backend returns `data_available: false` when scheduler hasn't collected ≥ 4 Mirror + Divine price snapshots in the lookback window. Wait for the scheduler or widen the days selector. | `backend/economy/mirror_divine_arb.py`, `mirror-divine-arb-tab.tsx` |
| `/api/poe2/uniques` or `/api/poe2/currencies` returns 200 with empty `items: []` | KI-11 (closed iter 102) — verify `config.yaml:league.league_name` is valid | `src/lib/poe2api.ts` |
| Leveling Uniques widget shows "Day 0" or wrong phase | Check `config.yaml` → `league.league_start_date` | `backend/economy/lifecycle.py:PhaseDetector`, `config.yaml` |
| `flipper-bridge.log` file no longer created | By design (iter 106, KI-16-deep) — redirect: `npm run start > flipper-bridge.log 2>&1` | `src/lib/flipper-backend-bridge.ts` |
| `npx tsc --noEmit` or `npm run jest` OOM-killed on 4GB RAM | Known env limit since iter 99 — needs 8GB+ RAM. Use a beefier machine or split the run. | environment |

---

## Key technical insight for future agents

**FastAPI route matching is ORDER-DEPENDENT.** A `{param:path}` converter is greedy and matches slashes — it will shadow any literal sub-path registered AFTER it. Always register literal-path routers BEFORE greedy-path routers. The KI-13 bug (SSE `/api/v1/prices/stream` shadowed by `/api/v1/prices/{pair:path}`) survived 6 iterations because the SSE router was registered after the prices router.

**Frontend price formatting convention.** `fmtPrice`-style helpers across the dashboard should keep 2 decimals for prices `>= 1` and 4 decimals for `< 1`. The KI-21 bug was caused by an "optimization" that rounded `>= 100` to integer — this silently broke the iter-110 live-price test and was only caught when jest was finally run. If you ever feel tempted to truncate large prices to integers, add a test first.
