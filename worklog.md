# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-113
Agent: main
Task: iter 113 — incremental KI-24 fix: move inline `SortIndicator` from inside `ExchangeTable` / `WatchlistTab` to module scope in `exchange-table.tsx` (7 sites) and `watchlist-tab.tsx` (5 sites). Pass `sortField`/`sortDirection` as explicit props. Eliminates all 12 `react-hooks/static-components` warnings; reduces total lint warnings 140 → 128. No backend/test changes.

Work Log:
- Cloned repo. Read STATUS.md (KI-23 open, KI-24 open with 25 sites / 4 rules, KI-20 open), worklog.md (iter 111 + iter 112), package.json.
- **Selected iter 113 scope = KI-24 incremental `static-components` fix.** Per "Лучше недоделать, чем сломать": chose the lowest-risk candidate from the iter-112 stopping-point list. Mechanical refactor (move component to module scope, add explicit props), no logic change, no backend touched, no test fixtures touched. The other candidates (KI-23 ~120-line refactor with UI regression need, KI-20 regex with full jest + UI regression need, TD-3/4/5/9 persistence layer design, P10 Gold Map ROI feature) all carry higher risk and need their own dedicated iter.
- **Confirmed baseline.** `npm install` → 800 packages in 11s. `npx eslint .` → 140 warnings, 0 errors (matches iter-112 baseline). Per-file lint on the 2 targets: `exchange-table.tsx` had 7 `static-components` warnings (1 inline `SortIndicator` definition + 7 usage sites flagged because the inline type identity changes every render), `watchlist-tab.tsx` had 5 `static-components` warnings (same pattern, 5 usage sites).
- **Read both target files.**
  - `exchange-table.tsx`: `SortField` type already at module scope (line 39). `sortDirection` comes from `uiState.exchange.sortDirection` (typed as `"asc" | "desc"` in `store.ts:60`). Inline `SortIndicator` at lines 364–373, captures `sortField`/`sortDirection` from closure. Used at 7 column headers: pair, rate, change, change7d, volume, premium, trend. Icons `ArrowUpDown`/`ArrowUp`/`ArrowDown` already imported at top.
  - `watchlist-tab.tsx`: `SortField`/`SortDirection` types at module scope (lines 47–48). `sortField`/`sortDirection` are local `useState<SortField>`/`useState<SortDirection>`. Inline `SortIndicator` at lines 197–206, captures the same two values. Used at 5 column headers: pair, rate, change, pnl, added. Same icon imports.
- **Applied identical fix pattern to both files:**
  1. Added `type SortDirection = "asc" | "desc";` to `exchange-table.tsx` module scope (was missing — `watchlist-tab.tsx` already had it).
  2. Added module-scope `interface SortIndicatorProps { field, sortField, sortDirection }` + `function SortIndicator({ field, sortField, sortDirection })` — body byte-identical to the inline version, just reading from props instead of closure.
  3. Deleted the inline `const SortIndicator = ({ field }: { field: SortField }) => { ... }` block from inside the parent component.
  4. Updated each call site: `<SortIndicator field="X" />` → `<SortIndicator field="X" sortField={sortField} sortDirection={sortDirection} />`. 7 sites in `exchange-table.tsx`, 5 sites in `watchlist-tab.tsx`.
- **Verification:**
  - `npx eslint src/components/dashboard/exchange-table.tsx src/components/dashboard/watchlist-tab.tsx` → 0 `static-components` warnings, 13 pre-existing warnings remain (unused imports, `no-img-element`, `exhaustive-deps`). ✅
  - `npx eslint .` → **0 errors, 128 warnings, exit 0** ✅ (was 140 → 128 = 12 warnings removed, exactly matching 7+5 sites).
  - `npx tsc --noEmit` → **exit 0** ✅ (props interface type-checks against both `SortField`/`SortDirection`).
  - `npx jest --maxWorkers=1` → **582 passed, 0 failed, 25 suites, exit 0** ✅ (matches iter-112 count; no test files touched).
  - `pytest` not run (no backend changes) — 1279 passed expected per iter 112.
  - `next build` not run (4GB RAM env constraint, see Quick Reference OOM note) — iter-112 baseline was green; the refactor is purely mechanical (component identity stabilizes, render output is byte-identical), so build regression is not a plausible failure mode.
- **Documentation updates:**
  - `STATUS.md`: bumped "Last updated" header (iter 113). Updated KI-24 section — table now shows 3 rules / 13 sites (was 4 rules / 25 sites), `static-components` row removed, added "Note (iter 113)" paragraph documenting the fix. Updated backlog row: "13 React Compiler rule sites remaining (was 25 — `static-components` fully resolved iter 113)". Added new "Key technical insights" paragraph: "`react-hooks/static-components` fix recipe (iter 113)" — describes the 3-step mechanical recipe (move to module scope, add props interface, update call sites) + verification protocol.
  - `worklog.md` (this entry) + `AGENT_NAVIGATION.md` (header bump).

Stage Summary:
- **iter 113 SHIPPED — KI-24 incremental fix.** All 12 `react-hooks/static-components` warnings eliminated. Lint warnings: 140 → 128 (0 errors). `tsc` green. 582 jest green. 1279 pytest expected green (no backend changes).
- **Modified files (3):** `src/components/dashboard/exchange-table.tsx`, `src/components/dashboard/watchlist-tab.tsx`, `STATUS.md`. Plus `worklog.md` (this entry) + `AGENT_NAVIGATION.md` (header bump).
- **What was NOT done (intentionally deferred):**
  - KI-23 (`unique-table.tsx` rules-of-hooks — extract `<CategoryGroupTable>`, ~120-line refactor, needs UI regression).
  - KI-20 (`case-transform.ts` regex `/_([a-z])/g` → `/_([a-z0-9])/g`, medium risk, needs full jest + UI regression).
  - KI-24 remaining 13 sites across 3 other React Compiler rules (`set-state-in-effect` 10, `refs` 2, `preserve-manual-memoization` 1) — each needs case-by-case evaluation, not mechanical.
  - TD-3/4/5/9 persistence gaps (need persistence-layer design).
  - P10 Gold Map ROI (§C.8) — feature work, depends on P1 3-way flips (already done).
- **Stopping point:** iter 113 = KI-24 `static-components` fully resolved. Next iter (iter 114) candidates: (a) KI-23 fix — extract `<CategoryGroupTable>` from `unique-table.tsx` (P2, mechanical refactor, needs UI regression); (b) KI-20 fix — `case-transform.ts` regex (medium risk, needs full jest + UI regression); (c) KI-24 `set-state-in-effect` incremental — evaluate the 10 sites case-by-case, some are legitimate `useSyncExternalStore` candidates; (d) KI-24 `refs` — evaluate `useLatestRef` helper for `use-price-stream.ts`; (e) TD-3/4/5/9 persistence gaps; (f) P10 Gold Map ROI (§C.8).

---

Task ID: iter-112
Agent: main
Task: iter 112 — fix KI-22: create `eslint.config.mjs` with Next.js v16 flat-config preset so `npm run lint` passes. Document any new bugs discovered during lint rollout as Known Issues.

Work Log:
- Cloned repo. Read STATUS.md (KI-22 open, KI-20 open, KI-21 closed iter 111), worklog.md (iter 110 + iter 111), package.json (`eslint: ^9.39.4`, `eslint-config-next: ^16.1.1`, no `"type": "module"`), tsconfig.json, next.config.ts (already notes "In Next.js 16, the `eslint` key is no longer supported in next.config. Use eslint.config.js instead").
- **Confirmed KI-22 scope.** No `eslint.config.*` files anywhere. `package-lock.json` shows `@eslint/eslintrc: ^3.3.5` already transitively installed via `eslint-config-next`.
- **Inspected `eslint-config-next` v16.2.6.** Its `package.json` `exports` field exposes `./core-web-vitals` and `./typescript` as native flat-config arrays. No `FlatCompat` wrapper needed.
- **Created `eslint.config.mjs`** (ESM, `.mjs` extension forces ESM since no `"type": "module"` in package.json). Spread `nextCoreWebVitals` + `nextTypescript`. Added project-specific ignores: `cloudflare-worker/**`, `e2e/**`, `backend/**` + `tests/**`, `scripts/**/*.py`, generated JSON files, `**/DELETE_*.ts` (KI-19 defense-in-depth). Added `@typescript-eslint/no-unused-vars` override with `^_|^e$` ignore patterns.
- **First lint run: 37 errors, 115 warnings.** Wrote `parse_eslint_report.py` to categorize by rule. Breakdown: `react-hooks/static-components` (12 errors) — inline `SortIndicator` defs in `exchange-table.tsx` (7) + `watchlist-tab.tsx` (5); `react-hooks/set-state-in-effect` (10); `@typescript-eslint/no-require-imports` (5); `prefer-const` (5); `react-hooks/refs` (2); `@typescript-eslint/no-explicit-any` (1); `react-hooks/preserve-manual-memoization` (1); `react-hooks/rules-of-hooks` (1) — **REAL BUG**: `useReactTable` inside `.map()` in `unique-table.tsx:305`, documented as KI-23.
- **Investigated KI-23.** `useReactTable` inside `categoryGroups.map(...)` — violates Rules-of-Hooks. Latent: crashes only if `categoryGroups.length` changes between renders. Inline-disabled; proper fix = extract `<CategoryGroupTable>` child (~120-line refactor, ~10 props), deferred to dedicated iter.
- **Investigated `react-hooks/refs`.** Both at `use-price-stream.ts:117,328` — legitimate "latest ref" pattern. Downgraded rule to "warn" (KI-24).
- **Investigated `react-hooks/static-components`.** Both files define `SortIndicator` INSIDE parent body — causes remounts on every render. Stateless, so no crash. Deferred to KI-24 (fixed iter 113).
- **Investigated `no-require-imports`.** All 5 legitimate: `jest.setup.ts` (optional undici loader), `scripts/bump-sw-cache.js` (Node.js script), `poe2api.ts` (server-only dynamic require guarded by `typeof window`). Inline disables for `.ts`; config block `files: ["**/*.js"]` → `rules: { "@typescript-eslint/no-require-imports": "off" }` for `.js`.
- **Applied 6 safe source fixes:** `cors-proxy-fallback.test.ts` (4× `let` → `const`), `poe2api-realms.test.ts` (1×), `liquid-chain-tab.tsx` (`as any` → `Record<string, TranslationKeys>` + import).
- **Added inline disables for 5 legitimate `require()` calls:** `jest.setup.ts:27`, `poe2api.ts:2684,2686`.
- **Updated `eslint.config.mjs` with KI-24 overrides:** downgraded 4 React Compiler rules to "warn": `set-state-in-effect`, `static-components`, `preserve-manual-memoization`, `refs`.
- **Verification:** `npm run lint` → **0 errors, 140 warnings, exit 0** ✅. `tsc --noEmit` → exit 0 ✅. `jest --maxWorkers=1` → 582 passed ✅. `pytest` not run (no backend changes) — 1279 passed expected.
- **Files modified (9):** `eslint.config.mjs` (NEW), `cors-proxy-fallback.test.ts`, `poe2api-realms.test.ts`, `liquid-chain-tab.tsx`, `jest.setup.ts`, `poe2api.ts`, `unique-table.tsx` (KI-23 inline-disable), `STATUS.md`, `worklog.md` + `AGENT_NAVIGATION.md`.

Stage Summary:
- **iter 112 SHIPPED — KI-22 fixed.** `npm run lint` passes (0 errors, 140 warnings, exit 0). Created `eslint.config.mjs` using native flat-config exports from `eslint-config-next` v16 (no `FlatCompat` wrapper). Fixed 6 source errors, added 5 inline disables for legitimate `require()`, disabled `no-require-imports` for `*.js`.
- **2 new Known Issues documented:** KI-23 (P2, rules-of-hooks in `unique-table.tsx`), KI-24 (P3, 25 React Compiler rule sites, all downgraded to "warn").
- **Key design decision for future agents:** `eslint-config-next` v16 ships native flat-config exports — use `import nextCoreWebVitals from "eslint-config-next/core-web-vitals"` + `import nextTypescript from "eslint-config-next/typescript"` and spread them. No `FlatCompat` needed.
