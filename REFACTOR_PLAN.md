# PoE2 Market Dashboard — Refactoring & Fixes

> Version: 14.0 | Date: 2026-06-13

## Completed Iterations

| Iter | Focus | Key Changes |
|------|-------|-------------|
| 44 | Response model mismatches | 6 bugs causing 503/500 cascade — all fixed |
| 45 | Pickle safety | FlipComputeBundle, DataSnapshot.__getstate__, pickle safety tests |
| 46 | E2E response model fixes | Mock provider tuple keys, EventData.event_id, flips data_available |
| 47 | Event ID migration, EventType sync | ActiveEvent.isActive, POST body transform, EventType 6 values, OpenAPI regen |
| 48 | use-price-stream hook, events sidebar E2E, createdAt rendering | Created missing SSE hook, added createdAt to event cards, E2E tests for events sidebar, PhaseDetector verification |

## Key Principles

1. **response_model= MUST match route return dict** — mismatch = 500
2. **All paths use /api/v1/ prefix** — bridge, proxy, routes, tests
3. **Bridge health = /api/v1/health/ping** — not /api/health/ping
4. **SSE — complement to polling, not replacement**
5. **SSE proxy: 200 + error event** — not 503 (prevents retry storms)
6. **ProcessPoolExecutor: picklable args only** — FlipComputeBundle + plain values
7. **Mock exchange_rates keys = strings** — "exalted/chaos", not tuples
8. **EventData uses event_id** — matches StoredEvent.to_dict()
9. **PhaseDetector: only major_patch resets phase** — league_start/economy_shift affect scoring only
