# PoE2 Market Dashboard — Agent Navigation Guide

> **Version:** 10.0 | **Date:** 2026-06-12

---

## 1. Where Things Are

| Directory | Purpose | Rules |
|-----------|---------|-------|
| `backend/` | Python FastAPI analytics engine | Tests mandatory (pytest) |
| `backend/api/` | Route handlers + response models + middleware | Import from `arbitrage/`, `economy/`, `predictors/`, `data/` |
| `backend/api/response_models.py` | Pydantic response models for all endpoints | Must match route return dicts exactly |
| `backend/api/routes_sse.py` | SSE price stream | GET /api/v1/prices/stream |
| `backend/arbitrage/` | Scorer, triangular, portfolio, recipe, quick_filter, liquid_chain | No direct API imports |
| `backend/economy/` | Events, lifecycle, momentum, benchmarks, tiers | Import from `data/` |
| `backend/predictors/` | Time-series, anomaly, clustering, storage_value, model_store | Import from `data/` |
| `backend/data/` | Providers, cache, schemas, historical, unified_cache | Import nothing from `api/` |
| `backend/models/` | Core dataclass models | No framework imports |
| `src/app/api/flipper/` | Next.js proxy routes → FastAPI | **Only proxy, no business logic** |
| `src/app/api/poe2/` | Direct POE2Scout routes | Server-side fetch + cache |
| `src/components/dashboard/` | Tab components, dialogs, sidebar, sticky bar | Import from `@lib`, `@hooks` |
| `src/lib/` | Shared utilities, types, store, i18n, proxy, poe2api | **Types in `types.ts` ONLY** |
| `src/hooks/` | React hooks | Import from `@lib` |

## 2. Build & Run Commands

```bash
npm install && npm run dev        # Frontend (port 3000)
npm run build && npm run test     # Build + Jest
pytest tests/ -v                  # Backend tests
npx tsc --noEmit                  # TypeScript type check

# Backend (start.sh creates .venv automatically)
PYTHONPATH=. .venv/bin/python -m uvicorn backend.main:app --reload --port 8000
```

## 3. Critical Rules

1. **Backend responses MUST use snake_case** — flipper-proxy `transformKeys()` converts to camelCase
2. **All API routes use /api/v1/ prefix** — old /api/ paths are removed
3. **Bridge health check MUST use /api/v1/health/ping** — NOT /api/health/ping
4. **response_model= must match route return dict** — mismatch = 500 Internal Server Error
5. **ProcessPoolExecutor: picklable args only** — no sqlite3.Connection, no EventManager
6. **CPU-bound Python → `run_in_executor()` with timeout** — never block event loop
7. **Never hardcode league names or currency categories** — use `config.yaml`
8. **FLIPPER_WORKERS env var** — controls ProcessPoolExecutor workers (default: 1)
9. **SSE proxy: return 200 + error event** — never 503 (prevents console spam + retry storms)

## 4. Known Bugs / Frequent Problems

| Problem | Cause | Fix |
|---------|-------|-----|
| 500 on /api/v1/phase | PhaseResponse.max_hold_time: int but lifecycle returns str | Changed type to str |
| 500 on /api/v1/arbitrage/optimal-currency | OptimalCurrencyResponse schema didn't match route return | Rewrote model to match |
| Bridge kills backend (4/5 unhealthy) | HEALTH_ENDPOINT missing /v1/ prefix | Updated to /api/v1/health/ping |
| 503 on /api/flipper/batch | Cascade: bridge kills backend → circuit breaker opens | Fix bridge health URL |
| ERR_INCOMPLETE_CHUNKED_ENCODING on /prices/stream | routes_sse.py didn't exist (ImportError swallowed) | Created routes_sse.py |
| Flips/triangular return empty | ProcessPoolExecutor pickle error (sqlite3 in snapshot) | Pre-extract picklable data |

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
| GET | `/api/v1/anomalies` | Anomaly detection |
| GET | `/api/v1/storage-value/{currency}` | Hold/sell decision |
| GET | `/api/v1/optimizer/path` | Optimal conversion path |
| GET | `/api/v1/optimizer/matrix` | Conversion matrix |
| GET | `/api/v1/analyst/summary` | League analyst summary |
| GET | `/api/v1/portfolio/correlation` | Correlation matrix |
| GET | `/api/v1/scanner/scan` | Advanced flip scanner |
| GET | `/api/v1/liquid-chain/analysis` | Liquid chain analysis |
| GET | `/api/v1/liquid-chain/opportunities` | Liquid chain opportunities |
