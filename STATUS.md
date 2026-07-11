# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-11 (iter 115 — incremental KI-24 fix: eliminated the 1 `react-hooks/set-state-in-effect` warning in `use-price-stream.ts` by (a) deriving `status`/`lastError` from `backendOnline` in the return statement and (b) moving `setReconnectCount(0)`/`setLastError(null)` out of the transitions effect into `connect()` via a `freshSessionRef` latest-ref pattern. Lint 126 → 125, 0 errors. 582 jest green, tsc green, no backend/test changes. KI-24 backlog now 10 sites across 2 React Compiler rules.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### KI-23 — `react-hooks/rules-of-hooks` violation in `unique-table.tsx` (latent runtime bug)

**Symptom.** `useReactTable(...)` is called INSIDE a `.map()` callback at `src/components/dashboard/unique-table.tsx:305`:
```tsx
{categoryGroups.map((group) => {
  const isCollapsed = collapsedCategories.has(group.name);
  const table = useReactTable({ ... });  // ← HOOK INSIDE CALLBACK
  ...
})}
```

**Impact.** Latent — crashes only if `categoryGroups.length` changes between renders (e.g., a new category appears/disappears). In practice the category list is static within a session, so the bug never triggers. But it IS a real Rules-of-Hooks violation: the number of hooks called varies with `categoryGroups.length`, which breaks React's hook-ordering invariant.

**Cause.** `useReactTable` from `@tanstack/react-table` is a hook and must be called at the top level of a component, not inside a loop/callback.

**Severity.** Low-Medium — latent; no visible bug today, but will crash if category list ever becomes dynamic.

**Fix (deferred).** Extract a `<CategoryGroupTable group={group} columns={columns} sorting={sorting} setSorting={setSorting} .../>` child component that calls `useReactTable` at its top level. The child receives all needed props (≈10 props: `group`, `columns`, `sorting`, `setSorting`, `collapsedCategories`, `toggleCategoryCollapse`, `t`, `highlightedItemId`, `onItemClick`, `handleRowMouseEnter`, `rowHeight`, `fontSize`, `cellPadding`). Mechanical refactor but touches a 120-line block — defer to a dedicated iter with full UI regression.

**Current mitigation.** Inline `// eslint-disable-next-line react-hooks/rules-of-hooks -- KI-23: ...` at line 305 so `npm run lint` passes. The rule stays active everywhere else.

**Where to fix.** `src/components/dashboard/unique-table.tsx:303-430` (the `.map()` block).

---

### KI-24 — React Compiler rule migration backlog (10 sites remaining, 2 rules)

**Symptom.** `npm run lint` emits 125 warnings (0 errors). Of these, 10 come from 2 new React Compiler rules shipped with `eslint-plugin-react-hooks` v7 / `eslint-config-next` v16:

| Rule | Count | Sites |
|------|-------|-------|
| `react-hooks/set-state-in-effect` | 9 | `dashboard-page.tsx` (3), `fuzzy-search.tsx` (1), `header.tsx` (1), `offline-banner.tsx` (1), `use-realms-and-leagues.ts` (1), `use-reduced-motion.ts` (1), `i18n/index.tsx` (1) |
| `react-hooks/preserve-manual-memoization` | 1 | `speculation-tab.tsx:316` |

**Note (iter 113).** `react-hooks/static-components` (12 sites, was the largest bucket) is **fully resolved** — `SortIndicator` moved to module scope in `exchange-table.tsx` (7 sites) and `watchlist-tab.tsx` (5 sites). Each usage now passes `sortField`/`sortDirection` as explicit props. The rule no longer fires anywhere.

**Note (iter 114).** `react-hooks/refs` (2 sites) is **fully resolved** — both latest-ref writes in `use-price-stream.ts` (`thresholdRef.current = invalidationThresholdPct` and `connectRef.current = connect`) moved into `useEffect` hooks. The sync-effects are declared BEFORE the consuming connect-on-mount effect so declaration order guarantees the ref is updated before any reader runs. The rule no longer fires anywhere.

**Note (iter 115).** `react-hooks/set-state-in-effect` reduced from 10 → 9 sites in `use-price-stream.ts`. The single site was the `backendOnline` transitions effect, which called `setStatus("disconnected")` + `setLastError(null)` (offline branch) and `setReconnectCount(0)` (online branch). Fix: (a) `status` and `lastError` are now DERIVED from `backendOnline` in the return statement (`backendOnline === false ? "disconnected" : status`) — no setState needed for the offline branch; (b) `setReconnectCount(0)` + `setLastError(null)` (stale-error clear) moved into `connect()` via a `freshSessionRef` latest-ref pattern: the ref is set to `true` in the transitions effect (a ref write, not flagged) and consumed at the top of `connect()` (a useCallback, not an effect) before any early-return guards. Semantics fully preserved — the reset still fires synchronously in the same tick because `connectRef.current()` is called immediately after setting the ref.

**Impact.** None at runtime — these are performance/optimization smells flagged for React Compiler adoption. The code works correctly; the rules flag patterns the compiler can't optimize (setState in effects can cascade, manual memoization may conflict with compiler output).

**Cause.** The rules are new in `eslint-plugin-react-hooks` v7 and default to "error". The codebase predates the React Compiler.

**Severity.** Low — performance smells, not bugs. Downgraded to "warn" in `eslint.config.mjs` so `npm run lint` passes while keeping the sites visible.

**Fix (deferred).** Refactor incrementally per-file:
- `set-state-in-effect`: most are legitimate "hydrate from localStorage / sync media query" patterns — evaluate case-by-case; some can move to `useSyncExternalStore`, others are fine as-is.
- `preserve-manual-memoization`: evaluate whether `useMemo` can be removed (compiler handles it).

**Where to fix.** See "Sites" column above. Each site is independent — can be fixed one-by-one without touching others.

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

- **KI-22** (closed iter 112): ESLint v9 flat config (`eslint.config.js`) missing → `npm run lint` failed with "ESLint couldn't find an eslint.config.(js|mjs|cjs) file". **Fix:** created `eslint.config.mjs` using native flat-config exports from `eslint-config-next` v16 (`core-web-vitals` + `typescript` presets, no `FlatCompat` wrapper). Added project-specific ignores (`cloudflare-worker/`, `e2e/`, `backend/`, `tests/`, `*.json`, `DELETE_*.ts`). Fixed 6 source errors: 5× `prefer-const` (test files), 1× `no-explicit-any` (`liquid-chain-tab.tsx` — typed `NAMES` as `Record<string, TranslationKeys>` instead of `as any`). Added inline `eslint-disable` for 5 legitimate `require()` calls (`jest.setup.ts:27` undici loader, `poe2api.ts:2684-2685` server-only `fs`/`path` dynamic require). Disabled `@typescript-eslint/no-require-imports` for `*.js` files (Node.js scripts like `scripts/bump-sw-cache.js`). Discovered KI-23 (rules-of-hooks in `unique-table.tsx`) and KI-24 (25 React Compiler rule sites) — both downgraded/documented, refactors deferred. Final: `npm run lint` exits 0 with 140 warnings.
- **KI-21** (closed iter 111): `phase-hints-widget.tsx` `fmtPrice()` rounded prices `>= 100` to integer via `toFixed(0)`, so `currentPrice: 115.5` rendered as `"116"` instead of `"115.50"`. The iter-110 jest test `renders current price with the tracked currency label` failed. **Fix:** removed the `price >= 100 → toFixed(0)` branch; `fmtPrice` now always uses `toFixed(2)` for `>= 1` and `toFixed(4)` for `< 1`. Added regression test `renders large price (>= 1000) with 2 decimals` (`1234.5 → "1234.50"`).
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
| **KI-23** | P2 | `unique-table.tsx` — extract `<CategoryGroupTable>` child to fix rules-of-hooks violation. Mechanical refactor, ~120 lines. |
| **KI-24** | P3 | 10 React Compiler rule sites remaining (was 25 — `static-components` fully resolved iter 113, `refs` fully resolved iter 114, `set-state-in-effect` 1 of 10 resolved iter 115). Incremental per-file refactors (see KI-24 table above). |
| **TD-3** | P3 | Triangular arbitrage no persistence — cannot backtest `executable_estimate`. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. |
| **TD-9** | P3 | FlipsTable "Trend" sparkline uses derived `momentum × volatility` — switch to real `priceHistoryShort` when backend adds it. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
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
| `npx tsc --noEmit` or `npm run jest` OOM-killed on 4GB RAM | Known env limit since iter 99 — needs 8GB+ RAM. `jest --maxWorkers=1` helps. | environment |

---

## Key technical insights for future agents

**FastAPI route matching is ORDER-DEPENDENT.** A `{param:path}` converter is greedy and matches slashes — it will shadow any literal sub-path registered AFTER it. Always register literal-path routers BEFORE greedy-path routers. The KI-13 bug (SSE `/api/v1/prices/stream` shadowed by `/api/v1/prices/{pair:path}`) survived 6 iterations because the SSE router was registered after the prices router.

**Frontend price formatting convention.** `fmtPrice`-style helpers across the dashboard should keep 2 decimals for prices `>= 1` and 4 decimals for `< 1`. The KI-21 bug was caused by an "optimization" that rounded `>= 100` to integer — this silently broke the iter-110 live-price test and was only caught when jest was finally run. If you ever feel tempted to truncate large prices to integers, add a test first.

**ESLint v9 flat config (KI-22 closed iter 112).** `eslint-config-next` v16 ships native flat-config exports at `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` — no `FlatCompat` / `@eslint/eslintrc` wrapper needed. Just spread them into your `eslint.config.mjs`. The 4 new React Compiler rules (`set-state-in-effect`, `static-components`, `preserve-manual-memoization`, `refs`) default to "error" and will break lint on any existing codebase — downgrade to "warn" in the config (see KI-24) and refactor incrementally.

**`react-hooks/static-components` fix recipe (iter 113).** When the rule fires on a small inline component (e.g. `SortIndicator`), the fix is mechanical: (1) move the definition to module scope; (2) add a props interface that explicitly accepts every value the closure was capturing (typically `sortField`, `sortDirection`); (3) update every call site to pass these props. The component's render logic does NOT change. After the move, React sees a stable component type across renders, so the compiler can optimize and the subtree no longer remounts on parent re-render. Verify with `tsc --noEmit` (prop types match) + `jest` (existing snapshot/interaction tests still pass) + `eslint .` (the `static-components` warnings for that file are gone).

**`react-hooks/refs` fix recipe (iter 114).** When the rule fires on a "latest-ref" pattern (`someRef.current = someProp;` written during render), the safe fix is to move the assignment into a `useEffect` whose deps array contains only the value being synced. Semantics are preserved IFF the ref is never read during render — only in event handlers or other effects. **Effect declaration order matters**: the sync-effect MUST be declared BEFORE any effect that reads the ref, because React runs effects top-to-bottom. For the canonical example, see `use-price-stream.ts:116-128` (sync `thresholdRef`) and `use-price-stream.ts:338-352` (sync `connectRef` — placed before the connect-on-mount effect at line 357 that calls `connectRef.current()`). Verify with `eslint <file>` (the `refs` warnings are gone) + `tsc --noEmit` + `jest` (existing tests still pass — they exercise the hook's external behavior, not its internal ref-sync timing).

**`react-hooks/set-state-in-effect` fix recipe (iter 115).** The rule fires when `setState` is called synchronously inside a `useEffect` body. Two safe strategies depending on the pattern:
1. **Derive during render** (preferred when the state is fully determined by a prop). If the effect's only purpose is to mirror a prop into state — e.g. `setStatus("disconnected")` when `backendOnline === false` — replace the setState with a derived value in the return statement: `const effectiveStatus = backendOnline === false ? "disconnected" : status;`. This is the React-recommended pattern (https://react.dev/learn/you-might-not-need-an-effect) and eliminates the warning entirely. Only works when the derived value is a pure function of props + existing state.
2. **Move setState into a `useCallback` via a "signal ref"** (when the state genuinely needs to be reset on a prop transition, but is not fully derivable). Add a `useRef<boolean>(false)` "signal" flag; set it to `true` in the effect (a ref write, not flagged by the rule); consume + reset it at the top of the callback BEFORE any early-return guards so the reset fires even if the callback is skipped. The callback is called synchronously from the same effect (`cbRef.current()`), so semantics are preserved. The signal-ref guard ensures the reset fires only once per transition — not on every callback invocation. Canonical example: `use-price-stream.ts` `freshSessionRef` (set in the `backendOnline` transitions effect, consumed at the top of `connect()`). Verify with `eslint <file>` (the `set-state-in-effect` warning is gone) + `tsc --noEmit` + `jest`.
