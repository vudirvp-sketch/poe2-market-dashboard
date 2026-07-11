# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-115
Agent: main
Task: iter 115 — incremental KI-24 fix: eliminate the 1 `react-hooks/set-state-in-effect` warning in `use-price-stream.ts` (the `backendOnline` transitions effect). Strategy: (a) derive `status`/`lastError` from `backendOnline` in the return statement; (b) move `setReconnectCount(0)` + `setLastError(null)` out of the effect into `connect()` via a `freshSessionRef` latest-ref pattern. Lint 126 → 125, 0 errors. No backend/test changes.

Work Log:
- Cloned repo. Read STATUS.md (KI-23 open, KI-24 open with 11 sites / 2 rules after iter 114, KI-20 open), worklog.md (iter 113 + iter 114), package.json, `use-price-stream.ts` (full 399-line file).
- **Selected iter 115 scope = KI-24 `set-state-in-effect` — `use-price-stream.ts`.** Per "Лучше недоделать, чем сломать": chose the smallest-scope candidate from the iter-114 stopping-point list. Same file already in context from iter 114 (the agent that did iter 114 touched the same file and explicitly noted "use-price-stream.ts:362 is a natural next target"). Single warning site. Other candidates (KI-23 ~120-line refactor, KI-20 regex change with full regression, KI-24 `preserve-manual-memoization` in a different file, TD-3/4/5/9 persistence, P10 Gold Map ROI feature) all carry higher risk or need their own dedicated iter.
- **Confirmed baseline.** `npm install` → packages installed silently. `npx eslint .` → 126 warnings, 0 errors (matches iter-114 baseline). Per-file lint on the target: `use-price-stream.ts` had 1 warning — `react-hooks/set-state-in-effect` at line 386 (`setStatus("disconnected")` inside the `backendOnline` transitions effect). Note: the warning site migrated from line 362 (iter 114 worklog) to line 386 because the iter-114 fix added ~15 lines (the `connectRef` sync-effect) before this effect. `npx tsc --noEmit` → exit 0. `npx jest --maxWorkers=1` → 582 passed, 25 suites, exit 0.
- **Read the full target file & analyzed the transitions effect.** The `backendOnline` transitions effect (lines 375-395 pre-fix) had 3 setState calls:
  - Offline branch: `setStatus("disconnected")` (line 386, flagged) + `setLastError(null)` (line 387) — clear stale status/error so UI shows "disconnected" / no-error while backend is offline.
  - Online branch: `setReconnectCount(0)` (line 390) — reset the reconnect counter for the new session, so the user doesn't see stale counts from the previous session.
  - The rule fires on the FIRST setState in an effect (line 386). Removing only that line would cause the rule to fire on line 387, then line 390. To fully eliminate the warning, ALL setState calls must be removed from the effect.
- **Safety analysis (semantics preservation):**
  - `status` and `lastError` are FULLY DETERMINED by `backendOnline` when offline — when `backendOnline === false`, the UI must show "disconnected" with no error regardless of internal state. This is a pure derivation: `backendOnline === false ? "disconnected" : status`. The internal state is no longer mutated by the effect, but the rendered output is identical. This is the React-recommended pattern (https://react.dev/learn/you-might-not-need-an-effect).
  - `setReconnectCount(0)` (online branch) is NOT fully derivable — `reconnectCount` is genuine state that accumulates over time (incremented in `es.onerror`'s reconnect callback). It needs to be RESET once per backend-online transition. Strategy: move the reset into `connect()` (a `useCallback`, not an effect — the rule doesn't trace setState through useCallback boundaries, confirmed by the existing `setStatus("connecting")` at line 226 not firing the rule) via a `freshSessionRef` "signal ref" pattern.
- **Applied fix:**
  1. Added `const freshSessionRef = useRef(false);` near the other refs (after `thresholdRef`), with explanatory comment block citing the rule, the rationale, and the pattern.
  2. At the top of `connect()` (before any early-return guards), added a `freshSessionRef` consumption block: `if (freshSessionRef.current) { setReconnectCount(0); setLastError(null); reconnectCountRef.current = 0; freshSessionRef.current = false; }`. Placed BEFORE guards so the reset fires even if `connect` is skipped this tick (e.g. `enabled` is false) — the next `connect()` call won't re-reset (guard is already consumed), but `reconnectCount` is already 0 from the earlier call.
  3. In the `backendOnline` transitions effect: offline branch reduced to `cleanup()` only (removed `setStatus("disconnected")` + `setLastError(null)` — now derived in return); online branch reduced to `freshSessionRef.current = true; everConnectedRef.current = false; connectRef.current();` (removed `setReconnectCount(0)` + `reconnectCountRef.current = 0` — now handled by `connect()` consuming `freshSessionRef`).
  4. Replaced `return { status, lastError, reconnectCount };` with derivation: `const effectiveStatus = backendOnline === false ? "disconnected" : status;` + `const effectiveLastError = backendOnline === false ? null : lastError;` + `return { status: effectiveStatus, lastError: effectiveLastError, reconnectCount };`.
- **Effect-order & double-connect analysis (pre-existing, not worsened):** The connect-on-mount effect (declared at line 358) runs BEFORE the transitions effect (declared at line 375). When `backendOnline` transitions false→true, both effects re-run: connect-on-mount calls `connectRef.current()` (with `freshSessionRef.current` still false from the previous render — no reset), then transitions sets `freshSessionRef.current = true` and calls `connectRef.current()` again (second `connect()` call, this time `freshSessionRef.current` is true — reset fires, then `cleanup()` discards the EventSource from the first call and creates a new one). This double-connect is PRE-EXISTING (the iter-114 code has the same pattern) and is not worsened by the fix. The end state is correct: `reconnectCount = 0`, fresh EventSource created.
- **Stale-error-clear analysis:** Original code cleared `lastError` when backend went OFFLINE. After the fix, the derived `effectiveLastError` is `null` when offline (user sees no error — same behavior). When backend comes back ONLINE, `connect()` consumes `freshSessionRef` and clears `lastError` (added `setLastError(null)` to the consumption block) — this clears any stale error before `es.onopen` fires (which also clears it). The user never sees a stale error resurface during the online transition. Semantics fully preserved.
- **Verification:**
  - `npx eslint src/hooks/use-price-stream.ts` → **0 warnings, 0 errors** ✅ (was 1 warning).
  - `npx eslint .` → **0 errors, 125 warnings, exit 0** ✅ (was 126 → 125 = 1 warning removed, exactly matching the 1 set-state-in-effect site).
  - `npx tsc --noEmit` → **exit 0** ✅ (no type errors; `effectiveStatus` typed as `PriceStreamStatus`, `effectiveLastError` as `string | null`; `freshSessionRef` typed as `useRef<boolean>`).
  - `npx jest --maxWorkers=1` → **582 passed, 0 failed, 25 suites, exit 0** ✅ (matches iter-114 count; no test files touched).
  - `pytest` not run (no backend changes) — 1279 passed expected per iter 113.
  - `next build` not run (4GB RAM env constraint, see Quick Reference OOM note) — iter-114 baseline was green; the refactor only changes (a) where setState is called (effect → useCallback body, same tick) and (b) adds a render-time derivation (pure computation), so build regression is not a plausible failure mode.
- **Documentation updates:**
  - `STATUS.md`: bumped "Last updated" header (iter 115). Updated KI-24 section — table now shows 2 rules / 10 sites (was 2 rules / 11 sites), `use-price-stream.ts` removed from `set-state-in-effect` sites list (10 → 9), added "Note (iter 115)" paragraph documenting the fix. Updated backlog row: "10 React Compiler rule sites remaining (was 25 — `static-components` fully resolved iter 113, `refs` fully resolved iter 114, `set-state-in-effect` 1 of 10 resolved iter 115)". Added new "Key technical insights" paragraph: "`react-hooks/set-state-in-effect` fix recipe (iter 115)" — describes both strategies (derive during render; move setState into useCallback via signal ref) with the IFF-condition for each and the canonical example.
  - `worklog.md` (this entry) — trimmed iter 113 (oldest, in git log), now shows iter 114 + iter 115 (last 2 iterations per header convention).
  - `AGENT_NAVIGATION.md` — header bump only.

Stage Summary:
- **iter 115 SHIPPED — KI-24 `set-state-in-effect` 1 of 10 sites resolved.** The single warning in `use-price-stream.ts` eliminated. Lint warnings: 126 → 125 (0 errors). `tsc` green. 582 jest green. 1279 pytest expected green (no backend changes).
- **Modified files (3):** `src/hooks/use-price-stream.ts`, `STATUS.md`. Plus `worklog.md` (this entry) + `AGENT_NAVIGATION.md` (header bump).
- **What was NOT done (intentionally deferred):**
  - KI-23 (`unique-table.tsx` rules-of-hooks — extract `<CategoryGroupTable>`, ~120-line refactor, needs UI regression).
  - KI-20 (`case-transform.ts` regex `/_([a-z])/g` → `/_([a-z0-9])/g`, medium risk, needs full jest + UI regression).
  - KI-24 remaining 10 sites across 2 React Compiler rules (`set-state-in-effect` 9, `preserve-manual-memoization` 1) — each needs case-by-case evaluation, not mechanical. The 9 `set-state-in-effect` sites are in `dashboard-page.tsx` (3), `fuzzy-search.tsx` (1), `header.tsx` (1), `offline-banner.tsx` (1), `use-realms-and-leagues.ts` (1), `use-reduced-motion.ts` (1), `i18n/index.tsx` (1). The 1 `preserve-manual-memoization` site is `speculation-tab.tsx:316`.
  - TD-3/4/5/9 persistence gaps (need persistence-layer design).
  - P10 Gold Map ROI (§C.8) — feature work, depends on P1 3-way flips (already done).
- **Stopping point:** iter 115 = KI-24 `set-state-in-effect` 1 of 10 sites resolved (use-price-stream.ts). KI-24 backlog now 10 sites / 2 rules. Next iter (iter 116) candidates: (a) KI-23 fix — extract `<CategoryGroupTable>` from `unique-table.tsx` (P2, mechanical refactor, needs UI regression); (b) KI-20 fix — `case-transform.ts` regex (medium risk, needs full jest + UI regression); (c) KI-24 `set-state-in-effect` incremental — pick the next-smallest site (e.g. `use-reduced-motion.ts` 1 site, or `use-realms-and-leagues.ts` 1 site — both are hooks, similar pattern to use-price-stream.ts); (d) KI-24 `preserve-manual-memoization` — `speculation-tab.tsx:316` (1 site, different rule, evaluate whether `useMemo` can be removed); (e) TD-3/4/5/9 persistence gaps; (f) P10 Gold Map ROI (§C.8).

---

Task ID: iter-114
Agent: main
Task: iter 114 — incremental KI-24 fix: move the 2 latest-ref writes during render in `use-price-stream.ts` (`thresholdRef.current = invalidationThresholdPct` and `connectRef.current = connect`) into `useEffect` hooks. Eliminates both `react-hooks/refs` warnings; reduces total lint warnings 128 → 126. No backend/test changes.

Work Log:
- Cloned repo. Read STATUS.md (KI-23 open, KI-24 open with 13 sites / 3 rules after iter 113, KI-20 open), worklog.md (iter 112 + iter 113), package.json.
- **Selected iter 114 scope = KI-24 `refs` fix.** Per "Лучше недоделать, чем сломать": chose the smallest-scope, lowest-risk candidate from the iter-113 stopping-point list. The two `react-hooks/refs` warnings in `use-price-stream.ts` are both the well-known "latest-ref" pattern (`someRef.current = someProp;` written during render). The fix is mechanical (move the assignment into a `useEffect` with the synced value as the dep) and contained to a single file. The other candidates (KI-23 ~120-line refactor with UI regression need, KI-20 regex with full jest + UI regression need, KI-24 `set-state-in-effect` 10 sites in 8 files needing case-by-case evaluation, TD-3/4/5/9 persistence-layer design, P10 Gold Map ROI feature) all carry higher risk and need their own dedicated iter.
- **Confirmed baseline.** `npm install` → packages installed silently. `npx eslint .` → 128 warnings, 0 errors (matches iter-113 baseline). Per-file lint on the target: `use-price-stream.ts` had 3 warnings — 2× `react-hooks/refs` (lines 117 `thresholdRef.current = invalidationThresholdPct`, 328 `connectRef.current = connect`) and 1× `react-hooks/set-state-in-effect` (line 362, out of scope for this iter — part of KI-24 `set-state-in-effect` backlog). `npx tsc --noEmit` → exit 0.
- **Read the full target file.** `use-price-stream.ts` is a 374-line SSE consumer hook. The 2 `refs` violations are the latest-ref pattern:
  - Line 117 (`thresholdRef.current = invalidationThresholdPct;`) — syncs the threshold prop to a ref so the SSE `onmessage`/`update` handlers and `connect()` can read the latest threshold without becoming stale closures.
  - Line 328 (`connectRef.current = connect;`) — keeps a stable ref to the latest `connect` callback so the connect-on-mount effect (line 334) and the backendOnline transition effect (line 351) can call `connectRef.current()` without depending on `connect` identity (avoids reconnect storms when only `connect`'s deps churn).
- **Safety analysis (semantics preservation):**
  - `thresholdRef.current` is read at lines 214 (inside `connect()`), 239 (inside `es.onmessage`), 256 (inside `es.addEventListener("update")`). All three are event handlers or callbacks invoked AFTER render — none read during render. Deferring the sync to a passive effect is semantically equivalent.
  - `connectRef.current` is read at lines 316 (inside `es.onerror` callback), 338 (inside the connect-on-mount `useEffect`), 369 (inside the backendOnline transition `useEffect`). All three fire AFTER render. Safe to defer.
  - **Effect declaration order matters.** React runs effects top-to-bottom. The two new sync-effects MUST be declared BEFORE the consuming connect-on-mount effect so the refs are updated before any reader runs. Placed the `thresholdRef` sync-effect at lines 116-128 (just after the ref declaration, before any other useEffect) and the `connectRef` sync-effect at lines 338-352 (just after the `connect` useCallback declaration, before the connect-on-mount useEffect at line 357).
- **Applied fix:**
  1. Replaced `thresholdRef.current = invalidationThresholdPct;` (was line 117) with `useEffect(() => { thresholdRef.current = invalidationThresholdPct; }, [invalidationThresholdPct]);` + explanatory comment block citing the rule, the rationale, and the effect-ordering invariant.
  2. Replaced `connectRef.current = connect;` (was line 328) with `useEffect(() => { connectRef.current = connect; }, [connect]);` + same explanatory comment block.
- **Verification:**
  - `npx eslint src/hooks/use-price-stream.ts` → 1 warning (was 3). The 2 `react-hooks/refs` warnings are GONE. Only the 1 `react-hooks/set-state-in-effect` warning at line 362 remains (out of scope, KI-24 backlog). ✅
  - `npx eslint .` → **0 errors, 126 warnings, exit 0** ✅ (was 128 → 126 = 2 warnings removed, exactly matching the 2 refs sites).
  - `npx tsc --noEmit` → **exit 0** ✅ (deps array types check out; `connect` is a `() => void` matching `connectRef`'s `useRef<() => void>` initializer; `invalidationThresholdPct` is `number` matching `thresholdRef`'s inferred `useRef<number>`).
  - `npx jest --maxWorkers=1` → **582 passed, 0 failed, 25 suites, exit 0** ✅ (matches iter-113 count; no test files touched).
  - `pytest` not run (no backend changes) — 1279 passed expected per iter 113.
  - `next build` not run (4GB RAM env constraint, see Quick Reference OOM note) — iter-113 baseline was green; the refactor only changes ref-sync timing (synchronous during render → deferred to passive effect), with render output and external behavior unchanged, so build regression is not a plausible failure mode.
- **Documentation updates:**
  - `STATUS.md`: bumped "Last updated" header (iter 114). Updated KI-24 section — table now shows 2 rules / 11 sites (was 3 rules / 13 sites), `refs` row removed, added "Note (iter 114)" paragraph documenting the fix. Updated backlog row: "11 React Compiler rule sites remaining (was 25 — `static-components` fully resolved iter 113, `refs` fully resolved iter 114)". Added new "Key technical insights" paragraph: "`react-hooks/refs` fix recipe (iter 114)" — describes the latest-ref → useEffect move, the IFF-condition for safety (ref must not be read during render), and the effect-ordering invariant.
  - `worklog.md` (this entry) — trimmed iter 112 (oldest, in git log), now shows iter 113 + iter 114 (last 2 iterations per header convention).
  - `AGENT_NAVIGATION.md` — header bump only.

Stage Summary:
- **iter 114 SHIPPED — KI-24 `refs` fully resolved.** Both `react-hooks/refs` warnings eliminated. Lint warnings: 128 → 126 (0 errors). `tsc` green. 582 jest green. 1279 pytest expected green (no backend changes).
- **Modified files (3):** `src/hooks/use-price-stream.ts`, `STATUS.md`. Plus `worklog.md` (this entry) + `AGENT_NAVIGATION.md` (header bump).
- **Stopping point:** iter 114 = KI-24 `refs` fully resolved. KI-24 backlog now 11 sites / 2 rules. Next iter (iter 115) candidates: (a) KI-23 fix — extract `<CategoryGroupTable>` from `unique-table.tsx` (P2, mechanical refactor, needs UI regression); (b) KI-20 fix — `case-transform.ts` regex (medium risk, needs full jest + UI regression); (c) KI-24 `set-state-in-effect` incremental — `use-price-stream.ts:362` is a natural next target (already in context, same file just touched) OR evaluate the 9 other sites case-by-case; (d) TD-3/4/5/9 persistence gaps; (e) P10 Gold Map ROI (§C.8).
