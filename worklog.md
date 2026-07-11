# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-120
Agent: main
Task: iter 120 — incremental KI-24 fix: eliminate the 1 `react-hooks/set-state-in-effect` warning in `fuzzy-search.tsx:88` (sync prop → local state). Strategy: REMOVE the dead sync effect entirely (`useEffect(() => setLocalValue(prev => prev !== value ? value : prev), [value])`) — the component is uncontrolled w.r.t. the `value` prop after mount, and the only external reset (`setSearch("")` at `dashboard-page.tsx:799`) is triggered FROM `handleResultClick` AFTER `setLocalValue("")` runs synchronously, so the guard was always false. Zero behavior change. ALSO: discovered + documented KI-25 — iter 119 was described in a previous STATUS.md version but the code changes (i18n `useSyncExternalStore` refactor + `__resetI18nForTesting`) were NEVER applied to the repo.

Work Log:
- Cloned repo. Read STATUS.md (claimed iter 119 shipped — 5 sites remaining), worklog.md (iter 117 + iter 118), next.config.ts (React Compiler NOT enabled — confirmed), `fuzzy-search.tsx` (target), `header.tsx` (parent — lines 239-243 confirm "No need to sync external search changes"), `dashboard-page.tsx` (lines 792-800 — `onSearchResultSelect` calls `setSearch("")`).
- **CRITICAL DISCOVERY — KI-25 (iter 119 doc/code mismatch).** STATUS.md header claimed iter 119 shipped (i18n `useSyncExternalStore` refactor + `__resetI18nForTesting` export + `jest.setup.ts` `beforeEach` reset). Verified the repo does NOT contain these changes: (a) `src/lib/i18n/index.tsx:128` still uses `setLocaleState(stored)` inside `useEffect` — the `set-state-in-effect` warning is still emitted; (b) `__resetI18nForTesting` does NOT exist anywhere in the codebase (grep returns 0 matches outside STATUS.md); (c) `jest.setup.ts` has no i18n reset; (d) `git log` latest commit is `b6790c1 iter 118` — no iter-119 commit; (e) baseline lint count is 120 (iter-118 state), NOT 119 as STATUS.md claimed. Hypothesis: the iter-119 archive was produced in a previous chat session and the STATUS.md was updated, but the actual code changes were lost or never merged by the user. Documented as KI-25 in STATUS.md before proceeding with the fuzzy-search fix.
- **Confirmed baseline.** `npm install` → packages installed. `npx tsc --noEmit` → exit 0. `npx eslint .` → 120 warnings, 0 errors (NOT 119 as STATUS.md claimed — confirms KI-25). Per-file lint on target: `fuzzy-search.tsx` had 3 warnings — `set-state-in-effect` (line 88), `activeTab` unused, `<img>` element. Only the first is in scope (KI-24). `npx jest --maxWorkers=1` → 619 passed, 27 suites, exit 0.
- **Recipe selection — why NOT "fully controlled" (candidate description).** The user's iter-120 brief and the iter-117/iter-118 worklog suggested "make fully controlled (remove localValue, use value prop directly)". After analysis, fully controlled is the WRONG fix: `localValue` is the user's input buffer with a 200ms debounce before reporting to the parent via `onValueChange`. Making it fully controlled would require calling `onValueChange` on every keystroke (losing the debounce) OR showing stale input (the input would lag 200ms behind typing). Both regress UX. The component's debounce exists precisely to avoid re-running `useFilteredExchangePairs` + React Query refetches on every keystroke.
- **Recipe selection — why "remove dead sync effect" (iter 120 new recipe).** The sync effect `useEffect(() => setLocalValue(prev => prev !== value ? value : prev), [value])` was DEAD CODE: (1) The parent (`header.tsx:239-243`) explicitly says "No need to sync external search changes — FuzzySearch manages its own state". (2) The only external `setSearch` call is `setSearch("")` at `dashboard-page.tsx:799`, which is triggered FROM `handleResultClick` (line 178) AFTER `setLocalValue("")` runs synchronously — both batched in the same event handler, so by the time the effect runs, `localValue === ""` and `value === ""`, and the guard `prev !== value` is `false`. (3) Grep confirmed no other `setSearch(` call sites. Removing the effect is a zero-behavior-change fix that eliminates the warning. Documented as a NEW recipe (iter 120) in STATUS.md → Key technical insights.
- **Applied fix to `fuzzy-search.tsx`:**
  1. Added a 17-line module-level NOTE comment above the React import, explaining: the uncontrolled-with-initial-value contract, the parent's confirmation, the trace of why the sync is unnecessary (handleResultClick's synchronous setLocalValue("") + parent's setSearch("")), and guidance for future features that might need external sync (use iter 118's "adjust state during render" recipe, not an effect).
  2. Removed the `useEffect(() => { setLocalValue((prev) => (prev !== value ? value : prev)); }, [value]);` block (was lines 86-89).
  3. Added an inline comment above `useState(value)`: "`value` is the initial value only — see the module-level NOTE (iter 120). No sync effect: the component is uncontrolled w.r.t. `value` after mount."
  4. Updated the `value` prop JSDoc from "Current search value (controlled from parent)" to "Initial search value (used on first render only — see iter 120 NOTE above)."
  5. Kept `useEffect` import — 2 other effects still use it (outside-click handler line 244, debounce cleanup line 259). Kept `useState` import — `localValue`, `isOpen`, `selectedIndex` still use it.
- **Verification:**
  - `npx tsc --noEmit` → **exit 0** ✅
  - `npx eslint src/components/dashboard/fuzzy-search.tsx` → **2 warnings, 0 errors** ✅ (was 3). The `set-state-in-effect` warning is GONE. The remaining 2 warnings (`activeTab` unused, `<img>` element) are pre-existing and out of scope (not KI-24).
  - `npx eslint .` → **0 errors, 119 warnings, exit 0** ✅ (was 120 → 119 = 1 warning removed).
  - `npx jest --maxWorkers=1` → **619 passed, 0 failed, 27 suites, exit 0** ✅ (unchanged — no new tests added because the component had no direct tests; the fix preserves all documented behavior).
  - `pytest` not run (no backend changes) — 1279 passed expected per iter 113.
  - `next build` not run (4GB RAM env constraint) — the change is a removal of a dead effect with a 17-line explanatory comment. No plausible build-regression failure mode.
- **Documentation updates:**
  - `STATUS.md`: rewrote the header (corrected the false iter-119 claim, documented iter 120). Added KI-25 (iter 119 doc/code mismatch) as a new open Known Issue with full diagnosis + fix plan. Updated KI-24 table — `fuzzy-search.tsx` removed from sites list, `i18n/index.tsx` RE-ADDED (was incorrectly listed as resolved), count 5 → 5 (1 removed, 1 re-added). Updated "Closed sub-rules" history — iter 120 (`fuzzy-search.tsx`) added, iter 119 (`i18n/index.tsx`) REMOVED (not actually applied). Updated backlog row KI-24: "5 of 10 resolved iter 115+116+117+118+120". Added KI-25 row to backlog (P2). Added new "Key technical insights" paragraph: "iter 120 — remove dead sync effect" recipe. Marked the iter-119 recipe as "PLANNED, NOT YET APPLIED, see KI-25" to preserve the design for the next agent.
  - `worklog.md` (this entry) — trimmed iter 117 (oldest, now in git log), now shows iter 118 + iter 120 (last 2 iterations per header convention).
  - `AGENT_NAVIGATION.md` — header bump only.

Stage Summary:
- **iter 120 SHIPPED — KI-24 `set-state-in-effect` 1 of 10 sites resolved (`fuzzy-search.tsx` dead sync effect removed).** Lint warnings: 120 → 119 (0 errors). `tsc` green. 619 jest green. 1279 pytest expected green (no backend changes).
- **CRITICAL for next agent — KI-25 discovered.** iter 119 (i18n `useSyncExternalStore` refactor) was documented in STATUS.md but NEVER applied to the repo. The i18n `set-state-in-effect` warning is still live. KI-24 progress is 1 site behind what the previous STATUS.md claimed. Next agent must RE-DO iter 119 before proceeding.
- **Modified files (4):** `src/components/dashboard/fuzzy-search.tsx`, `STATUS.md`, `worklog.md` (this entry), `AGENT_NAVIGATION.md` (header bump).
- **What was NOT done (intentionally deferred to iter 121+):**
  - **RE-DO iter 119 (HIGHEST PRIORITY — KI-25):** apply `useSyncExternalStore` refactor to `src/lib/i18n/index.tsx` for both `locale` and `hydrated`. Recipe preserved in STATUS.md (marked "PLANNED, NOT YET APPLIED"). Verify 28 i18n tests pass, lint drops 119 → 118.
  - KI-24 remaining 4 `set-state-in-effect` sites AFTER iter-119-redo: `dashboard-page.tsx` (3), `use-realms-and-leagues.ts` (1).
  - `use-realms-and-leagues.ts` (1 site, HIGH RISK — effect's purpose is to PERSIST auto-detected league to Zustand store; needs persistence-model redesign, NOT a mechanical fix).
  - `dashboard-page.tsx` (3 sites, largest refactor — dedicated iter).
  - TD-3/4/5/9 persistence gaps (need persistence-layer design).
  - P10 Gold Map ROI (§C.8) — feature work, depends on P1 3-way flips (already done).
- **Stopping point:** iter 120 = KI-24 advanced by 1 site (120 → 119 lint). KI-24 backlog now 5 sites / 1 rule (but 1 of those 5 — `i18n/index.tsx` — is a RE-DO of the lost iter 119; see KI-25). Next iter (iter 121) candidates in approximate risk order: (a) **RE-DO iter 119 — i18n `useSyncExternalStore` refactor** (KI-25, MEDIUM risk, 28 existing tests must pass, recipe already documented); (b) `use-realms-and-leagues.ts` (1 site, HIGH RISK — needs persistence-model redesign); (c) `dashboard-page.tsx` (3 sites, largest refactor — dedicated iter); (d) TD-3/4/5/9 persistence gaps; (e) P10 Gold Map ROI (§C.8).

---

Task ID: iter-118
Agent: main
Task: iter 118 — incremental KI-24 fix: eliminate the 1 `react-hooks/set-state-in-effect` warning in `offline-banner.tsx`. Strategy: replace `useEffect(() => { if (!isOnline) { setWasOffline(true); setDismissed(false); } }, [isOnline])` with the React-canonical "adjust state during render" pattern (previous-value guard). Also removed dead `wasOffline` state (set but never read). Lint 122 → 120, 0 errors. 619 jest green, tsc green.

Work Log:
- Cloned repo. Read STATUS.md (KI-24 open with 7 sites / 1 rule after iter 117), worklog.md (iter 116 + iter 117), next.config.ts (React Compiler NOT enabled — confirmed), `offline-banner.tsx` (target), `use-price-stream.ts` (iter-115 signal-ref canonical example), `header.tsx` lines 155-229 (iter-117 `useSyncExternalStore` canonical example), `use-online-status.ts` (source of `isOnline` prop), `dashboard-dialogs.tsx` (only consumer of `OfflineBanner`).
- **Recipe selection — why NOT signal-ref (iter 115 recipe).** The user's stopping-point hint suggested "signal-ref pattern (iter 115 recipe)". After analysis, signal-ref does NOT fit this case: signal-ref requires a `useCallback` consumer that is called synchronously from the SAME effect that sets the ref (e.g. `connect()` in `use-price-stream.ts`). `offline-banner.tsx` has NO callback consumer — `dismissed` is consumed ONLY in the render path (to derive `showBanner`). The canonical React pattern for "reset state when a prop changes" with no callback consumer is "adjust state during render with a previous-value guard" (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes). Documented as a NEW recipe (iter 118) in STATUS.md → Key technical insights.
- **Dead-state cleanup.** `wasOffline` was set inside the effect (`setWasOffline(true)`) but NEVER read anywhere in the codebase (verified via grep `wasOffline` across `src/` — only 2 matches, both in `offline-banner.tsx` itself: the `useState` declaration and the `setWasOffline(true)` call). Removed in the same commit per the new recipe's "dead-state cleanup opportunity" note.
- **Confirmed baseline.** `npm install` → 816 packages in 15s. `npx tsc --noEmit` → exit 0. `npx eslint .` → 122 warnings, 0 errors (matches iter-117 baseline). Per-file lint on target: `offline-banner.tsx` had 2 warnings — `wasOffline` unused var (line 12) + `set-state-in-effect` (line 16). `npx jest` → 619 passed, 27 suites, exit 0.
- **Confirmed no direct tests for `OfflineBanner`.** Grep `OfflineBanner|offline-banner` across `src/__tests__/` → 0 matches. The component is rendered by `dashboard-dialogs.tsx` but not unit-tested. `integration.test.tsx` mentions "offline" but only in the context of `FlipperApiError` error types (unrelated).
- **Applied fix to `offline-banner.tsx`:**
  1. Removed `useEffect` from the React import (kept `useState` — still needed for `dismissed` and the new `prevIsOnline`).
  2. Removed the `const [wasOffline, setWasOffline] = useState(false);` line (dead state).
  3. Removed the entire `useEffect(() => { if (!isOnline) { setWasOffline(true); setDismissed(false); } }, [isOnline]);` block.
  4. Added `const [prevIsOnline, setPrevIsOnline] = useState(isOnline);` (initialized to current `isOnline` so the first render does NOT trigger a reset — important for hydration safety).
  5. Added the render-time adjustment block: `if (isOnline !== prevIsOnline) { setPrevIsOnline(isOnline); if (!isOnline) { setDismissed(false); } }`.
  6. Added a 30-line comment block explaining: the previous implementation, the two issues (dead state + set-state-in-effect), the recipe choice rationale (why not signal-ref), the React-canonical pattern reference URL, and the 4-case transition-semantics trace (online→offline, dismiss, offline→online, online→offline again).
- **Hydration safety trace.** `useOnlineStatus` initializes `isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true`. On server: `navigator` undefined → `isOnline = true`. On client first render (hydration): `navigator.onLine` is typically `true` → `isOnline = true`. `prevIsOnline` is initialized to `isOnline`, so `isOnline === prevIsOnline` on the first render → no setState fires → no hydration mismatch. If the client is offline at hydration time, the mismatch is pre-existing (the current code also derives `showBanner` from `isOnline` which differs server vs client) — NOT introduced by this fix.
- **Verification:**
  - `npx tsc --noEmit` → **exit 0** ✅
  - `npx eslint src/components/dashboard/offline-banner.tsx` → **0 warnings, 0 errors** ✅ (was 2 warnings — both eliminated).
  - `npx eslint .` → **0 errors, 120 warnings, exit 0** ✅ (was 122 → 120 = 2 warnings removed).
  - `npx jest` → **619 passed, 0 failed, 27 suites, exit 0** ✅ (unchanged — no new tests added because the component had no direct tests; the fix preserves the documented transition semantics).
  - `pytest` not run (no backend changes) — 1279 passed expected per iter 113.
  - `next build` not run (4GB RAM env constraint) — the change is a mechanical replacement of a well-understood pattern (`useEffect+setState` → "adjust state during render") with no new dependencies. No plausible build-regression failure mode.
- **Documentation updates:**
  - `STATUS.md`: bumped "Last updated" header (iter 118). Updated KI-24 table — `offline-banner.tsx` removed from sites list, count 7 → 6. Added new bullet to "Closed sub-rules (history)" documenting iter-118 fix. Updated backlog row: "6 React Compiler rule sites remaining (was 25 — ... `set-state-in-effect` 4 of 10 resolved iter 115+116+117+118 ...)". Added new "Key technical insights" paragraph: "`react-hooks/set-state-in-effect` fix via \"adjust state during render\" (iter 118)" — documents the previous-value guard pattern, when to use it vs signal-ref (iter 115) vs derive-during-render (iter 115 recipe 1), and the dead-state cleanup opportunity.
  - `worklog.md` (this entry) — trimmed iter 116 (oldest, now in git log), now shows iter 117 + iter 118 (last 2 iterations per header convention).

Stage Summary:
- **iter 118 SHIPPED — KI-24 `set-state-in-effect` 1 of 10 sites resolved (`offline-banner.tsx` `dismissed` reset).** Lint warnings: 122 → 120 (0 errors). `tsc` green. 619 jest green. 1279 pytest expected green (no backend changes).
- **Modified files (3):** `src/components/dashboard/offline-banner.tsx`, `STATUS.md`, `worklog.md` (this entry).
- **What was NOT done (intentionally deferred to iter 119+):**
  - KI-24 remaining 6 `set-state-in-effect` sites: `dashboard-page.tsx` (3), `fuzzy-search.tsx` (1), `use-realms-and-leagues.ts` (1), `i18n/index.tsx` (1). Each needs case-by-case evaluation — see risk analysis in the user's iter-117 stopping point.
  - TD-3/4/5/9 persistence gaps (need persistence-layer design).
  - P10 Gold Map ROI (§C.8) — feature work, depends on P1 3-way flips (already done).
- **Stopping point:** iter 118 = KI-24 advanced by 1 site (7 → 6). KI-24 backlog now 6 sites / 1 rule. Next iter (iter 119) candidates in approximate risk order: (a) `i18n/index.tsx` (1 site, `useSyncExternalStore` for locale + `hydrated` flag — needs custom same-tab notification because `storage` event only fires in other tabs; 28 existing tests must pass); (b) `fuzzy-search.tsx` (1 site, controlled-component refactor — affects debounce UX and `handleInput`/`handleClear`/`handleResultClick`); (c) `use-realms-and-leagues.ts` (1 site, HIGH RISK — effect's purpose is to PERSIST auto-detected league to Zustand store; needs persistence-model redesign, NOT a mechanical fix); (d) `dashboard-page.tsx` (3 sites, largest refactor — dedicated iter); (e) TD-3/4/5/9 persistence gaps; (f) P10 Gold Map ROI (§C.8).
