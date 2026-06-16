# PoE2 Market Dashboard — Refactoring & Fixes

> Version: 15.0 | Date: 2026-06-16

## Completed Iterations

| Iter | Focus | Key Changes |
|------|-------|-------------|
| 44 | Response model mismatches | 6 bugs causing 503/500 cascade — all fixed |
| 45 | Pickle safety | FlipComputeBundle, DataSnapshot.__getstate__, pickle safety tests |
| 46 | E2E response model fixes | Mock provider tuple keys, EventData.event_id, flips data_available |
| 47 | Event ID migration, EventType sync | ActiveEvent.isActive, POST body transform, EventType 6 values, OpenAPI regen |
| 48 | use-price-stream hook, events sidebar E2E | SSE hook, createdAt in event cards, E2E for events sidebar |
| 49 | E2E fixes + PhaseDetector tests | openEventsSidebar fix, health mock "ok", 5 new lifecycle tests |

## Next: UI Improvements (poe.ninja analysis)

> Source: analysis of https://poe.ninja/poe2/economy/runesofaldur/currency

### Priority Matrix

| # | Feature | Complexity | Impact | Priority |
|---|---------|-----------|--------|----------|
| 1 | Adaptive Value Display | Medium | Very High | P0 |
| 2 | Smooth sparkline (bezier curves) | Low | High | P0 |
| 3 | Currency icons in exchange-table rows | Low | High | P0 |
| 4 | Info tooltips on column headers | Low | Medium | P1 |
| 5 | League selector grouping (Current/Previous) | Low | Medium | P1 |
| 6 | "Best Payment" column in exchange table | Medium | Medium | P1 |
| 7 | Inline filter above tables | Low | Medium | P2 |
| 8 | "Show more" lazy load (supplement pagination) | Medium | Medium | P2 |
| 9 | Sidebar navigation with icons | High | High | P2 |
| 10 | Breadcrumb navigation | Low | Low | P3 |
| 11 | Cool Grey CSS tokens for sidebar | Low | Low | P3 |

### Key Design Decisions

- **Adaptive display**: auto-select currency unit per row (Divine for >0.5 Div, Exalted otherwise, Chaos for <0.01 Exa)
- **Sparkline**: replace `<polyline>` with cubic bezier `<path>` + trend-colored fill (green=up, red=down)
- **Icons**: use `iconUrl` from PoeItem/ExchangePair, render as 16x16 in table cells
- **NOT adopting**: floating-label dropdown (shadcn Select is better for accessibility)

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
