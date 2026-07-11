# iter 105 — Merge Instructions

> Merge this archive into your local `poe2-market-dashboard/` directory.
> All paths are relative to the repo root.

## What changed

### KI-16 long-term fix (partial): bridge moved to `src/lib/`
- `scripts/flipper-backend-bridge.ts` → `src/lib/flipper-backend-bridge.ts` (file move)
- `instrumentation.ts` import path updated: `"./scripts/flipper-backend-bridge"` → `"./src/lib/flipper-backend-bridge"`
- JSDoc headers in both files refreshed
- **Note:** the cosmetic Turbopack NFT warning still appears because the bridge uses dynamic fs/path operations. The warning is cosmetic — build and runtime work correctly. Deep fix tracked as KI-16-deep (P3). See STATUS.md.

### KI-18 (new, fixed): pytest hung on test_triangular.py
- **Root cause:** `find_triangular_arbitrage` offloads CPU work to `ProcessPoolExecutor` (spawn start method). In the test environment the spawned worker was terminated abruptly (`BrokenProcessPool`), and `asyncio.wait_for(loop.run_in_executor(...))` + pytest-asyncio did not propagate the exception → test hung indefinitely.
- **Fix:** new `tests/conftest.py` with an autouse fixture that patches `backend.main.get_process_pool` to return `None` for every test. This forces fallback to the default `ThreadPoolExecutor` (fast, spawn-free). Production code still uses `ProcessPoolExecutor`.
- **Result:** all 1161 pytest tests now pass in ~6s (was hanging indefinitely).

### cache-snapshot.json regenerated
- Fetched 14 endpoints from `https://poe2scout.com/api` on 2026-07-11.
- Fresh timestamp `2026-07-11T00:18:32Z` (was `2026-06-08` — over a month stale).
- Size: 448.4 KB (under 500 KB limit).
- URL keys use the correct `https://poe2scout.com/api/...` format (matching `BASE_URL` in `src/lib/poe2api.ts`).

### Documentation cleanup
- `STATUS.md` rewritten: KI-16 marked partially resolved, KI-18 closed, KI-16-deep TD entry added, Quick Reference table refreshed.
- `AGENT_NAVIGATION.md` header updated to iter 105; new "iter 105 changes" section added.
- `worklog.md` trimmed to last 2 iterations (iter 104 + iter 105).
- `docs/ARCHITECTURE.md` bridge path updated.
- Removed obsolete iter archive files (MERGE_INSTRUCTIONS_iter101/102/103.md + git_commands_iter101/102/103.txt).
- Removed `flipper-bridge.log` (400 KB runtime log that was tracked in git). Added `flipper-bridge.log` to `.gitignore`.

## Files to MERGE (overwrite existing)

| Path | Action |
|------|--------|
| `.gitignore` | overwrite |
| `AGENT_NAVIGATION.md` | overwrite |
| `STATUS.md` | overwrite |
| `docs/ARCHITECTURE.md` | overwrite |
| `instrumentation.ts` | overwrite |
| `src/data/cache-snapshot.json` | overwrite |
| `src/lib/flipper-backend-bridge.ts` | NEW (moved from `scripts/`) |
| `tests/conftest.py` | NEW |
| `worklog.md` | overwrite |

## Files to DELETE (no longer in repo)

| Path | Reason |
|------|--------|
| `scripts/flipper-backend-bridge.ts` | moved to `src/lib/` |
| `MERGE_INSTRUCTIONS_iter101.md` | obsolete iter archive |
| `MERGE_INSTRUCTIONS_iter102.md` | obsolete iter archive |
| `MERGE_INSTRUCTIONS_iter103.md` | obsolete iter archive |
| `git_commands_iter101.txt` | obsolete iter archive |
| `git_commands_iter102.txt` | obsolete iter archive |
| `git_commands_iter103.txt` | obsolete iter archive |
| `flipper-bridge.log` | runtime log, now gitignored |

## Verification (run after merge)

```bash
npx tsc --noEmit                          # should be clean (exit 0)
npx next build                            # should succeed in ~9s
npx jest                                  # 25 suites / 569 tests green
.venv/bin/python -m pytest -q             # 1161 tests green (~6s)
```

## Known issues after iter 105

- **KI-13** (open, low severity): `/api/v1/prices/stream?threshold_pct=1` returns 400. Dashboard falls back to polling.
- **KI-16-deep** (P3, cosmetic): NFT warning still appears during `next build` because the bridge uses dynamic fs/path operations. Deep fix requires refactoring the bridge to avoid fs ops at module-eval time.

See `STATUS.md` for the full known-issues list.
