# Worklog

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
