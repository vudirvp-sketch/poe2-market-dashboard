# PoE2 Market Dashboard — Refactoring & Fixes

> Version: 16.0 | Date: 2026-06-16

## Completed Iterations

| Iter | Focus | Key Changes |
|------|-------|-------------|
| 44 | Response model mismatches | 6 bugs causing 503/500 cascade — all fixed |
| 45 | Pickle safety | FlipComputeBundle, DataSnapshot.__getstate__, pickle safety tests |
| 46 | E2E response model fixes | Mock provider tuple keys, EventData.event_id, flips data_available |
| 47 | Event ID migration, EventType sync | ActiveEvent.isActive, POST body transform, EventType 6 values, OpenAPI regen |
| 48 | use-price-stream hook, events sidebar E2E | SSE hook, createdAt in event cards, E2E for events sidebar |
| 49 | E2E fixes + PhaseDetector tests | openEventsSidebar fix, health mock "ok", 5 new lifecycle tests |
| 50 | poe.ninja UI analysis | 12 patterns identified, prioritized P0→P3, docs updated |
| **51** | **P0 features implementation** | **Adaptive Value Display, bezier sparkline, 16×16 currency icons** |

## Iteration 51 — P0 Features (Completed)

### 1. Adaptive Value Display ✅
- Added "Adaptive" option to reference currency selector (header.tsx, both main bar and "More" menu)
- `use-display-price.ts`: when `targetCurrencyApiId === "_adaptive"`, auto-selects best unit per row
  - ≥0.5 Divine → show in Divine
  - <0.01 Exalted → show in Chaos
  - Otherwise → show in Exalted
- `dashboard-page.tsx`: handles `"_adaptive"` in `onReferenceCurrencyChange` → stores `"_adaptive"` as baseCurrencyApiId
- `currency-card.tsx`, `virtual-currency-grid.tsx`, `exchange-pair-card.tsx`, `exchange-table.tsx`: pass effective base currency (resolve `"_adaptive"` → `"exalted"`) as baseCurrencyApiId
- `utils.ts`: `getCurrencyShortName("_adaptive")` returns "Adaptive" as fallback label

### 2. Bezier Sparkline ✅
- Replaced `<polyline>` + `<polygon>` with cubic bezier `<path>` + fill `<path>`
- Algorithm: Catmull-Rom to Bezier conversion (tension 1/6) — passes through all data points, no overshoot
- Trend-colored fill: green (#22c55e) for uptrend, red (#ef4444) for downtrend, fallback to `color` prop for flat
- Trend detection: compares last-third avg vs first-third avg

### 3. Currency Icons 16×16 ✅
- Changed `w-8 h-8` (32px) → `w-4 h-4` (16px) in exchange-table.tsx pair column
- Added `shrink-0` to prevent icon squishing
- Tightened gap from `gap-1.5` → `gap-1` for compact layout

## Next: P1 Features

| # | Feature | Complexity | Impact | Priority |
|---|---------|-----------|--------|----------|
| 4 | Info tooltips on column headers | Low | Medium | P1 |
| 5 | League selector grouping (Current/Previous) | Low | Medium | P1 |
| 6 | "Best Payment" column in exchange table | Medium | Medium | P1 |

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
10. **Adaptive mode: "_adaptive" in baseCurrencyApiId** — useDisplayPrice resolves per-row; components must resolve base to "exalted" before passing as baseCurrencyApiId
