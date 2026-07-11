# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-11 (iter 124 — TD-10 + TD-11 closed. 3 pre-existing lint warnings in `dashboard-page.tsx` fixed; 26 obsolete iter-100–118 cleanup files removed. Lint 114 → 111, 0 errors. 622 jest green, tsc green.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### None. See "Technical-debt backlog" for low-priority items.

---

## Known Issues — closed (recent)

- **TD-10** (closed iter 124): 3 pre-existing lint warnings in `dashboard-page.tsx` — unused `ReferenceCurrency` import, unused `sseStatus` destructuring, `keyboardActions` useMemo exhaustive-deps (missing `TAB_MAP`, `openDetail`). Fix: removed the import; called `usePriceStream` without destructuring; moved `TAB_MAP` to module level (stable identity) + wrapped `setTab` in `useCallback` + added `openDetail` to deps. Lint 114 → 111.
- **TD-11** (closed iter 124): Repo cleanup — removed 26 obsolete files: 8 `MERGE_INSTRUCTIONS_iter*.md`, 12 `git_commands_iter*.txt`, `DELETIONS.{sh,txt}`, `DELETE_obsolete_files.sh`, `README.txt`, `scripts_flipper-backend-bridge.ts.DELETED`, `scripts/DELETE_flipper-backend-bridge.ts`, stale tracked `flipper-bridge.log` (692KB, already in `.gitignore`). No code references any of these.
- **KI-24** (closed iter 123): React Compiler `set-state-in-effect` rule migration — all 10 sites across 7 files resolved (iter 115–123). See recipes below for the patterns. Lint was 117 → 114.
- **KI-25** (closed iter 121): iter 119 i18n `useSyncExternalStore` refactor was documented but never applied. Re-done iter 121 from scratch.
- **KI-23** (closed iter 116): `react-hooks/rules-of-hooks` violation in `unique-table.tsx` — `useReactTable` called inside `.map()`. Fix: extracted `<CategoryGroupTable>` child component.
- **KI-22** (closed iter 112): ESLint v9 flat config missing. Fix: `eslint.config.mjs` with native flat-config exports. Downgraded 4 React Compiler rules to "warn".
- Older (KI-11/13/15/16-deep/18/19/20/21): see `git log` for one-line summaries.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **TD-3** | P3 | Triangular arbitrage no persistence — cannot backtest `executable_estimate`. Needs persistence-layer design. |
| **TD-4** | P3 | `market_spread` not persisted in HistoricalStore. Needs persistence-layer design. |
| **TD-5** | P3 | `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used. Needs persistence-layer design. |
| **TD-9** | P3 | FlipsTable "Trend" sparkline uses derived `momentum × volatility` — switch to real `priceHistoryShort` when backend adds it. |
| **P10** | P3 | Gold Map ROI (§C.8) — feature work, depends on P1 3-way flips (already done). |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `phase-hints-widget` jest test "renders current price" fails with `Expected: "115.50", Received: "116"` | **KI-21** (fixed iter 111) — `fmtPrice` rounded `>= 100` to integer. Fix already applied. | `src/components/dashboard/phase-hints-widget.tsx:fmtPrice` |
| All API calls return 404; dashboard empty | **KI-15** — `.env.local` has dead `api.poe2scout.com`. Use `POE2_API_BASE_URL=https://poe2scout.com/api` | `.env.local`, `start.bat`, `start.sh` |
| `next build` fails with "Unknown keyword or identifier. Did you mean 'delete'?" on a `DELETE_*.ts` file | **KI-19** (fixed iter 107) — historical `DELETE_*.ts` placeholder files all removed iter 107 + iter 124. `tsconfig.json` still excludes `**/DELETE_*` as defense-in-depth. | `tsconfig.json` |
| `GET /api/v1/prices/stream?threshold_pct=1` returns 400 | **KI-13** (fixed iter 107) — SSE router must be registered before prices router in `main.py` | `backend/main.py`, `backend/api/routes_sse.py` |
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
| `flipper-bridge.log` file no longer created | By design (iter 106, KI-16-deep) — redirect: `npm run start > flipper-bridge.log 2>&1`. (File removed from repo tracking iter 124 — it was a stale accidentally-committed runtime log; `.gitignore` entry kept.) | `src/lib/flipper-backend-bridge.ts` |
| `npx tsc --noEmit` or `npm run jest` OOM-killed on 4GB RAM | Known env limit since iter 99 — needs 8GB+ RAM. `jest --maxWorkers=1` helps. | environment |
| User's league selection lost on every reload | Fixed iter 122 — `use-realms-and-leagues.ts` persistence-model redesign (local `league` useState removed, Zustand `uiState.league` is single source of truth). | `src/hooks/use-realms-and-leagues.ts` |

---

## Key technical insights for future agents

**FastAPI route matching is ORDER-DEPENDENT.** A `{param:path}` converter is greedy and matches slashes — it will shadow any literal sub-path registered AFTER it. Always register literal-path routers BEFORE greedy-path routers. The KI-13 bug (SSE `/api/v1/prices/stream` shadowed by `/api/v1/prices/{pair:path}`) survived 6 iterations because the SSE router was registered after the prices router.

**Frontend price formatting convention.** `fmtPrice`-style helpers across the dashboard should keep 2 decimals for prices `>= 1` and 4 decimals for `< 1`. The KI-21 bug was caused by an "optimization" that rounded `>= 100` to integer — this silently broke the iter-110 live-price test and was only caught when jest was finally run. If you ever feel tempted to truncate large prices to integers, add a test first.

**ESLint v9 flat config (KI-22 closed iter 112).** `eslint-config-next` v16 ships native flat-config exports at `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` — no `FlatCompat` / `@eslint/eslintrc` wrapper needed. Just spread them into your `eslint.config.mjs`. The 4 new React Compiler rules (`set-state-in-effect`, `static-components`, `preserve-manual-memoization`, `refs`) default to "error" and will break lint on any existing codebase — downgrade to "warn" in the config and refactor incrementally.

### `react-hooks/set-state-in-effect` fix recipes (KI-24, all 10 sites resolved iter 115–123)

The rule fires when `setState` is called synchronously inside a `useEffect` body. Five safe strategies depending on the pattern:

**Recipe 1 — Derive during render** (iter 115, `use-price-stream.ts`). When the effect's only purpose is to mirror a prop into state — e.g. `setStatus("disconnected")` when `backendOnline === false` — replace the setState with a derived value in the return statement: `const effectiveStatus = backendOnline === false ? "disconnected" : status;`. Only works when the derived value is a pure function of props + existing state. Ref: https://react.dev/learn/you-might-not-need-an-effect

**Recipe 2 — `useSyncExternalStore` for external stores** (iter 116, `use-reduced-motion.ts`; iter 117, `header.tsx` "mounted" flag; iter 121, `i18n/index.tsx` locale + hydrated). When the effect subscribes to an external store (`window.matchMedia`, localStorage, etc.), rewrite with `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`. Eliminates the warning entirely because there's no `useEffect` + `setState` pattern. For the "mounted flag" special case: `const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false)`. For the "first-render = DEFAULT_VALUE" invariant: use a module-level `hasMounted` flag + first-call pattern in `subscribe` + `__resetForTesting()` export called in `jest.setup.ts` `beforeEach`. Canonical examples: `use-reduced-motion.ts`, `header.tsx`, `src/lib/i18n/index.tsx`.

**Recipe 3 — Adjust state during render with prev-value guard** (iter 118, `offline-banner.tsx`; iter 123, `dashboard-page.tsx` ×3). When the effect's purpose is to RESET a piece of state when a prop transitions (e.g. `setDismissed(false)` when `isOnline` goes from `true` → `false`), and there is NO callback consumer to defer into, use the React-recommended "adjust state during render" pattern. Recipe: (1) Add `const [prevProp, setPrevProp] = useState(prop)` initialized to the current prop value (so the first render does NOT trigger a reset — important for hydration safety). (2) During render, check `if (prop !== prevProp) { setPrevProp(prop); if (<reset-condition>) setOtherState(<reset-value>); }`. React explicitly supports calling `setState` during render as a special case — it re-renders immediately without committing the partial state, so there is no visual flash. The `set-state-in-effect` rule does NOT fire because the `setState` is NOT inside a `useEffect`. (3) Trace the transition semantics to verify equivalence. **When NOT to use this recipe:** if the state is FULLY determined by the prop (no user-action override), use Recipe 1 (derive during render) instead — no `prevProp` guard needed. Ref: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes

**Recipe 4 — Move setState into a `useCallback` via a "signal ref"** (iter 115, `use-price-stream.ts`). When the state genuinely needs to be reset on a prop transition but is NOT fully derivable, AND there's a callback consumer to defer into: add a `useRef<boolean>(false)` "signal" flag; set it to `true` in the effect (a ref write, not flagged by the rule); consume + reset it at the top of the callback BEFORE any early-return guards so the reset fires even if the callback is skipped. The callback is called synchronously from the same effect (`cbRef.current()`), so semantics are preserved. Canonical example: `use-price-stream.ts` `freshSessionRef`.

**Recipe 5 — Remove dead sync effect** (iter 120, `fuzzy-search.tsx`). When the effect's ONLY purpose is to mirror a prop into local state (`setLocalValue(prev => prev !== value ? value : prev)`), but the component is effectively UNCONTROLLED w.r.t. that prop after mount (the prop is used only as the initial value via `useState(value)`), AND every external update to the prop is ALREADY accompanied by a synchronous local-state update from the same call site (so the guard `prev !== value` is always false and the effect is dead code), the canonical fix is to **remove the effect entirely**. Verify by grepping for all `setX(` call sites for the parent's state that feeds the prop — confirm every external reset is triggered FROM a handler that ALSO synchronously sets the local state. Add a module-level comment documenting the uncontrolled-with-initial-value contract. Canonical example: `fuzzy-search.tsx`.

**Recipe 6 — Persistence-model redesign: eliminate local state, use Zustand store as single source of truth + normalize effect** (iter 122, `use-realms-and-leagues.ts`). When the effect's purpose is to (a) auto-select a default value when an async list arrives AND (b) persist that selection to an external store (Zustand), but the local `useState` is initialized to a sentinel (`""`) instead of the persisted value — causing every reload to overwrite the user's persisted selection with the auto-detected default (a LATENT PERSISTENCE BUG) — the canonical fix is to **eliminate the local state entirely** and read the value directly from the store. Recipe: (1) Replace `const [x, setXLocal] = useState("")` with `const x = useDashboardStore((s) => s.uiState.x)` — select just the primitive (not the whole `uiState` object) to avoid re-renders. (2) The setter wrapper now ONLY calls the store action. (3) **Remove the auto-select effect entirely** — the existing `effectiveX` memo (which derives "user selection > active > first") already handles the fallback WITHOUT an effect. (4) **Add a "normalize" effect** that syncs `effectiveX` back into the store when the persisted value is invalid: `useEffect(() => { if (!list || !list.length === 0) return; if (!effectiveX) return; const isValid = !!persisted && list.some(item => item.name === persisted); if (!isValid && effectiveX !== persisted) { persistToStore(effectiveX); } }, [list, effectiveX, persisted, persistToStore])`. **Key insight:** this effect calls the ZUSTAND store action, NOT React's `setState`. The `set-state-in-effect` rule fires on `useState`/`useReducer` dispatchers, NOT on Zustand's `set` (an external store mutation). Verified: `dashboard-page.tsx:382` calls `setBaseCurrency` (Zustand) in an effect WITHOUT triggering the rule. (5) **Guard against infinite loops:** the condition `effectiveX !== persisted` is false once the normalize runs, so no further calls. (6) **Test isolation:** reset the Zustand store in `beforeEach` via `useDashboardStore.setState({...})`, then seed localStorage and call `rehydrate()`. **Canonical example:** `src/hooks/use-realms-and-leagues.ts`. **When NOT to use this recipe:** if the value does NOT need to persist across reloads (pure session state), keep the local `useState` and use Recipe 1/3 instead.

**Recipe 7 — Split effect: Zustand mutation stays, React setState moves to "adjust during render"** (iter 123, `dashboard-page.tsx:387`). When a single `useEffect` calls BOTH a Zustand action AND a React `setState` (and the rule fires only on the React `setState`), the canonical fix is to **split the effect**: (a) keep the Zustand mutation in the `useEffect` (the rule does NOT fire on Zustand `set` — see Recipe 6 insight), and (b) move the React `setState` to a separate "adjust state during render" block (Recipe 3) keyed on the same trigger. Extract the shared condition into a `useCallback` so both halves stay in sync. **Canonical example:** `dashboard-page.tsx` — the league-change effect at line 387 was split into `shouldResetForNewLeague` (useCallback) + render-time `setReferenceCurrency("")` + effect-time `setBaseCurrency(...)`. **Why this is safe:** the primary trigger (`effectiveLeague` transition) fires both halves together; the secondary triggers (`leagues`/`referenceCurrencies`/`safeBaseCurrencyApiId` arriving async) only matter for the Zustand half (re-validates the user's selection), and the local `referenceCurrency` is reset once on the transition and stays at `""` until the user picks a new currency.

### `react-hooks/exhaustive-deps` stable-identity recipe (iter 124, TD-10)

When the rule flags a `useMemo`/`useCallback` deps array because a function inside the component changes identity every render, the canonical fix has two halves: (1) **Move constants to module level** — arrays/objects literals like `TAB_MAP` defined inside the component get a new identity every render, polluting every deps array that references them. Move them outside the component (top of file). (2) **Wrap event-handler wrappers in `useCallback`** — a wrapper like `const setTab = (t) => { setLocal(t); setStore(t); }` recreated every render invalidates every downstream memo. Wrap in `useCallback` with the underlying stable setters as deps. Both fixes were applied to `dashboard-page.tsx` iter 124 to close the `keyboardActions` useMemo exhaustive-deps warning without resorting to `eslint-disable`.

### `react-hooks/preserve-manual-memoization` evaluation recipe (iter 116)

The rule fires when the React Compiler cannot preserve a manual `useMemo` — typically because the compiler's inferred deps are broader than the source's `deps` array. The recipe: (1) Check if React Compiler is enabled in `next.config.ts`. If NOT enabled, removing `useMemo` is a PERFORMANCE REGRESSION. (2) Check if the memoized value is consumed in any `useEffect`/`useMemo` deps array. If NOT, removing `useMemo` is correctness-safe (just slower). (3) If compiler not enabled AND the narrow deps are intentional, KEEP the `useMemo` and add an inline `eslint-disable-next-line react-hooks/preserve-manual-memoization` with a comment explaining the rationale + when to revisit. Canonical example: `speculation-tab.tsx:332` `flipsByApiId` (narrow dep `[flipsData?.opportunities]` leverages TanStack Query structural sharing).

### `react-hooks/rules-of-hooks` extraction recipe (iter 116, KI-23)

When a hook is called inside a `.map()` callback (or any non-top-level position), the fix is to extract a child component that calls the hook at its top level. Recipe: (1) Define a `<Child>` component + props interface that accepts every value the closure was capturing. (2) Move the hook call to the top of the child. (3) Replace the `.map()` callback with `<Child key={...} {...props} />`. (4) Pass derived booleans (e.g. `isCollapsed={set.has(name)}`) rather than the whole Set — keeps the child pure. (5) Bind event handlers at the parent so the child stays generic. Canonical example: `unique-table.tsx` `<CategoryGroupTable>`.
