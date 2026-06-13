# PoE2 Market Dashboard — Agent Navigation Guide

> **Version:** 13.0 | **Date:** 2026-06-13

---

## 1. Where Things Are

| Directory | Purpose | Rules |
|-----------|---------|-------|
| `backend/` | Python FastAPI analytics engine | Tests mandatory (pytest) |
| `backend/api/` | Route handlers + response models + middleware | Import from `arbitrage/`, `economy/`, `predictors/`, `data/` |
| `backend/api/response_models.py` | Pydantic response models for all endpoints | Must match route return dicts exactly |
| `backend/api/routes_arbitrage.py` | Flip/triangular endpoints + FlipComputeBundle | Picklable data only in ProcessPoolExecutor args |
| `backend/api/data_snapshot.py` | DataSnapshot with __getstate__/__setstate__ | Custom pickle for safety |
| `backend/api/routes_sse.py` | SSE price stream | GET /api/v1/prices/stream |
| `backend/economy/events.py` | EventManager + StoredEvent.to_dict() | Returns event_id, is_active, created_at |
| `backend/arbitrage/` | Scorer, triangular, portfolio, recipe, quick_filter, liquid_chain | No direct API imports |
| `backend/economy/` | Events, lifecycle, momentum, benchmarks, tiers | Import from `data/` |
| `backend/predictors/` | Time-series, anomaly, clustering, storage_value, model_store | Import from `data/` |
| `backend/data/` | Providers, cache, schemas, historical, unified_cache | Import nothing from `api/` |
| `backend/models/` | Core dataclass models | No framework imports |
| `src/app/api/flipper/` | Next.js proxy routes → FastAPI | **Only proxy, no business logic** |
| `src/app/api/flipper/events/route.ts` | Events proxy — transforms camelCase→snake_case on POST | Body transform: eventType→event_type, expiryHours→expires_at |
| `src/app/api/poe2/` | Direct POE2Scout routes | Server-side fetch + cache |
| `src/components/dashboard/` | Tab components, dialogs, sidebar, sticky bar | Import from `@lib`, `@hooks` |
| `src/components/dashboard/events-sidebar.tsx` | Events sidebar UI | Uses `isActive` (not `active`), camelCase fields |
| `src/lib/` | Shared utilities, types, store, i18n, proxy, poe2api | **Types in `types.ts` ONLY** |
| `src/lib/api-types.ts` | Auto-generated from OpenAPI schema | Regenerate: `npx openapi-typescript openapi_schema.json --output src/lib/api-types.ts` |
| `src/lib/case-transform.ts` | snake_case→camelCase key transformer | Used by flipper-proxy on GET responses |
| `src/hooks/` | React hooks | Import from `@lib` |

## 2. Build & Run Commands

```bash
npm install && npm run dev        # Frontend (port 3000)
npm run build && npm run test     # Build + Jest
pytest tests/ -v                  # Backend tests
npx tsc --noEmit                  # TypeScript type check

# Backend (start.sh creates .venv automatically)
PYTHONPATH=. .venv/bin/python -m uvicorn backend.main:app --reload --port 8000

# Regenerate OpenAPI schema + TypeScript types
python -c "import json; from backend.main import app; from fastapi.openapi.utils import get_open_api; s=get_open_api(title=app.title,version=app.version,routes=app.routes); open('openapi_schema.json','w').write(json.dumps(s,indent=2,ensure_ascii=False))"
npx openapi-typescript openapi_schema.json --output src/lib/api-types.ts
```

## 3. Critical Rules

1. **Backend responses MUST use snake_case** — flipper-proxy `transformKeys()` converts to camelCase
2. **All API routes use /api/v1/ prefix** — old /api/ paths are removed
3. **Bridge health check MUST use /api/v1/health/ping** — NOT /api/health/ping
4. **response_model= must match route return dict** — mismatch = 500 Internal Server Error
5. **ProcessPoolExecutor: picklable args only** — no sqlite3.Connection, no EventManager, no DataSnapshot, no AppConfig
6. **CPU-bound Python → `run_in_executor()` with timeout** — never block event loop
7. **Never hardcode league names or currency categories** — use `config.yaml`
8. **FLIPPER_WORKERS env var** — controls ProcessPoolExecutor workers (default: 1)
9. **SSE proxy: return 200 + error event** — not 503 (prevents console spam + retry storms)
10. **Mock provider exchange_rates keys MUST be strings** — e.g. "exalted/chaos", NOT ("exalted", "chaos")
11. **EventData uses event_id (not id)**, is_active (not active), created_at — matches StoredEvent.to_dict()
12. **EventType enum has 6 values**: major_patch, minor_patch, league_start, economy_shift, streamer_hype, other
13. **Events POST proxy transforms body**: eventType→event_type, affectedCurrencies→affected_currencies, expiryHours→expires_at (ISO string)

## 4. Known Bugs / Frequent Problems

| Problem | Cause | Fix |
|---------|-------|-----|
| Flips/triangular return empty | ProcessPoolExecutor pickle error (sqlite3 in args) | Pre-extract into FlipComputeBundle; DataSnapshot.__getstate__ filters extras |
| Mock provider causes 500 on /prices | exchange_rates dict uses tuple keys | Use string keys like "exalted/chaos" |

## 5. API Endpoints (all under /api/v1/)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Detailed health check |
| GET | `/api/v1/health/ping` | Ultra-lightweight ping |
| GET | `/api/v1/phase` | League phase info |
| GET | `/api/v1/currencies` | Currency metadata |
| GET | `/api/v1/prices` | All exchange rates + metrics |
| GET | `/api/v1/prices/heatmap` | 24h price change heatmap |
| GET | `/api/v1/prices/stream` | SSE live price updates |
| GET | `/api/v1/prices/{pair}` | Price for specific pair |
| GET | `/api/v1/tiers` | Currency tier classifications |
| GET | `/api/v1/benchmarks/{currency}` | Historical benchmarks |
| GET | `/api/v1/arbitrage/flips` | Scored flip opportunities |
| GET | `/api/v1/arbitrage/triangular` | Triangular arbitrage cycles |
| GET | `/api/v1/arbitrage/optimal-currency` | Optimal payment currency |
| POST | `/api/v1/batch` | Batch multiple GET requests |
| POST | `/api/v1/events` | Create event |
| GET | `/api/v1/events` | List events |
| GET | `/api/v1/events/summary` | Event summary |
| GET | `/api/v1/events/{event_id}` | Get event by ID |
| DELETE | `/api/v1/events/{event_id}` | Delete event |
| POST | `/api/v1/events/{event_id}/deactivate` | Deactivate event |
| GET | `/api/v1/anomalies` | Anomaly detection |
| GET | `/api/v1/storage-value/{currency}` | Hold/sell decision |
| GET | `/api/v1/optimizer/path` | Optimal conversion path |
| GET | `/api/v1/optimizer/matrix` | Conversion matrix |
| GET | `/api/v1/analyst/summary` | League analyst summary |
| GET | `/api/v1/portfolio/correlation` | Correlation matrix |
| GET | `/api/v1/scanner/scan` | Advanced flip scanner |
| GET | `/api/v1/liquid-chain/analysis` | Liquid chain analysis |
| GET | `/api/v1/liquid-chain/opportunities` | Liquid chain opportunities |
