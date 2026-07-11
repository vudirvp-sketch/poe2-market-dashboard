# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

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
- **What was NOT done (intentionally deferred):**
  - KI-23 (`unique-table.tsx` rules-of-hooks — extract `<CategoryGroupTable>`, ~120-line refactor, needs UI regression).
  - KI-20 (`case-transform.ts` regex `/_([a-z])/g` → `/_([a-z0-9])/g`, medium risk, needs full jest + UI regression).
  - KI-24 remaining 11 sites across 2 React Compiler rules (`set-state-in-effect` 10, `preserve-manual-memoization` 1) — each needs case-by-case evaluation, not mechanical. Of these, `use-price-stream.ts:362` is the next-smallest target (1 site in the same file just touched).
  - TD-3/4/5/9 persistence gaps (need persistence-layer design).
  - P10 Gold Map ROI (§C.8) — feature work, depends on P1 3-way flips (already done).
- **Stopping point:** iter 114 = KI-24 `refs` fully resolved. KI-24 backlog now 11 sites / 2 rules. Next iter (iter 115) candidates: (a) KI-23 fix — extract `<CategoryGroupTable>` from `unique-table.tsx` (P2, mechanical refactor, needs UI regression); (b) KI-20 fix — `case-transform.ts` regex (medium risk, needs full jest + UI regression); (c) KI-24 `set-state-in-effect` incremental — `use-price-stream.ts:362` is a natural next target (already in context, same file just touched) OR evaluate the 9 other sites case-by-case; (d) TD-3/4/5/9 persistence gaps; (e) P10 Gold Map ROI (§C.8).

---

Task ID: iter-113
Agent: main
Task: iter 113 — incremental KI-24 fix: move inline `SortIndicator` from inside `ExchangeTable` / `WatchlistTab` to module scope in `exchange-table.tsx` (7 sites) and `watchlist-tab.tsx` (5 sites). Pass `sortField`/`sortDirection` as explicit props. Eliminates all 12 `react-hooks/static-components` warnings; reduces total lint warnings 140 → 128. No backend/test changes.

Work Log:
- Cloned repo. Read STATUS.md (KI-23 open, KI-24 open with 25 sites / 4 rules, KI-20 open), worklog.md (iter 111 + iter 112), package.json.
- **Selected iter 113 scope = KI-24 incremental `static-components` fix.** Per "Лучше недоделать, чем сломать": chose the lowest-risk candidate from the iter-112 stopping-point list. Mechanical refactor (move component to module scope, add explicit props), no logic change, no backend touched, no test fixtures touched.
- **Confirmed baseline.** `npx eslint .` → 140 warnings, 0 errors. Per-file: `exchange-table.tsx` had 7 `static-components` warnings, `watchlist-tab.tsx` had 5.
- **Applied identical fix pattern to both files:** moved `SortIndicator` to module scope, added `interface SortIndicatorProps { field, sortField, sortDirection }`, updated all 12 call sites to pass explicit props.
- **Verification:** `npx eslint .` → 0 errors, 128 warnings ✅ (12 removed). `npx tsc --noEmit` → exit 0 ✅. `npx jest --maxWorkers=1` → 582 passed ✅.
- **Docs:** `STATUS.md` updated (KI-24 table 4→3 rules, 25→13 sites, added iter-113 note + recipe in Key Insights). `AGENT_NAVIGATION.md` header bump.

Stage Summary:
- **iter 113 SHIPPED — KI-24 `static-components` fully resolved.** 12 warnings eliminated. Lint 140 → 128 (0 errors). `tsc` green. 582 jest green.
- **Modified files (3):** `src/components/dashboard/exchange-table.tsx`, `src/components/dashboard/watchlist-tab.tsx`, `STATUS.md` + `worklog.md` + `AGENT_NAVIGATION.md`.
- **Stopping point:** KI-24 `static-components` fully resolved. Next iter candidates: KI-23 / KI-20 / KI-24 refs (2 sites in `use-price-stream.ts`) / KI-24 set-state-in-effect (10 sites) / TD-3/4/5/9 / P10 Gold Map ROI.
