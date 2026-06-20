# PoE2 Market Dashboard — Agent Navigation Guide

> **Single entry point** for codebase navigation. Updated 2026-06-20.
> **Known issues live in [`STATUS.md`](./STATUS.md)** — check there before fixing anything.

---

## 1. Where Things Are

| Directory | Purpose | Rules |
|-----------|---------|-------|
| `backend/` | Python FastAPI analytics engine | Tests mandatory (pytest) |
| `backend/api/` | Route handlers + response models + middleware | Import from `arbitrage/`, `economy/`, `predictors/`, `data/` |
| `backend/api/response_models.py` | Pydantic response models | Must match route return dicts exactly |
| `backend/api/data_snapshot.py` | DataSnapshot — shared TTL-cached snapshot | All routes use `get_snapshot()`, no direct provider calls |
| `backend/api/routes_sse.py` | SSE price stream (BROKEN — see STATUS.md P0-1) | Don't rely on `change_pct` field |
| `backend/api/routes_ws.py` | WebSocket endpoints (BROKEN — see STATUS.md P0-2, P1-1) | Blocks event loop |
| `backend/economy/events.py` | EventManager + StoredEvent | `event_id`, `is_active`, `created_at` |
| `backend/economy/lifecycle.py` | PhaseDetector (BUGGY — see STATUS.md P0-4) | `reset_for_major_patch` semantics broken |
| `backend/arbitrage/` | Scorer, triangular, portfolio, recipe, liquid_chain | No direct API imports |
| `backend/predictors/` | Time-series, anomaly, clustering, storage_value, model_store | CPU-heavy → ProcessPoolExecutor |
| `backend/data/` | Providers, cache, schemas, historical, unified_cache | No imports from `api/` |
| `backend/models/` | Core dataclass models | No framework imports |
| `src/app/api/flipper/` | Next.js proxy routes → FastAPI | **Proxy only, no business logic** |
| `src/app/api/poe2/` | Direct POE2Scout routes | Server-side fetch + cache |
| `src/components/dashboard/` | Tab components, dialogs, sidebar | Import from `@lib`, `@hooks` |
| `src/hooks/` | React hooks (15 hooks) | Import from `@lib` |
| `src/lib/` | Shared utilities, types, store, i18n, proxy, poe2api | **Types in `types.ts` ONLY** |
| `src/lib/flipper-proxy.ts` | Proxy with circuit breaker + dedup | See STATUS.md P1-10, P2-8 |
| `src/hooks/use-websocket.ts` | WS hook (BROKEN — see STATUS.md P1-2) | Opens 2 parallel WS |
| `src/hooks/use-price-stream.ts` | SSE hook (BROKEN — see STATUS.md P0-1, P2-7) | Never invalidates cache |
| `src/components/dashboard/dashboard-page.tsx` | God-component 1705 lines (see STATUS.md P2-1) | Needs splitting |

## 2. Build & Run Commands

```bash
npm install && npm run dev        # Frontend (port 3000)
npm run build && npm run test     # Build + Jest
pytest tests/ -v                  # Backend tests
npx tsc --noEmit                  # TypeScript type check
npx playwright test               # E2E tests

# Backend (start.sh creates .venv automatically)
PYTHONPATH=. .venv/bin/python -m uvicorn backend.main:app --reload --port 8000

# Regenerate OpenAPI schema + TypeScript types
python -c "import json; from backend.main import app; from fastapi.openapi.utils import get_open_api; s=get_open_api(title=app.title,version=app.version,routes=app.routes); open('openapi_schema.json','w').write(json.dumps(s,indent=2,ensure_ascii=False))"
npx openapi-typescript openapi_schema.json --output src/lib/api-types.ts
```

## 3. Critical Rules (invariants)

1. **Backend responses use snake_case** — `flipper-proxy.ts` `transformKeys()` converts to camelCase.
2. **All REST paths use `/api/v1/` prefix.** (Note: WS paths use `/v1/ws/` — see STATUS.md P2-10.)
3. **Bridge health check uses `/api/v1/health/ping`** (NOT `/api/health/ping`).
4. **`response_model=` must match route return dict** — mismatch = 500.
5. **ProcessPoolExecutor: picklable args only** — no `sqlite3.Connection`, no `EventManager`, no `DataSnapshot`, no `AppConfig`. Use `FlipComputeBundle` pattern.
6. **CPU-bound Python → `run_in_executor()` with timeout** — never block event loop. (See STATUS.md P0-2 — `routes_ws.py` violates this.)
7. **Never hardcode league names or currency categories** — use `config.yaml`.
8. **`FLIPPER_WORKERS` env var** — controls ProcessPoolExecutor workers (default: 1).
9. **SSE proxy: return 200 + error event** — not 503 (prevents retry storms).
10. **Mock provider exchange_rates keys MUST be strings** — `"exalted/chaos"`, NOT `("exalted", "chaos")`.
11. **EventData uses `event_id`** (not `id`), `is_active` (not `active`), `created_at` — matches `StoredEvent.to_dict()`.
12. **EventType enum has 6 values**: `major_patch`, `minor_patch`, `league_start`, `economy_shift`, `streamer_hype`, `other`.
13. **Events POST proxy transforms body**: `eventType`→`event_type`, `affectedCurrencies`→`affected_currencies`, `expiryHours`→`expires_at` (ISO string).
14. **PhaseDetector: only `major_patch` resets phase clock** — `league_start` / `economy_shift` affect scoring only. (NOTE: current implementation is buggy — see STATUS.md P0-4.)
15. **Adaptive mode (`"_adaptive"`)**: `baseCurrencyApiId` can be `"_adaptive"` — `useDisplayPrice` auto-selects Div/Exa/Chaos per row.

## 4. Known Issues

**All known issues are in [`STATUS.md`](./STATUS.md)** — categorized by priority P0-P3.

Quick reference for the most common symptoms:

| Symptom | Cause | STATUS.md ID |
|---------|-------|--------------|
| Backend "alive" but `/flips` hangs | Clustering cold-start | P1-4 |
| SSE connected but UI stale | No `change_pct` in payload | P0-1 |
| WS connected but REST slow | Event loop blocked by `_compute_anomalies` | P0-2 |
| `/analyst/summary` weird 24h% | `prices[0]` instead of 24h-ago | P0-3 |
| Phase not reset after major_patch | `max()` in `_reference_date` | P0-4 |
| 500 → "no data" silently | `proxyWithFallback` swallows 5xx | P2-8 |

## 5. API Endpoints (all REST under `/api/v1/`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Detailed health check |
| GET | `/api/v1/health/ping` | Ultra-lightweight ping |
| GET | `/api/v1/phase` | League phase info |
| GET | `/api/v1/currencies` | Currency metadata |
| GET | `/api/v1/prices` | All exchange rates + metrics |
| GET | `/api/v1/prices/heatmap` | 24h price change heatmap |
| GET | `/api/v1/prices/stream` | SSE live price updates (BROKEN — P0-1) |
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
| GET | `/api/v1/analyst/summary` | League analyst summary (BUGGY — P0-3) |
| GET | `/api/v1/portfolio/correlation` | Correlation matrix |
| GET | `/api/v1/scanner/scan` | Advanced flip scanner |
| GET | `/api/v1/liquid-chain/analysis` | Liquid chain analysis |
| GET | `/api/v1/liquid-chain/opportunities` | Liquid chain opportunities |

WebSocket endpoints (different prefix — see STATUS.md P2-10):
- `WS /v1/ws/storage-value/{currency}`
- `WS /v1/ws/forecast/{currency}`
- `WS /v1/ws/anomalies`
- `WS /v1/ws/flips`
- `WS /v1/ws/events`

## 6. Documentation Map

| File | Purpose |
|------|---------|
| `STATUS.md` | **Known issues & refactoring backlog** — read first |
| `REFACTOR_PLAN.md` | Roadmap with priority buckets + DoD |
| `worklog.md` | Recent task entries (≤5 latest) |
| `docs/ARCHITECTURE.md` | Layers, data flow, invariants, principles |
| `docs/DATA_CONTRACTS.md` | TypeScript types, API contracts |
| `docs/DATA_FLOW.md` | Data flow traces, field transforms |
| `docs/BACKEND_GUIDE.md` | FastAPI backend internals |
| `docs/CORS_PROXY_GUIDE.md` | CORS proxy setup |
| `PoE2_Flipper_Canonical_Formulas.md` | Mathematical formulas (NOTE: code diverges — see STATUS.md P1-9) |
