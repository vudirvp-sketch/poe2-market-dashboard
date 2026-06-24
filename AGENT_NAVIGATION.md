# PoE2 Market Dashboard — Agent Navigation Guide

> **Single entry point** for codebase navigation. Updated 2026-06-25 (iter 72 — P2-1 steps 2+3 done).
> **Known issues live in [`STATUS.md`](./STATUS.md)** — check there before fixing anything.
> **Product direction lives in [`PRODUCT_VISION.md`](./PRODUCT_VISION.md)** — read it before proposing features.

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
| `backend/api/routes_arbitrage.py` | Flips + triangular + clustering (P1-4 iter 63, P1-9 iter 66, **P2-4 iter 67**) | `/flips` supports `max_score`, `min_spread`, `max_spread`, `cluster`, `currency`, `sort_by`, `sort_dir` (all optional with safe defaults). The standalone `/scanner/scan` endpoint was deleted in iter 68. |
| `backend/api/routes_optimizer.py` | Bellman-Ford conversion paths (P1-8 fixed iter 64) | `_detect_negative_cycle_nodes()` flags profitable arbitrage cycles; `_bellman_ford` returns `None` when target is on a cycle |
| `backend/api/routes_events.py` | Event CRUD + cache invalidation (P1-11 iter 59, P1-7 iter 61) | All 3 endpoints async-await EventManager; `unified_cache` invalidated after mutation |
| `backend/economy/pricing.py` | Unified pricing helpers (P0-5 fixed iter 57) | `compute_transitive_prices` (BFS) + `find_price_24h_ago` |
| `backend/economy/clustering_helpers.py` | Shared clustering data prep + executor function (P1-4 iter 63) | `prepare_clustering_data()` + `run_clustering_sync()` + `CLUSTER_LABELS_CACHE_KEY` |
| `backend/economy/events.py` | EventManager + StoredEvent (P1-7 iter 61, **P3-3 iter 71**) | `event_id`, `is_active`, `created_at`; 4 methods async; `_prune_expired` left sync intentionally. **All in-memory `_events` access guarded by `threading.RLock`**; SQLite writes await OUTSIDE the lock. |
| `backend/economy/lifecycle.py` | PhaseDetector (P0-4 fixed iter 54) | `_reference_date` returns `patch_reset_date` unconditionally when set |
| `backend/data/historical.py` | SQLite store for price snapshots + events | Chunked delete (P1-6 + P3-2 iter 66) — `rowid IN (SELECT ... LIMIT ?)` pattern |
| `backend/data/unified_cache.py` | UnifiedCache with namespaces: `pipeline`, `daily_stats` | Shim modules deleted in iter 66 (P2-2) — import directly |
| `backend/data/currency_names_ru.py` | Thin loader (63 lines) for `currency_names.json` (P2-3 closed iter 70) | Edit `currency_names.json`, not the `.py` |
| `backend/api/data_snapshot.py` | DataSnapshot + SnapshotManager (**P3-4 iter 71**) | Atomic `(snapshot, ts)` swap via immutable `_SnapshotState` dataclass. `_history_cache` + `_active_currencies` guarded by separate `_cache_lock`. `last_snapshot` reads `_state` once. |
| `backend/arbitrage/scorer.py` | Opportunity scoring + quantized analysis (P1-5 fixed iter 66) | `compute_quantized_analysis` uses bounded linear scan `O(1/D)` |
| `backend/arbitrage/triangular.py` | Triangular arbitrage | `find_triangular_arbitrage(rates, min_profit_pct, ...)` — uses `get_process_pool()` (P2-13 fixed iter 65) |
| `backend/main.py` | FastAPI app + lifespan + lazy `process_pool` | `get_process_pool()` lazily creates/recreates the pool (P2-13). Backward-compat: `from backend.main import process_pool` still works via module `__getattr__` but emits `DeprecationWarning`. |
| `backend/predictors/time_series.py` | LightGBM forecaster (**P2-9 iter 67**) | `train()` has adaptive fallback: when `floor (5) <= len(log_prices) < min_points (15)`, uses minimal features (`price_lags=[1]` only) + lowered clean-rows threshold (2 instead of 10). Below `floor`, skips. |
| `backend/predictors/` | Time-series, anomaly, clustering, storage_value, model_store | CPU-heavy → ProcessPoolExecutor |
| `backend/data/providers/` | Poe2Scout, official, base | Network IO only |
| `backend/models/` | Core dataclass models | No framework imports |
| `backend/config.py` | Pydantic config models | `ForecastingConfig.lightgbm_min_data_points_floor` added iter 67 (default 5) |
| `src/app/api/flipper/` | Next.js proxy routes → FastAPI | **Proxy only, no business logic** |
| `src/app/api/flipper/health/circuit-breakers/route.ts` | **P2-6 (iter 67)** — exposes per-endpoint CB state as JSON | Read-only; calls `getAllEndpointCircuitBreakers()` from flipper-proxy |
| `src/app/api/flipper/prices/stream/route.ts` | SSE proxy | 5min timeout, streams body |
| `src/app/api/flipper/events/route.ts` | Events POST proxy with body transform | `eventType`→`event_type`, `expiryHours`→`expires_at` ISO |
| `src/components/dashboard/` | Tab components, dialogs, sidebar | Import from `@lib`, `@hooks` |
| `src/hooks/` | React hooks (14 hooks) | Import from `@lib` |
| `src/lib/` | Shared utilities, types, store, i18n, proxy, poe2api | **Types in `types.ts` ONLY** |
| `src/lib/flipper-proxy.ts` | Proxy with per-endpoint circuit breaker + dedup + mode-aware 5xx fallback (P1-10 iter 66, **P2-8 iter 69**) | `Map<path, EndpointCircuitBreaker>` keyed by normalized path; `proxyWithFallback` passes non-503 5xx through in dev, returns 200+`X-Flipper-Fallback` header in prod. Exports `isFlipperFallbackResponse`, `getFlipperFallbackOriginalStatus`, `FLIPPER_FALLBACK_HEADER` |
| `src/hooks/use-price-stream.ts` | SSE hook (P0-1 iter 55, P2-7 iter 59) | `invalidateCaches(pair)` — per-pair benchmark invalidation |
| `src/components/dashboard/dashboard-page.tsx` | God-component, **1370 lines** (P2-1 steps 1-3 done iter 71-72: was 1685). | Multi-iter split. `ExchangeTabContent` extracted iter 71; `CurrenciesTabContent` / `UniquesTabContent` / `OverviewTabContent` extracted iter 72. Step 4 (iter 73+) — extract `DashboardToolbar` (TabsList + buttons row) + `DashboardDialogs` + `useDashboardData` hook to reach ≤700 lines. |
| `src/components/dashboard/exchange-tab-content.tsx` | Exchange tab content (**P2-1 iter 71**) | Pure presentational component. Takes all state as props from `Dashboard` — no store/i18n imports of its own. Pattern reused by the iter 72 extractions. |
| `src/components/dashboard/currencies-tab-content.tsx` | Currencies tab content (**P2-1 iter 72**) | Pure presentational. Owns data-freshness badge, loading/empty/error states, virtual-vs-static grid switch, pagination. |
| `src/components/dashboard/uniques-tab-content.tsx` | Uniques tab content (**P2-1 iter 72**) | Pure presentational. Owns data-freshness badge, loading/empty/error states, UniqueTable, pagination. |
| `src/components/dashboard/overview-tab-content.tsx` | Overview tab content (**P2-1 iter 72**) | Pure presentational. Composes MarketOverview + ComparativeChart, each wrapped in its own ErrorBoundary. |

## 2. Build & Run Commands

```bash
npm install && npm run dev        # Frontend (port 3000)
npm run build && npm run test     # Build + Jest
pytest tests/ -v                  # Backend tests (skip e2e: --ignore=tests/e2e)
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
2. **All REST paths use `/api/v1/` prefix.** (WS paths removed in iter 58.)
3. **Bridge health check uses `/api/v1/health/ping`** (NOT `/api/health/ping`).
4. **`response_model=` must match route return dict** — mismatch = 500.
5. **ProcessPoolExecutor: picklable args only** — no `sqlite3.Connection`, no `EventManager`, no `DataSnapshot`, no `AppConfig`. Use `FlipComputeBundle` pattern.
6. **CPU-bound Python → `run_in_executor()` with timeout** — never block event loop.
7. **Never hardcode league names or currency categories** — use `config.yaml`.
8. **`FLIPPER_WORKERS` env var** — controls ProcessPoolExecutor workers (default: 1).
9. **SSE proxy: return 200 + error event** — not 503 (prevents retry storms).
10. **Mock provider exchange_rates keys MUST be strings** — `"exalted/chaos"`, NOT `("exalted", "chaos")`.
11. **EventData uses `event_id`** (not `id`), `is_active` (not `active`), `created_at` — matches `StoredEvent.to_dict()`.
12. **EventType enum has 6 values**: `major_patch`, `minor_patch`, `league_start`, `economy_shift`, `streamer_hype`, `other`.
13. **Events POST proxy transforms body**: `eventType`→`event_type`, `affectedCurrencies`→`affected_currencies`, `expiryHours`→`expires_at` (ISO string).
14. **PhaseDetector: only `major_patch` resets phase clock** — `league_start` / `economy_shift` affect scoring only.
15. **Adaptive mode (`"_adaptive"`)**: `baseCurrencyApiId` can be `"_adaptive"` — `useDisplayPrice` auto-selects Div/Exa/Chaos per row.
16. **`pipeline_cache.invalidate()` clears only `pipeline` namespace** — `daily_stats` is separate.
17. **SSE payload contract** (P0-1): `{pair, change_pct, new_price, old_price, timestamp}` per changed currency — matches `SSEPriceUpdate`. `threshold_pct` query param is respected.
18. **Real-time updates = SSE + REST polling only** (iter 58+). WebSocket endpoints were removed in iter 58 — do NOT re-introduce them.
19. **Optimizer negative cycles** (P1-8): a negative cycle in `-log(rate)` space = profitable arbitrage. When `_bellman_ford` detects one and `target` lies on it, returns empty `path` with `data_available: true` — callers fall back to `direct_rate`.
20. **ProcessPoolExecutor is lazy** (P2-13): always call `get_process_pool()` at the call site — never cache the returned reference.
21. **LightGBM adaptive fallback** (P2-9, iter 67): `train()` proceeds with minimal features (`price_lags=[1]`) when `floor (5) <= len(log_prices) < min_points (15)`. Below `floor`, skips. Configurable via `ForecastingConfig.lightgbm_min_data_points_floor`.
22. **Scanner is deleted** (P2-4, iter 68 + iter 69): the standalone `/api/v1/scanner/scan` endpoint and `routes_scanner.py` were removed. All its filter/sort params live on `/api/v1/arbitrage/flips` since iter 67 — use that.
23. **`proxyWithFallback` 5xx handling is mode-aware** (P2-8, iter 69): non-503 5xx (500/502/504) passes through unchanged in dev (`NODE_ENV === "development"`) so devs see the real error; in prod it becomes 200 + fallback data + `X-Flipper-Fallback: <original-status>` header. 503 (backend_offline/insufficient_data) still returns 200 + fallback in both modes (otherwise dev is unusable when backend is down). Use `isFlipperFallbackResponse(res)` / `getFlipperFallbackOriginalStatus(res)` to detect fallback responses from the frontend.

24. **Localized currency/item names live in `backend/data/currency_names.json`** (P2-3, iter 70). `currency_names_ru.py` is a 63-line thin loader — do NOT add names there. Public API unchanged: `CATEGORY_NAMES_RU` / `CATEGORY_NAMES_EN` / `CURRENCY_NAMES_RU` / `CURRENCY_NAMES_EN` dicts + `get_ru_name` / `get_en_name` / `get_category_ru` / `get_category_en` helpers. TS-side mirror `src/lib/currency-names.ts` still exists as an offline fallback — keep both in sync. Regression tests in `tests/test_currency_names_ru.py` enforce RU/EN key parity (run them after every name edit).

25. **EventManager is thread-safe via `threading.RLock`** (P3-3, iter 71). All in-memory `_events` dict access (CRUD + read-side query interfaces like `is_event_active`, `get_event_score_penalty`, `list_events`, `_prune_expired`) is guarded by `self._lock`. The lock is **never held across an `await`** — SQLite writes (`write_event`, `delete_event`, `deactivate_event`, `clear_all_events`) are awaited OUTSIDE the lock. Multi-worker uvicorn still needs a shared external store (Redis/DB) for cross-process coordination; the lock only protects in-process concurrency.

26. **SnapshotManager atomic state swap** (P3-4, iter 71). `(snapshot, ts)` is wrapped in an immutable `@dataclass(frozen=True) _SnapshotState` and stored as a single `self._state` reference. Replacement is a single Python attribute assignment (atomic under the GIL), so a reader either sees the pre-refresh or post-refresh state — never a mixed (stale snapshot, fresh ts) pair. `_history_cache` and `_active_currencies` are guarded by a separate `_cache_lock` (NOT the asyncio lock — these are mutated from sync code paths inside `_refresh`).

## 4. Known Issues

**All known issues are in [`STATUS.md`](./STATUS.md)** — categorized by priority P0-P3 (0 P0 / 0 P1 / 1 P2 / 1 P3).

Quick reference for the most common symptoms:

| Symptom | Cause | STATUS.md ID |
|---------|-------|--------------|
| `dashboard-page.tsx` unmaintainable | 1370-line god-component (down from 1685 in iter 71, 1466 in iter 72). `ExchangeTabContent` + `CurrenciesTabContent` + `UniquesTabContent` + `OverviewTabContent` extracted. Step 4 (toolbar + dialogs + data hook) deferred to iter 73. | P2-1 (in progress) |
| Adding a new Russian translation | Edit `backend/data/currency_names.json` (NOT the `.py` loader). Run `pytest tests/test_currency_names_ru.py`. | — |
| Frontend shows fallback data without notice | (Fixed iter 69 — was P2-8) check `X-Flipper-Fallback` header via `isFlipperFallbackResponse(res)` | — |
| `/scanner/scan` 404 | Endpoint deleted in iter 68 (P2-4 follow-up) — use `/api/v1/arbitrage/flips` with the same params | — |
| `/flips` lacks filter X | (Fixed iter 67 — all scanner params now on `/flips`). The `message` field is now exposed on `FlipsResponse` (P4-1, iter 71). | — |
| Need to inspect circuit breaker state | `GET /api/flipper/health/circuit-breakers` (P2-6 iter 67) | — |
| LightGBM skips for new currency | (Fixed iter 67 — adaptive fallback from `floor=5`) | — |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle — fall back to `direct_rate` (P1-8 iter 64) | — |
| Concurrent EventManager access raises `KeyError` / `dict changed size during iteration` | (Fixed iter 71 — was P3-3) `threading.RLock` guards all in-memory `_events` access | — |
| `SnapshotManager.get_snapshot` returns stale snapshot paired with fresh ts | (Fixed iter 71 — was P3-4) `(snapshot, ts)` wrapped in immutable `_SnapshotState` swapped atomically | — |

## 5. API Endpoints (all REST under `/api/v1/`)

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
| GET | `/api/v1/arbitrage/flips` | Scored flip opportunities (**P2-4 iter 67**: +`max_score`, `min_spread`, `max_spread`, `cluster`, `currency`, `sort_by`, `sort_dir`) |
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
| GET | `/api/v1/optimizer/path` | Optimal conversion path (P1-8 iter 64) |
| GET | `/api/v1/optimizer/matrix` | Conversion matrix |
| GET | `/api/v1/analyst/summary` | League analyst summary |
| GET | `/api/v1/portfolio/correlation` | Correlation matrix |
| GET | `/api/v1/liquid-chain/analysis` | Liquid chain analysis |
| GET | `/api/v1/liquid-chain/opportunities` | Liquid chain opportunities |

**Frontend-only routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/flipper/health` | Proxies backend `/health` |
| GET | `/api/flipper/health/circuit-breakers` | **P2-6 iter 67** — JSON snapshot of per-endpoint circuit breaker state |
| GET | `/api/flipper/{resource}` | Proxies to FastAPI `{resource}` (currencies, prices, flips, etc.) |

(WebSocket endpoints removed in iter 58.)

## 6. Documentation Map

| File | Purpose |
|------|---------|
| `STATUS.md` | **Known issues & refactoring backlog** — read first |
| `PRODUCT_VISION.md` | **Product direction** — analytics helper, NOT a poe2scout/poe2ninja clone. Read before proposing features. |
| `REFACTOR_PLAN.md` | Roadmap with priority buckets + DoD + recommended fix order |
| `worklog.md` | Recent task entries (≤3 latest) |
| `docs/ARCHITECTURE.md` | Layers, data flow, invariants, principles |
| `docs/DATA_CONTRACTS.md` | TypeScript types, API contracts |
| `docs/DATA_FLOW.md` | Data flow traces, field transforms |
| `docs/BACKEND_GUIDE.md` | FastAPI backend internals |
| `docs/CORS_PROXY_GUIDE.md` | CORS proxy setup |
| `PoE2_Flipper_Canonical_Formulas.md` | Mathematical formulas |


