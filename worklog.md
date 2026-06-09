# Worklog

---
Task ID: 16
Agent: main
Task: Iteration 16 — Fix bridge startup (turbopackIgnore), offload _build_flip_opportunities(), stderr log parsing, Premium column review

Work Log:
- Diagnosed critical bug: `/* turbopackIgnore: true */` in `instrumentation.ts` prevented Turbopack from creating a chunk for `flipper-backend-bridge.ts`. At runtime, the dynamic import resolved from `.next/server/chunks/` instead of project root, and the chunk didn't exist → `Cannot find module` error → bridge never starts → backend offline
- Removed `turbopackIgnore` from `instrumentation.ts` import() call — the NFT warning is harmless (build-time only)
- Removed `turbopackIgnore` from `process.cwd()` in `scripts/flipper-backend-bridge.ts` getProjectRoot()
- Fixed bridge stderr logging: added regex-based log level parsing so only ERROR/CRITICAL/TRACEBACK lines are tagged as errors (uvicorn logs to stderr by default, even INFO/DEBUG)
- Refactored `_build_flip_opportunities()` in `routes_arbitrage.py`: extracted CPU-bound logic into `_build_flip_opportunities_sync()`, called via `loop.run_in_executor()` from async wrapper. Mirrors pattern used in `triangular.py` (v1.30). Clustering (KMeans n_init=10) and scoring loop no longer block the event loop
- Code-reviewed Flips tab Premium column: confirmed correct behavior (hidden on < md, sorting works, tooltip shows payment breakdown, BestPaymentBadge compact mode OK)
- Updated AGENT_NAVIGATION.md to v1.31: new COMPLETED items, updated TODO, revised Frequent Bug #40, revised v1.26/v1.30 entries about turbopackIgnore
- Python syntax validated for modified .py files

Stage Summary:
- Bridge startup fixed — turbopackIgnore was the root cause of `Cannot find module` error
- _build_flip_opportunities() now runs in executor thread — no more event loop blocking
- Bridge stderr logs now properly categorized by log level
- Premium column code review confirmed correct implementation
- Remaining for next iteration: real Windows testing of bridge (user needs to run start.bat locally)
