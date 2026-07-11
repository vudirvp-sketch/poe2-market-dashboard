# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-11 (iter 119 — advanced KI-24 by 1 site. Refactored `src/lib/i18n/index.tsx`: replaced `useState(locale) + useEffect(setLocaleState(stored)) + useEffect(setHydrated(true))` (2 setState-in-effect warnings in one effect) with `useSyncExternalStore` for both `locale` and `hydrated`. Added module-level `hasMounted` flag flipped inside `subscribe()` + callback invocation to preserve the "first render = DEFAULT_LOCALE" invariant without setState. Exported `__resetI18nForTesting` + added `beforeEach` reset in `jest.setup.ts` to prevent test-isolation leak. Lint 120 → 119, 0 errors. 619 jest green, tsc green. KI-24 backlog now 5 sites across 1 React Compiler rule.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### KI-24 — React Compiler rule migration backlog (5 sites remaining, 1 rule)

**Symptom.** `npm run lint` emits 119 warnings (0 errors). Of these, 5 come from 1 React Compiler rule shipped with `eslint-plugin-react-hooks` v7 / `eslint-config-next` v16:

| Rule | Count | Sites |
|------|-------|-------|
| `react-hooks/set-state-in-effect` | 5 | `dashboard-page.tsx` (3), `fuzzy-search.tsx` (1), `use-realms-and-leagues.ts` (1) |

**Closed sub-rules (5 of 10 `set-state-in-effect` sites resolved, see recipes below):**
- `static-components` — fully resolved iter 113.
- `refs` — fully resolved iter 114.
- `set-state-in-effect` iter 115 (`use-price-stream.ts`), iter 116 (`use-reduced-motion.ts`), iter 117 (`header.tsx`), iter 118 (`offline-banner.tsx`), iter 119 (`i18n/index.tsx`).
- `preserve-manual-memoization` — suppressed with rationale iter 116 (`speculation-tab.tsx`).

**Impact.** None at runtime — performance/optimization smells flagged for React Compiler adoption. The code works correctly.

**Cause.** The rules are new in `eslint-plugin-react-hooks` v7 and default to "error". The codebase predates the React Compiler.

**Severity.** Low — performance smells, not bugs. Downgraded to "warn" in `eslint.config.mjs` so `npm run lint` passes while keeping the sites visible.

**Fix (deferred).** Refactor incrementally per-file. Most are legitimate "hydrate from localStorage / sync media query" patterns — evaluate case-by-case; some can move to `useSyncExternalStore`, others are fine as-is.

**Where to fix.** See "Sites" column above. Each site is independent — can be fixed one-by-one without touching others.

---

## Known Issues — closed (recent)

- **KI-23** (closed iter 116): `react-hooks/rules-of-hooks` violation in `unique-table.tsx` — `useReactTable` called INSIDE a `.map()` callback. **Fix:** extracted `<CategoryGroupTable>` child component. (See "rules-of-hooks extraction recipe" below.)
- **KI-20** (closed iter 116): `case-transform.ts` regex `/_([a-z])/g` skipped `_<digit>` underscores — `delta_7d_pct` → `delta_7dPct` (leftover `_`) instead of `delta7dPct`. **Fix:** regex `/_([a-z0-9])/g`. Added 29 jest tests.
- **KI-22** (closed iter 112): ESLint v9 flat config missing → `npm run lint` failed. **Fix:** `eslint.config.mjs` with native flat-config exports from `eslint-config-next` v16. Downgraded 4 React Compiler rules to "warn".
- **KI-21** (closed iter 111): `phase-hints-widget.tsx` `fmtPrice()` rounded `>= 100` to integer. **Fix:** always `toFixed(2)` for `>= 1`, `toFixed(4)` for `< 1`.
- **KI-19/13/16-deep/18/15/11** (closed iter 102-107): see Quick Reference table for one-line fix summaries.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **KI-24** | P3 | 5 React Compiler rule sites remaining (was 25 — `static-components` fully resolved iter 113, `refs` fully resolved iter 114, `set-state-in-effect` 5 of 10 resolved iter 115+116+117+118+119, `preserve-manual-memoization` 1 of 1 suppressed with rationale iter 116). Incremental per-file refactors (see KI-24 table above). |
| **TD-3** | P3 | Triangular arbitrage no persistence — cannot backtest `executable_estimate`. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. |
| **TD-9** | P3 | FlipsTable "Trend" sparkline uses derived `momentum × volatility` — switch to real `priceHistoryShort` when backend adds it. |
| **P10** | P3 | Gold Map ROI (§C.8) — feature work, depends on P1 3-way flips (already done). |

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

**`react-hooks/static-components` fix recipe (iter 113).** When the rule fires on a small inline component (e.g. `SortIndicator`), the fix is mechanical: (1) move the definition to module scope; (2) add a props interface that explicitly accepts every value the closure was capturing (typically `sortField`, `sortDirection`); (3) update every call site to pass these props. The component's render logic does NOT change.

**`react-hooks/refs` fix recipe (iter 114).** When the rule fires on a "latest-ref" pattern (`someRef.current = someProp;` written during render), the safe fix is to move the assignment into a `useEffect` whose deps array contains only the value being synced. Semantics are preserved IFF the ref is never read during render — only in event handlers or other effects. **Effect declaration order matters**: the sync-effect MUST be declared BEFORE any effect that reads the ref, because React runs effects top-to-bottom.

**`react-hooks/set-state-in-effect` fix recipe (iter 115).** The rule fires when `setState` is called synchronously inside a `useEffect` body. Two safe strategies depending on the pattern:
1. **Derive during render** (preferred when the state is fully determined by a prop). If the effect's only purpose is to mirror a prop into state — e.g. `setStatus("disconnected")` when `backendOnline === false` — replace the setState with a derived value in the return statement: `const effectiveStatus = backendOnline === false ? "disconnected" : status;`. This is the React-recommended pattern (https://react.dev/learn/you-might-not-need-an-effect) and eliminates the warning entirely. Only works when the derived value is a pure function of props + existing state.
2. **Move setState into a `useCallback` via a "signal ref"** (when the state genuinely needs to be reset on a prop transition, but is not fully derivable). Add a `useRef<boolean>(false)` "signal" flag; set it to `true` in the effect (a ref write, not flagged by the rule); consume + reset it at the top of the callback BEFORE any early-return guards so the reset fires even if the callback is skipped. The callback is called synchronously from the same effect (`cbRef.current()`), so semantics are preserved. Canonical example: `use-price-stream.ts` `freshSessionRef`.

**`react-hooks/set-state-in-effect` fix via `useSyncExternalStore` (iter 116).** When the effect's purpose is to subscribe to an external store (e.g. `window.matchMedia("(prefers-reduced-motion: reduce)")`), the canonical fix is to rewrite the hook with `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`. This eliminates the `set-state-in-effect` warning entirely because there's no `useEffect` + `setState` pattern — the store subscription is handled by the primitive itself. The three callbacks are: (a) `subscribe(callback)` — attaches a `change` listener and returns cleanup; (b) `getSnapshot()` — reads the current value synchronously (MUST be fast, no allocations); (c) `getServerSnapshot()` — returns the SSR default (typically `false` or `null`). Canonical example: `use-reduced-motion.ts`. Verify with `eslint <file>` (warning gone) + `tsc --noEmit` + `jest` (existing tests still pass).

**`react-hooks/set-state-in-effect` fix for "mounted" flag via `useSyncExternalStore` (iter 117).** A special case of the iter-116 recipe: when the effect's ONLY purpose is to flip a `mounted` boolean from `false` → `true` after first render (the classic `useState(false) + useEffect(() => setMounted(true), [])` SSR-safety pattern, used to gate client-only UI like `next-themes`'s theme toggle), the canonical fix is `const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false)`. Here `subscribe` is a no-op (`() => () => {}`) because there is no external store — the only "transition" is the hydration boundary itself, which React handles internally by switching from `getServerSnapshot` (false) to `getSnapshot` (true) after hydration. Semantics are identical: SSR/first-render = false (matches server HTML, no hydration mismatch), post-hydration = true (client-only UI appears). This is safer than `useEffect` because React guarantees the transition without an extra render cycle. Canonical example: `header.tsx` `mounted` flag (gates the theme toggle button). Extract the three callbacks to module-level named functions for readability and self-documentation.

**`react-hooks/set-state-in-effect` fix via "adjust state during render" (iter 118).** When the effect's purpose is to RESET a piece of state when a prop transitions (e.g. `setDismissed(false)` when `isOnline` goes from `true` → `false`), and there is NO callback consumer to defer into (unlike iter 115's signal-ref pattern which requires a `useCallback` called synchronously from the same effect), the canonical fix is the React-recommended "adjust state during render with a previous-value guard" pattern (ref: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes). Recipe: (1) Add `const [prevProp, setPrevProp] = useState(prop)` initialized to the current prop value (so the first render does NOT trigger a reset — important for hydration safety). (2) During render, check `if (prop !== prevProp) { setPrevProp(prop); if (<reset-condition>) setOtherState(<reset-value>); }`. React explicitly supports calling `setState` during render as a special case — it re-renders immediately without committing the partial state, so there is no visual flash. The `react-hooks/set-state-in-effect` rule does NOT fire because the `setState` is NOT inside a `useEffect`. (3) Trace the transition semantics to verify equivalence: online→offline, offline→online, repeat. Canonical example: `offline-banner.tsx` `dismissed` reset on `isOnline` transition. **When NOT to use this recipe:** if the state is FULLY determined by the prop (no user-action override), use iter 115's recipe 1 (derive during render) instead — no `prevProp` guard needed. **Dead-state cleanup opportunity:** when removing the effect, check for state variables that were only ever set inside it — they may be dead (set but never read) and can be removed in the same commit.

**`react-hooks/set-state-in-effect` fix for external store + first-render invariant via `useSyncExternalStore` + `hasMounted` flag + `subscribe`-callback (iter 119).** When the effect's purpose is to (a) subscribe to an external store (localStorage) AND (b) preserve a "first render = DEFAULT_VALUE" invariant (to avoid hydration mismatches AND to trigger downstream effects like React Query refetches when the value transitions from the default to the stored value), the canonical fix is `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` with a module-level `hasMounted` flag. **Key insight:** `useSyncExternalStore`'s `getServerSnapshot` is ONLY used during hydration — in non-hydration contexts (jsdom tests, client-only routes), `getSnapshot` is used from the very first render. So if `getSnapshot` reads localStorage directly, the first render uses the stored value, breaking the invariant and failing tests that assert a value transition (e.g. `phase-hints-widget.test.tsx` expects 2 fetches: one with "ru", one with "en" after hydration). Recipe: (1) Add a module-level `let hasMounted = false` flag. (2) `getSnapshot` returns `DEFAULT_VALUE` if `!hasMounted`, else reads the external store. (3) In `subscribe`, on the FIRST call, flip `hasMounted = true` AND invoke the callback (`callback()`) to schedule a re-render — this mimics the old `useEffect(() => setState(stored))` transition WITHOUT calling setState inside an effect. React's docs explicitly support calling the callback inside `subscribe` for "the store might have changed since the first render" cases. (4) Subsequent `subscribe` calls (e.g. StrictMode double-invoke) are no-ops because `hasMounted` is already true. (5) **Test isolation:** the module-level `hasMounted` flag persists across tests — export a `__reset<Module>ForTesting()` function and call it in `jest.setup.ts` `beforeEach` to reset `hasMounted` and clear listener sets. (6) `setLocale` (the explicit setter) writes to localStorage AND notifies same-tab listeners via `listeners.forEach(l => l())` — the `storage` event only fires in OTHER tabs, so same-tab consumers need the listener set. Canonical example: `src/lib/i18n/index.tsx` (`locale` + `hydrated` — 2 setState calls in one effect eliminated in a single refactor).

**`react-hooks/preserve-manual-memoization` evaluation recipe (iter 116).** The rule fires when the React Compiler cannot preserve a manual `useMemo` — typically because the compiler's inferred deps are broader than the source's `deps` array (e.g. source uses `[obj?.prop]` to leverage structural sharing, but compiler infers `[obj]`). The recipe: (1) Check if React Compiler is enabled in `next.config.ts` (`experimental.reactCompiler: true`). If NOT enabled, removing `useMemo` is a PERFORMANCE REGRESSION (rebuilds the value every render). (2) Check if the memoized value is consumed in any `useEffect`/`useMemo` deps array. If NOT, removing `useMemo` is correctness-safe (just slower). (3) If compiler not enabled AND the narrow deps are intentional, KEEP the `useMemo` and add an inline `eslint-disable-next-line react-hooks/preserve-manual-memoization` with a comment explaining the rationale + when to revisit (after enabling the compiler). Canonical example: `speculation-tab.tsx:332` `flipsByApiId` (narrow dep `[flipsData?.opportunities]` leverages TanStack Query structural sharing).

**`react-hooks/rules-of-hooks` extraction recipe (iter 116, KI-23).** When a hook is called inside a `.map()` callback (or any non-top-level position), the fix is to extract a child component that calls the hook at its top level. Recipe: (1) Define a `<Child>` component + props interface that accepts every value the closure was capturing. (2) Move the hook call to the top of the child. (3) Replace the `.map()` callback with `<Child key={...} {...props} />`. (4) Pass derived booleans (e.g. `isCollapsed={set.has(name)}`) rather than the whole Set — keeps the child pure. (5) Bind event handlers at the parent (`onToggleCollapse={() => toggle(name)}`) so the child stays generic. Render output is identical. Canonical example: `unique-table.tsx` `<CategoryGroupTable>`.
