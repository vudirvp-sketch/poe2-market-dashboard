# Worklog

---
Task ID: 22
Agent: main
Task: Iteration 12 — BestPaymentBadge + Premium column on Flips tab

Work Log:
- Added `optimalPaymentByDisplayName` Map in `dashboard-page.tsx` — maps display names ("Name1/Name2") to OptimalPaymentResult, built from exchangeData + optimalPaymentByPair
- Updated FlipsTab props: added `optimalPaymentByDisplayName` and `anchorId`
- Updated FlipsTable props: added `optimalPaymentByDisplayName` and `anchorId`
- Added Premium column to FlipsTable grid (11 columns now, 60px width for Premium)
- Premium cell renders BestPaymentBadge (compact) with tooltip showing full payment breakdown (mirrors Exchange tab CrossCurrencyPremiumCell pattern)
- Added "premium" to SortField union type in flips-helpers.ts
- Added "premium" sort case in flips-tab.tsx sort handler (looks up savingsPct from optimalPaymentByDisplayName)
- Reuses existing `crossCurrencyPremium` i18n key for column header (no new i18n keys needed)
- Updated AGENT_NAVIGATION.md: v1.27, completed task moved to COMPLETED section
- TypeScript compilation passes (`tsc --noEmit` clean)

Stage Summary:
- BestPaymentBadge + Premium column now works on Flips tab, same as Exchange tab
- Key design: display-name-keyed map bridges the gap between flip currency names and pair-ID-keyed optimalPaymentByPair
- Remaining: Premium tooltip text is hardcoded English (i18n todo for future iteration)

---
Task ID: 21
Agent: main
Task: Iteration 11 — Fix bridge `python backend.main:app` wrong spawn command, Turbopack NFT warning

Work Log:
- Fixed `flipper-backend-bridge.ts`: `getUvicornArgs()` now always returns `["-m", "uvicorn"]` instead of conditionally returning `[]` when uvicorn.exe found. The old logic caused `spawn(pythonCmd, ["backend.main:app", ...])` — Python treated `backend.main:app` as a filename, not a uvicorn app spec.
- Added `/* turbopackIgnore: true */` before `process.cwd()` in `getProjectRoot()` to suppress Turbopack "Encountered unexpected file in NFT list" build warning.
- The Cyrillic path garbling in error messages was a symptom of the same bug — Python was outputting the full path to `backend.main:app` as a filename, and the console couldn't render Cyrillic in that context. Fixed by the `-m uvicorn` change.
- Cleaned up AGENT_NAVIGATION.md: consolidated old iteration history (v1.15–v1.22) into compact summaries, added v1.26 iteration entry, added frequent bug #34.
- Noted TODO: BestPaymentBadge + Premium column need to be added to Flips tab (currently only on Exchange tab). This requires passing `optimalPaymentByPair` through component hierarchy and adding UI column.

Stage Summary:
- Root cause of bridge failure: `getUvicornArgs()` returned `[]` when uvicorn.exe existed, making Python interpret `backend.main:app` as a script path, not a uvicorn module spec
- Fix: always use `python -m uvicorn backend.main:app` (matches what start.bat/start.sh do manually)
- Turbopack warning fixed with `/* turbopackIgnore: true */`
- BestPaymentBadge/Premium column on Flips tab is TODO for next iteration
