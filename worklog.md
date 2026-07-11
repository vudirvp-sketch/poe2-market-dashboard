# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

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

---

Task ID: iter-117
Agent: main
Task: iter 117 — incremental KI-24 fix: eliminate the 1 `react-hooks/set-state-in-effect` warning in `header.tsx` (the `mounted` flag effect). Strategy: replace `useState(false) + useEffect(() => setMounted(true), [])` with `useSyncExternalStore(subscribeMounted, getMountedSnapshot, getMountedServerSnapshot)` — the canonical "is client post-hydration" pattern. Added 1 defensive jest test for theme-toggle visibility (gated by `mounted`). Lint 123 → 122, 0 errors. 619 jest green (was 618), tsc green.

Work Log:
- Cloned repo. Read STATUS.md (KI-24 open with 8 sites / 1 rule after iter 116), worklog.md (iter 115 + iter 116), next.config.ts (React Compiler NOT enabled — confirmed), and all 5 iter-117 candidate files: `use-realms-and-leagues.ts`, `i18n/index.tsx`, `header.tsx`, `offline-banner.tsx`, `fuzzy-search.tsx`.
- **Risk analysis of all 6 remaining candidates** (per "Лучше недоделать, чем сломать"):
  - `header.tsx:189` — `setMounted(true)` on mount. **LOWEST RISK.** Pure SSR-safety flag, only consumer is the theme-toggle button gate (line ~516). Mechanical 3-line replacement with `useSyncExternalStore`. No semantic change.
  - `use-realms-and-leagues.ts:147` — `setLeague(autoLeague)` in auto-select effect. **HIGH RISK.** NOT a `useSyncExternalStore` candidate (despite iter-116 stopping-point speculation). The effect's purpose is to PERSIST the auto-detected league to the Zustand store (via `setLeague` → `persistLeague`). Removing the effect would break cross-session persistence of the auto-selected league. Needs a persistence-model redesign, not a mechanical fix.
  - `i18n/index.tsx:128` — 2 setState in one effect (`setLocaleState(stored)` + `setHydrated(true)`). **MEDIUM RISK.** `useSyncExternalStore` for locale requires a custom same-tab notification mechanism (the `storage` event only fires in other tabs). Also need a separate `useSyncExternalStore` for the `hydrated` flag. 28 existing tests must continue to pass.
  - `offline-banner.tsx:16` — 2 setState (`setWasOffline(true)` + `setDismissed(false)`). **MEDIUM RISK.** `wasOffline` is dead state (set but never read — candidate for cleanup). `setDismissed(false)` is a legitimate state reset on prop transition — signal-ref pattern (iter 115 recipe) applies, but adds complexity (ref + callback + effect vs original 3-line effect).
  - `fuzzy-search.tsx:88` — `setLocalValue` sync prop → local state. **MEDIUM RISK.** Proper fix is to make the component fully controlled (remove `localValue`, use `value` prop directly), but this affects debounce UX and touches `handleInput`/`handleClear`/`handleResultClick`.
  - `dashboard-page.tsx` — 3 sites. **HIGHEST RISK.** Explicitly deferred to a dedicated iter.
- **Selected iter 117 scope = `header.tsx` only.** Per "Лучше недоделать, чем сломать": chose the single lowest-risk candidate. A clean, mechanical, well-tested fix is better than a risky multi-file iter. Deferred all other candidates to iter 118+ with documented risk analysis.
- **Confirmed baseline.** `npm install` → packages installed silently. `npx tsc --noEmit` → exit 0. `npx eslint .` → 123 warnings, 0 errors (matches iter-116 baseline). Per-file lint on target: `header.tsx` had 3 warnings — `set-state-in-effect` at line 189 (`setMounted(true)`), `tp` unused var, `LOCALE_ORDER` missing dep. Only the first is in scope (KI-24). `npx jest --maxWorkers=1` → 618 passed, 27 suites, exit 0.
- **Read iter-116 canonical example** (`use-reduced-motion.ts`) to follow the same `useSyncExternalStore` pattern. The header.tsx case is simpler — no external store to subscribe to, so `subscribe` is a no-op.
- **Applied fix to `header.tsx`:**
  1. Added `useSyncExternalStore` to the React imports (line 11).
  2. Added 3 module-level helper functions after `phaseLabel` (before the `Header` component): `subscribeMounted()` (no-op, returns empty cleanup), `getMountedSnapshot()` (returns `true`), `getMountedServerSnapshot()` (returns `false`). Each has a JSDoc comment block explaining the pattern, the SSR/first-render/post-hydration semantics, and the rationale (gates the theme-toggle button to avoid next-themes SSR mismatch).
  3. Replaced `const [mounted, setMounted] = useState(false); useEffect(() => { setMounted(true); }, []);` with `const mounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getMountedServerSnapshot);` (with an inline comment referencing the module-level helpers).
  4. `useEffect` import retained — 2 other effects still use it (lines 210, 233). `useState` import retained — `timeAgo` and `moreOpen` still use it.
- **Added defensive test** to `src/__tests__/header-i18n.test.tsx`: new describe block "theme toggle (mounted flag via useSyncExternalStore — KI-24 iter 117)" with 1 test that renders the Header, opens the "More" menu, and verifies the theme-toggle button is visible via `findByLabelText(/Переключить на (тёмную|светлую) тему/)`. The regex matches both `switchToDarkMode` and `switchToLightMode` because the test environment's `useTheme()` (next-themes without ThemeProvider wrapper) returns `theme: "dark"`, so the button shows the "switch to light" label — the test only cares that the button is rendered, which requires `mounted = true`. Initial attempt used the exact string `"Переключить на тёмную тему"` (switchToDarkMode) — failed because the test env returns `theme = "dark"`, making the button show `switchToLightMode`. Fixed with a regex matching both.
- **Verification:**
  - `npx tsc --noEmit` → **exit 0** ✅
  - `npx eslint src/components/dashboard/header.tsx` → **2 warnings, 0 errors** ✅ (was 3). The `set-state-in-effect` warning is GONE. The remaining 2 warnings (`tp` unused, `LOCALE_ORDER` missing dep) are pre-existing and out of scope (not KI-24).
  - `npx eslint .` → **0 errors, 122 warnings, exit 0** ✅ (was 123 → 122 = 1 warning removed).
  - `npx jest --maxWorkers=1` → **619 passed, 0 failed, 27 suites, exit 0** ✅ (was 618 + 1 new test = 619).
  - `pytest` not run (no backend changes) — 1279 passed expected per iter 113.
  - `next build` not run (4GB RAM env constraint) — the change is a mechanical replacement of a well-understood pattern (`useState+useEffect` → `useSyncExternalStore`) with full test coverage. No plausible build-regression failure mode.
- **Documentation updates:**
  - `STATUS.md`: bumped "Last updated" header (iter 117). Updated KI-24 table — `header.tsx` removed from sites list, count 8 → 7. Added new bullet to "Closed sub-rules (history)" documenting iter-117 fix. Updated backlog row: "7 React Compiler rule sites remaining (was 25 — ... `set-state-in-effect` 3 of 10 resolved iter 115+116+117 ...)". Added new "Key technical insights" paragraph: "`react-hooks/set-state-in-effect` fix for \"mounted\" flag via `useSyncExternalStore` (iter 117)" — documents the no-op `subscribe` special case for the SSR-safety `mounted` pattern.
  - `worklog.md` (this entry) — trimmed iter 115 (oldest, now in git log), now shows iter 116 + iter 117 (last 2 iterations per header convention).
  - `AGENT_NAVIGATION.md` — header bump only.

Stage Summary:
- **iter 117 SHIPPED — KI-24 `set-state-in-effect` 1 of 10 sites resolved (`header.tsx` `mounted` flag).** Lint warnings: 123 → 122 (0 errors). `tsc` green. 619 jest green (was 618). 1279 pytest expected green (no backend changes).
- **Modified files (3):** `src/components/dashboard/header.tsx`, `src/__tests__/header-i18n.test.tsx`, `STATUS.md`. Plus `worklog.md` (this entry) + `AGENT_NAVIGATION.md` (header bump).
- **What was NOT done (intentionally deferred to iter 118+):**
  - KI-24 remaining 7 `set-state-in-effect` sites: `dashboard-page.tsx` (3), `fuzzy-search.tsx` (1), `offline-banner.tsx` (1), `use-realms-and-leagues.ts` (1), `i18n/index.tsx` (1). Each needs case-by-case evaluation — see risk analysis above.
  - TD-3/4/5/9 persistence gaps (need persistence-layer design).
  - P10 Gold Map ROI (§C.8) — feature work, depends on P1 3-way flips (already done).
- **Stopping point:** iter 117 = KI-24 advanced by 1 site (8 → 7). KI-24 backlog now 7 sites / 1 rule. Next iter (iter 118) candidates in approximate risk order: (a) `offline-banner.tsx` (1 site, signal-ref pattern — also has dead `wasOffline` state to clean up); (b) `i18n/index.tsx` (1 site, `useSyncExternalStore` for locale + `hydrated` flag — needs custom same-tab notification); (c) `fuzzy-search.tsx` (1 site, controlled-component refactor — affects debounce UX); (d) `use-realms-and-leagues.ts` (1 site, needs persistence-model redesign — NOT a mechanical fix); (e) `dashboard-page.tsx` (3 sites, largest refactor — dedicated iter); (f) TD-3/4/5/9 persistence gaps; (g) P10 Gold Map ROI (§C.8).
