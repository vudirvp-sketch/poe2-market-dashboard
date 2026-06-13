# PoE2 Market Dashboard — Рефакторинг

> Версия: 13.0 | Дата: 2026-06-13

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

## Hotfix: E2E Response Model Fixes (iter 46)

3 pre-existing E2E test failures — all fixed. Green E2E build.

| # | Bug | Root Cause | Fix |
|---|-----|-----------|-----|
| 1 | 500 on GET /api/v1/prices | Mock providers use tuple keys like ("exalted", "chaos") for exchange_rates, but PairData.pair expects string | Changed mock_provider.py + conftest.py FlakyPoe2ScoutProvider to use string keys "exalted/chaos" |
| 2 | 500 on POST /api/v1/events | EventData.id doesn't match StoredEvent.to_dict() which returns "event_id" | Changed EventData.id → EventData.event_id; added created_at field |
| 3 | 500 on GET /api/v1/arbitrage/flips | FlipsResponse requires data_available but success path didn't return it | Added "data_available": True to flips success response |

Files changed:
- `tests/e2e/mock_provider.py` — tuple keys → string keys
- `tests/e2e/conftest.py` — FlakyPoe2ScoutProvider tuple keys → string keys
- `backend/api/response_models.py` — EventData.id → event_id, added created_at
- `tests/e2e/test_api_e2e.py` — fixed event_id access path
- `backend/api/routes_arbitrage.py` — added data_available to flips response
- `src/lib/api-types.ts` — regenerated (3253 lines)
- `openapi_schema.json` — regenerated from live FastAPI

## Ключевые принципы

1. **response_model= MUST match route return dict** — mismatch = 500
2. **All paths use /api/v1/ prefix** — bridge, proxy, routes, tests
3. **Bridge health = /api/v1/health/ping** — not /api/health/ping
4. **SSE — дополнение к polling, не замена**
5. **SSE proxy: 200 + error event** — not 503 (prevents retry storms)
6. **ProcessPoolExecutor: picklable args only** — FlipComputeBundle + plain values, no DataSnapshot/AppConfig/EventManager/PipelineCache
7. **Mock exchange_rates keys = strings** — "exalted/chaos", not ("exalted", "chaos")
8. **EventData uses event_id** — matches StoredEvent.to_dict() output
