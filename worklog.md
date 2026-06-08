# Worklog

---
Task ID: 20
Agent: main
Task: Iteration 10 — Fix bridge `spawn python ENOENT`, PYTHON_CMD env var, project root detection

Work Log:
- Fixed `flipper-backend-bridge.ts`: replaced `join(__dirname, "..")` with `getProjectRoot()` that checks `process.cwd()` first (reliable for `next start`), falls back to `__dirname` relative
- Added `PYTHON_CMD` env var support to `detectPythonCommand()` — checked before .venv heuristics
- Updated `start.bat`: exports `PYTHON_CMD` with the venv python path (`.venv\Scripts\python.exe`)
- Updated `start.sh`: exports `PYTHON_CMD` with the venv/system python path
- Added `projectRoot` to bridge startup log output for easier debugging
- Reviewed BestPaymentBadge + Premium column: code correct for Omens/Soul Cores (isItemCategory, CrossCurrencyPremiumCell)
- Updated AGENT_NAVIGATION.md to v1.25
- Updated ARCHITECTURE.md §10 to v1.25

Stage Summary:
- Root cause of `spawn python ENOENT`: after Turbopack bundling, `__dirname` points inside `.next/server/`, not project root → `.venv` not found → fallback to "python" fails
- Fix: process.cwd() for project root + PYTHON_CMD env var from start scripts
- BestPaymentBadge/Premium column code is correct — manual browser verification still TODO
