# Iter 58 — WS Endpoint Removal

## Summary
Completely removes WebSocket endpoints (Option (b) from iter 57 stopping point).
Closes 6 issues in one commit:
- P0-2 (event loop blocking by `_compute_anomalies` / `_compute_flips`)
- P1-1 (WS duplicate REST logic with reduced fields)
- P1-2 (`useFlipperWebSocket` opens 2 parallel WS connections)
- P2-10 (WS path prefix `/v1/ws/*` vs REST `/api/v1/*`)
- P3-1 (two anomaly detection paths — `routes_ws._compute_anomalies` and `routes_anomalies._detect_anomalies_sync`)
- P3-6 (.env.example missing WS env)

Real-time updates now handled exclusively by SSE (P0-1, iter 55) + REST polling.

## Merge instructions
This archive preserves the original folder structure. To merge with your local clone:

```bash
# from the repo root (after `git pull` to sync to iter 57)
unzip -o iter58-ws-removal.zip
# files marked .DELETED.txt correspond to git rm operations — delete them:
rm -f backend/api/routes_ws.py
rm -f src/hooks/use-websocket.ts
rm -rf src/app/api/flipper/ws
# then verify status
git status
```

## Verification (run before commit)
- `pytest tests/ -q --ignore=tests/e2e` → 375 pass / 4 skip / 0 fail
- `pytest tests/e2e/ -q` → 30 pass / 4 skip / 0 fail
- `npx tsc --noEmit` → exit 0 (clean)
- `npx jest --silent` → 291 pass / 0 fail

## Files (17 total)
### Deleted (3)
- `backend/api/routes_ws.py` (722 lines — 5 WS endpoints + 4 compute helpers + 2 shared loops)
- `src/hooks/use-websocket.ts` (548 lines — `useWebSocket` + `useFlipperWebSocket` + types)
- `src/app/api/flipper/ws/info/route.ts` (1 file + parent dir)

### Modified (14)
- `backend/main.py` — removed WS router registration
- `src/components/dashboard/dashboard-page.tsx` — removed `useFlipperWebSocket` import + usage + `wsStatus` prop
- `src/components/dashboard/flips-tab.tsx` — removed `useFlipperWebSocket` import + usage + unused `useQueryClient`
- `src/components/dashboard/header.tsx` — removed `WebSocketStatus` import + `wsStatus` prop + WS badge UI
- `src/components/dashboard/flipper-sticky-bar.tsx` — removed `WebSocketStatus` import + `wsStatus` prop + WS Status Badge block + unused lucide icons
- `src/components/dashboard/flipper-backend-status-card.tsx` — removed `WebSocketStatus` import + `wsStatus` prop + `wsBadgeConfig` IIFE + unused imports
- `.env.example` — removed `NEXT_PUBLIC_FLIPPER_WS_URL` + `NEXT_PUBLIC_FLIPPER_WS_ENABLED`
- `start.sh` — removed WS env var creation in `.env.local` setup section
- `start.bat` — same as `start.sh` (CRLF preserved)
- `STATUS.md` — P0 bucket 1→0; P1 10→8; P2 11→9; P3 8→6; new Fixed entry; Quick Reference trimmed
- `REFACTOR_PLAN.md` — v22→v23; iter 58 DONE; estimation 20→15 iterations
- `AGENT_NAVIGATION.md` — removed `routes_ws.py` + `use-websocket.ts` rows; §3 rules #2/#6 updated; §4 symptoms trimmed; §5 WS endpoints section removed; new rule #18
- `docs/DATA_FLOW.md` — removed WS channels table + `routes_ws.py` from route lists
- `worklog.md` — iter 58 entry replaces iter 55 (≤5 rule); iter 55-57 retained

## Suggested commit message
```
refactor(P0-2): remove WS endpoints — close P0-2 + P1-1 + P1-2 + P2-10 + P3-1 + P3-6
```

## Stopping point
- Iter 58 done. **No P0 issues remain.**
- Next: iter 59 = P1-11 (daily_stats invalidation — 2-line fix) OR P2-7 (targeted invalidation by `pair` — unblocked by P0-1).
