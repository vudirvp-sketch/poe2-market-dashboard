# REFACTOR_PLAN.md — Roadmap

> Version: 17.0 | Date: 2026-06-20
> Source: Full codebase audit (iter 52). See `STATUS.md` for detailed issue descriptions.

## Principles

1. **One issue per commit.** Reference `STATUS.md` issue ID (e.g. `fix(P0-3): analyst 24h change`).
2. **Document first, fix second.** Any new bug found → add to `STATUS.md` before fixing.
3. **No big-bang refactors.** Each iteration = 1-3 issues from one priority bucket.
4. **Test after every fix.** `pytest tests/ -v` + `npm run test` + `npx tsc --noEmit`.
5. **Update docs in same commit.** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md` if needed.

## Priority Buckets

### P0 — Critical (correctness, stability) — do first
- P0-1. SSE — remove dead monitor, implement real change_pct filtering
- P0-2. WebSocket — offload `_compute_anomalies` to ProcessPoolExecutor
- P0-3. Analyst `_compute_trends` — fix `price_24h_ago` (use `_find_price_24h_ago`)
- P0-4. PhaseDetector — remove `max()` in `_reference_date`
- P0-5. Transitive prices — extract to shared helper, use in all 3 places
- P0-6. Triangular — remove `prices["chaos"] = 1.0` hardcode

### P1 — Serious (performance, maintainability)
- P1-1. WS endpoints — extract computation to shared services
- P1-2. `useFlipperWebSocket` — single connection or polling
- P1-3. `_compute_transitive_prices` — adjacency list
- P1-4. Clustering cache — single key + helper
- P1-5. `compute_quantized_analysis` — binary search
- P1-6. HistoricalStore — chunked delete
- P1-7. EventManager — `await` SQLite write
- P1-8. Bellman-Ford — proper negative cycle detection
- P1-9. Spread model — extract constants to config.yaml
- P1-10. Flipper-proxy — per-endpoint circuit breaker

### P2 — Medium (clean code)
- P2-1. dashboard-page.tsx — split god-component
- P2-2. Remove pipeline_cache.py / daily_stats_cache.py shims
- P2-3. Move currency_names_ru to JSON
- P2-4. Consolidate /scanner into /flips
- P2-5. Clean up routes_auth.py comments
- P2-6. Sync frontend/backend circuit breaker state
- P2-7. usePriceStream — targeted invalidation
- P2-8. proxyWithFallback — pass-through in dev
- P2-9. Forecasting — adaptive fallback instead of hardcoded min_data_points
- P2-10. Unify WS path prefix to /api/v1/ws/*

### P3 — Low priority (nice-to-have)
- See STATUS.md §P3

## Estimation (rough)

| Bucket | Issues | Estimated iterations | Risk |
|--------|--------|---------------------|------|
| P0 | 6 | 4-6 iterations | Low — small scope, well-defined |
| P1 | 10 | 8-10 iterations | Medium — some touch core paths |
| P2 | 10 | 6-8 iterations | Low — mostly mechanical |
| P3 | 7 | 3-4 iterations | Low — non-blocking |

**Total:** ~25 iterations to clean state. Each iteration = 1 commit, 1 STATUS.md update.

## Definition of Done (per issue)

- [ ] Code changed
- [ ] `pytest tests/ -v` passes (add regression test if applicable)
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `STATUS.md` — move issue to "Fixed" section with commit hash
- [ ] `worklog.md` — append entry with iteration number
- [ ] Commit message format: `<type>(P<n>-<id>): <short description>`
