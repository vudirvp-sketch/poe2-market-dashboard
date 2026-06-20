# PoE2 Market Dashboard — Agent Navigation Guide

> **Single entry point** for codebase navigation. Updated 2026-06-20 (iter 58 — WS removed).
> **Known issues live in [`STATUS.md`](./STATUS.md)** — check there before fixing anything.

---

## 1. Where Things Are

| Directory | Purpose | Rules |
|-----------|---------|-------|
| `backend/` | Python FastAPI analytics engine | Tests mandatory (pytest) |
| `backend/api/` | Route handlers + response models + middleware | Import from `arbitrage/`, `economy/`, `predictors/`, `data/` |
| `backend/api/response_models.py` | Pydantic response models | Must match route return dicts exactly |
| `backend/api/data_snapshot.py` | DataSnapshot — shared TTL-cached snapshot | All routes use `get_snapshot()`, no direct provider calls |
| `backend/api/routes_sse.py` | SSE price stream (P0-1 fixed iter 55) | Sends `{pair, change_pct, new_price, old_price, timestamp}` per changed currency; filters by `threshold_pct` |
| `backend/api/routes_analyst.py` | League analyst summary (P0-3 fixed iter 54) | `_compute_trends` uses `find_price_24h_ago` from `backend.economy.pricing` |
| `backend/api/routes_arbitrage.py` | Flips + triangular + clustering (BUGGY — see P1-9) | P0-6 fixed iter 56; P0-5 fixed iter 57 (no dead `prices` param); magic spread numbers |
| `backend/api/routes_optimizer.py` | Bellman-Ford conversion paths (BUGGY — see P1-8) | Loses profitable arbitrage on negative cycles |
| `backend/api/routes_events.py` | Event CRUD + cache invalidation (BUGGY — see P1-7, P1-11) | Fire-and-forget SQLite write; missing daily_stats invalidation |
| `backend/economy/pricing.py` | Unified pricing helpers (P0-5 fixed iter 57) | `compute_transitive_prices` (BFS) + `find_price_24h_ago` — used by `data_snapshot.py`, `scheduler.py`, `routes_arbitrage.py`, `routes_analyst.py` |
| `backend/economy/events.py` | EventManager + StoredEvent | `event_id`, `is_active`, `created_at`; uses deprecated `get_event_loop()` (P3-8) |
| `backend/economy/lifecycle.py` | PhaseDetector (P0-4 fixed iter 54) | `_reference_date` returns `patch_reset_date` unconditionally when set |
| `backend/data/historical.py` | SQLite store for price snapshots + events | Chunked delete needed (P1-6) |
| `backend/data/unified_cache.py` | UnifiedCache with namespaces: `pipeline`, `daily_stats` | `pipeline_cache.invalidate()` clears only `pipeline` namespace |
| `backend/data/pipeline_cache.py` | Shim re-export (P2-2 — delete) | 23 lines, re-exports from `unified_cache.py` |
| `backend/data/daily_stats_cache.py` | Shim re-export (P2-2 — delete) | 23 lines, re-exports from `unified_cache.py` |
| `backend/data/currency_names_ru.py` | 966-line hardcoded dict (P2-3) | Move to JSON |
| `backend/arbitrage/` | Scorer, triangular, portfolio, recipe, liquid_chain | No direct API imports |
| `backend/arbitrage/triangular.py` | Triangular arbitrage (P0-6 fixed iter 56, P0-5 fixed iter 57) | `find_triangular_arbitrage(rates, min_profit_pct, ...)` — no `prices` param (was dead) |
| `backend/predictors/` | Time-series, anomaly, clustering, storage_value, model_store | CPU-heavy → ProcessPoolExecutor |
| `backend/data/providers/` | Poe2Scout, official, base | Network IO only |
| `backend/models/` | Core dataclass models | No framework imports |
| `src/app/api/flipper/` | Next.js proxy routes → FastAPI | **Proxy only, no business logic** |
| `src/app/api/flipper/prices/stream/route.ts` | SSE proxy | 5min timeout, streams body |
| `src/app/api/flipper/events/route.ts` | Events POST proxy with body transform | `eventType`→`event_type`, `expiryHours`→`expires_at` ISO |
| `src/components/dashboard/` | Tab components, dialogs, sidebar | Import from `@lib`, `@hooks` |
| `src/hooks/` | React hooks (14 hooks — `use-websocket.ts` removed iter 58) | Import from `@lib` |
| `src/lib/` | Shared utilities, types, store, i18n, proxy, poe2api | **Types in `types.ts` ONLY** |
| `src/lib/flipper-proxy.ts` | Proxy with circuit breaker + dedup | See STATUS.md P1-10, P2-8; global CB |
| `src/hooks/use-price-stream.ts` | SSE hook (P0-1 fixed iter 55, P2-7 open) | Invalidates cache when `change_pct` ≥ threshold; P2-7 = make targeted by `pair` |
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

# Regenerate OpenAPI schema + TypeScript types (after API contract changes)
python -c "import json; from backend.main import app; from fastapi.openapi.utils import get_open_api; s=get_open_api(title=app.title,version=app.version,routes=app.routes); open('openapi_schema.json','w').write(json.dumps(s,indent=2,ensure_ascii=False))"
npx openapi-typescript openapi_schema.json --output src/lib/api-types.ts
```

## 3. Critical Rules (invariants)

1. **Backend responses use snake_case** — `flipper-proxy.ts` `transformKeys()` converts to camelCase.
2. **All REST paths use `/api/v1/` prefix.** (WS paths removed in iter 58 — see STATUS.md §Fixed.)
3. **Bridge health check uses `/api/v1/health/ping`** (NOT `/api/health/ping`).
4. **`response_model=` must match route return dict** — mismatch = 500.
5. **ProcessPoolExecutor: picklable args only** — no `sqlite3.Connection`, no `EventManager`, no `DataSnapshot`, no `AppConfig`. Use `FlipComputeBundle` pattern.
6. **CPU-bound Python → `run_in_executor()` with timeout** — never block event loop. (WS endpoints removed iter 58 — was the last violation.)
7. **Never hardcode league names or currency categories** — use `config.yaml`.
8. **`FLIPPER_WORKERS` env var** — controls ProcessPoolExecutor workers (default: 1).
9. **SSE proxy: return 200 + error event** — not 503 (prevents retry storms).
10. **Mock provider exchange_rates keys MUST be strings** — `"exalted/chaos"`, NOT `("exalted", "chaos")`.
11. **EventData uses `event_id`** (not `id`), `is_active` (not `active`), `created_at` — matches `StoredEvent.to_dict()`.
12. **EventType enum has 6 values**: `major_patch`, `minor_patch`, `league_start`, `economy_shift`, `streamer_hype`, `other`.
13. **Events POST proxy transforms body**: `eventType`→`event_type`, `affectedCurrencies`→`affected_currencies`, `expiryHours`→`expires_at` (ISO string).
14. **PhaseDetector: only `major_patch` resets phase clock** — `league_start` / `economy_shift` affect scoring only. `reset_for_major_patch()` always wins, even if the patch predates `league_start` (P0-4 fixed iter 54).
15. **Adaptive mode (`"_adaptive"`)**: `baseCurrencyApiId` can be `"_adaptive"` — `useDisplayPrice` auto-selects Div/Exa/Chaos per row.
16. **`pipeline_cache.invalidate()` clears only `pipeline` namespace** — `daily_stats` is separate (see STATUS.md P1-11).
17. **SSE payload contract** (P0-1 fixed iter 55): backend sends `{pair, change_pct, new_price, old_price, timestamp}` per changed currency — matches frontend `SSEPriceUpdate`. `threshold_pct` query param is respected.
18. **Real-time updates = SSE + REST polling only** (iter 58+). WebSocket endpoints were removed in iter 58 — do NOT re-introduce them. If push-based invalidation is needed for non-price data, extend the SSE stream.

## 4. Known Issues

**All known issues are in [`STATUS.md`](./STATUS.md)** — categorized by priority P0-P3 (0 P0 / 8 P1 / 9 P2 / 6 P3). 6 P0 issues fixed in iter 54-58 (see STATUS.md §Fixed).

Quick reference for the most common symptoms:

| Symptom | Cause | STATUS.md ID |
|---------|-------|--------------|
| Backend "alive" but `/flips` hangs | Clustering cold-start | P1-4 |
| SSE connected but UI stale | (Fixed in iter 55 — was P0-1) | — |
| 500 → "no data" silently | `proxyWithFallback` swallows 5xx | P2-8 |
| Stale forecast after event creation | `daily_stats` namespace not invalidated | P1-11 |
| Events lost on backend crash | `create_event` fire-and-forget SQLite | P1-7 |

## 5. API Endpoints (all REST under `/api/v1/`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Detailed health check |
| GET | `/api/v1/health/ping` | Ultra-lightweight ping |
| GET | `/api/v1/phase` | League phase info |
| GET | `/api/v1/currencies` | Currency metadata |
| GET | `/api/v1/prices` | All exchange rates + metrics |
| GET | `/api/v1/prices/heatmap` | 24h price change heatmap |
| GET | `/api/v1/prices/stream` | SSE live price updates (P0-1 fixed iter 55) |
| GET | `/api/v1/prices/{pair}` | Price for specific pair |
| GET | `/api/v1/tiers` | Currency tier classifications |
| GET | `/api/v1/benchmarks/{currency}` | Historical benchmarks |
| GET | `/api/v1/arbitrage/flips` | Scored flip opportunities |
| GET | `/api/v1/arbitrage/triangular` | Triangular arbitrage cycles (P0-6 fixed iter 56, P0-5 fixed iter 57) |
| GET | `/api/v1/arbitrage/optimal-currency` | Optimal payment currency |
| POST | `/api/v1/batch` | Batch multiple GET requests |
| POST | `/api/v1/events` | Create event (BUGGY — P1-7, P1-11) |
| GET | `/api/v1/events` | List events |
| GET | `/api/v1/events/summary` | Event summary |
| GET | `/api/v1/events/{event_id}` | Get event by ID |
| DELETE | `/api/v1/events/{event_id}` | Delete event |
| POST | `/api/v1/events/{event_id}/deactivate` | Deactivate event |
| GET | `/api/v1/anomalies` | Anomaly detection |
| GET | `/api/v1/storage-value/{currency}` | Hold/sell decision |
| GET | `/api/v1/optimizer/path` | Optimal conversion path (BUGGY — P1-8) |
| GET | `/api/v1/optimizer/matrix` | Conversion matrix |
| GET | `/api/v1/analyst/summary` | League analyst summary (P0-3 fixed iter 54 — 24h% now timestamp-aware) |
| GET | `/api/v1/portfolio/correlation` | Correlation matrix |
| GET | `/api/v1/scanner/scan` | Advanced flip scanner (P2-4 — duplicate) |
| GET | `/api/v1/liquid-chain/analysis` | Liquid chain analysis |
| GET | `/api/v1/liquid-chain/opportunities` | Liquid chain opportunities |

(WebSocket endpoints removed in iter 58 — see STATUS.md §Fixed.)

## 6. Documentation Map

| File | Purpose |
|------|---------|
| `STATUS.md` | **Known issues & refactoring backlog** — read first |
| `REFACTOR_PLAN.md` | Roadmap with priority buckets + DoD + recommended fix order |
| `worklog.md` | Recent task entries (≤5 latest) |
| `docs/ARCHITECTURE.md` | Layers, data flow, invariants, principles |
| `docs/DATA_CONTRACTS.md` | TypeScript types, API contracts |
| `docs/DATA_FLOW.md` | Data flow traces, field transforms |
| `docs/BACKEND_GUIDE.md` | FastAPI backend internals |
| `docs/CORS_PROXY_GUIDE.md` | CORS proxy setup |
| `PoE2_Flipper_Canonical_Formulas.md` | Mathematical formulas (NOTE: code diverges — see STATUS.md P1-9, P0-4) |
