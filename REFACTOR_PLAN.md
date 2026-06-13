# PoE2 Market Dashboard — Рефакторинг

> Версия: 12.0 | Дата: 2026-06-13

## Фаза 1–4: DONE ✅

## Hotfix: Response Model Mismatches (iter 44)

6 interconnected bugs causing 503/500 cascade — all fixed.

## Hotfix: Pickle Safety for ProcessPoolExecutor (iter 45)

Flips returned empty because ProcessPoolExecutor failed to pickle arguments
containing sqlite3.Connection (via EventManager._store → HistoricalStore).

| # | Bug | Root Cause | Fix |
|---|-----|-----------|-----|
| 1 | Flips empty / pickle error | DataSnapshot + AppConfig passed to ProcessPoolExecutor; may transitively hold sqlite3.Connection | Created FlipComputeBundle — pre-extracts only picklable data |
| 2 | DataSnapshot could become unpicklable at runtime | No __getstate__/__setstate__ — extra attributes would break pickle | Added __getstate__/__setstate__ that serializes only known fields |
| 3 | No test coverage for pickle safety | Model/dataclass changes not tested for picklability | Added tests/test_pickle_safety.py (11 tests) |
| 4 | api-types.ts out of date | openapi_schema.json missing; types stale | Regenerated from live FastAPI OpenAPI schema |

Files changed:
- `backend/api/routes_arbitrage.py` — FlipComputeBundle dataclass, sync function takes bundle + plain values
- `backend/api/data_snapshot.py` — __getstate__/__setstate__ for pickle safety
- `tests/test_pickle_safety.py` — 11 new tests
- `src/lib/api-types.ts` — regenerated from updated OpenAPI schema
- `openapi_schema.json` — exported from live FastAPI app

## Ключевые принципы

1. **response_model= MUST match route return dict** — mismatch = 500
2. **All paths use /api/v1/ prefix** — bridge, proxy, routes, tests
3. **Bridge health = /api/v1/health/ping** — not /api/health/ping
4. **SSE — дополнение к polling, не замена**
5. **SSE proxy: 200 + error event** — not 503 (prevents retry storms)
6. **ProcessPoolExecutor: picklable args only** — FlipComputeBundle + plain values, no DataSnapshot/AppConfig/EventManager/PipelineCache

## Pre-existing Issues (not fixed this iteration)

- `/api/v1/prices` — PairData.pair is tuple key, response model expects string
- `POST /api/v1/events` — EventCreateResponse expects `id` but route returns `event_id`
