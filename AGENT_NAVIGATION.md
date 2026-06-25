# PoE2 Market Dashboard — Agent Navigation Guide

> **Single entry point** for codebase navigation. Updated 2026-06-25 (iter 79 — F5 backtest shipped).
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
| `backend/economy/pricing.py` | Unified pricing helpers (P0-5 fixed iter 57, F5 extended iter 77) | `compute_transitive_prices` (BFS) + `find_price_24h_ago` + `compute_zscore` (F5) + `compute_percentile` (F5) |
| `backend/economy/clustering_helpers.py` | Shared clustering data prep + executor function (P1-4 iter 63) | `prepare_clustering_data()` + `run_clustering_sync()` + `CLUSTER_LABELS_CACHE_KEY` |
| `backend/economy/events.py` | EventManager + StoredEvent (P1-7 iter 61, **P3-3 iter 71**) | `event_id`, `is_active`, `created_at`; 4 methods async; `_prune_expired` left sync intentionally. **All in-memory `_events` access guarded by `threading.RLock`**; SQLite writes await OUTSIDE the lock. |
| `backend/economy/lifecycle.py` | PhaseDetector (P0-4 fixed iter 54) | `_reference_date` returns `patch_reset_date` unconditionally when set. Used by `phase_hints.py` (iter 78) via `get_phase_detector()` singleton. |
| `backend/economy/phase_hints.py` | **F6 (iter 78)** — phase-aware advisory hints (Temporalis, skill gems, etc.) | Pure function `get_phase_hints(phase, days_since_reference, ...)`. Hardcoded `_PHASE_HINTS` table: 4 hints per phase (EARLY/MID/LATE) + `_PHASE_META` table for phase_label/summary. Does NOT depend on DataSnapshot — uses PhaseDetector only. Always returns `data_available=True`. Helpers `list_phases_with_hints()` + `hint_count_for_phase()` exposed for tests. |
| `backend/economy/content_pulse.py` | **F3 (iter 75)** — daily turnover per category + 7d/30d rolling + signal | Pure function `compute_content_pulse(snapshot, config)`. No side effects. Tunable thresholds at module top (`SIGNAL_RISING_THRESHOLD_PCT=10.0`, `SIGNAL_FALLING_THRESHOLD_PCT=-10.0`, `TOP_N_PER_CATEGORY=3`). |
| `backend/economy/speculation.py` | **F5 (iter 77)** — per-item z-score + BUY/SELL/HOLD signals | Pure function `compute_speculation_signals(snapshot, config, days=30, limit=50, signal_filter="ALL")`. No side effects. Tunable thresholds at module top (`Z_BUY_THRESHOLD=-1.5`, `Z_SELL_THRESHOLD=1.5`, `MAX_HISTORY_POINTS=14`, `MIN_SAMPLE_SIZE=2`, `DEFAULT_DAYS=30`, `DEFAULT_LIMIT=50`). |
| `backend/economy/speculation_backtest.py` | **F5 follow-up (iter 79)** — backtest the z-score BUY/SELL/HOLD strategy on historical price_logs | Pure function `backtest_speculation_signals(snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, limit=50, signal_filter="ALL")`. Reuses `compute_zscore` + `_extract_prices` + `_signal_from_zscore` + `Z_BUY_THRESHOLD`/`Z_SELL_THRESHOLD`/`MIN_SAMPLE_SIZE` from `speculation.py` — guarantees backtest uses the same strategy as the live signal. Returns per-trade results + per-signal aggregates (count, win_rate, mean/median/best/worst return_pct). Tolerance `TOLERANCE_HOURS=24` between target timestamp and nearest price log (matches `storage_value_history.py`). Baseline window strictly BEFORE entry timestamp (entry price not in baseline — no signal leak). |
| `backend/economy/storage_value_history.py` | **F2 follow-up (iter 75)** — time-series of currency/mirror + currency/hinekora ratios | Pure function `compute_storage_value_history(snapshot, currency, days=30)`. Uses 24h nearest-neighbor tolerance for matching timestamps across the three histories. |
| `backend/api/routes_content_pulse.py` | **F3 (iter 75)** — route handler `GET /api/v1/content-pulse` | Thin wrapper: fetch snapshot → call `compute_content_pulse` → shape response. Returns `data_available=false` + empty `categories` list when snapshot is not loaded. |
| `backend/api/routes_speculation.py` | **F5 (iter 77)** — route handler `GET /api/v1/speculation?days=30&limit=50&signal=ALL` | Thin wrapper: fetch snapshot → call `compute_speculation_signals` → shape response. Query params validated by FastAPI (`ge=1, le=90` for days, `ge=1, le=500` for limit, `pattern=^(ALL\|BUY\|SELL\|HOLD)$` for signal). Returns `data_available=false` + empty `signals` list when snapshot is not loaded. |
| `backend/api/routes_speculation_backtest.py` | **F5 follow-up (iter 79)** — route handler `GET /api/v1/speculation/backtest?eval_days_ago=14&holding_days=7&lookback_days=30&limit=50&signal=ALL` | Thin wrapper: fetch snapshot → call `backtest_speculation_signals` → shape response. Query params validated by FastAPI (`ge=1, le=365` for eval_days_ago, `ge=1, le=90` for holding_days/lookback_days, `ge=1, le=500` for limit, `pattern=^(ALL\|BUY\|SELL\|HOLD)$` for signal). Returns `data_available=false` + empty `trades` + zeroed stats blocks when snapshot is not loaded. |
| `backend/api/routes_phase_hints.py` | **F6 (iter 78)** — route handler `GET /api/v1/phase-hints` | Thin wrapper: fetch PhaseDetector singleton → call `detector.get_phase_info()` → forward to `get_phase_hints()` pure function. Always returns `data_available=True` (hint table is hardcoded — does NOT depend on DataSnapshot). On exception returns minimal response with `data_available=False` (no 500). |
| `backend/api/routes_storage_value.py` | Storage value routes (existing `/storage-value/{currency}` + new `/storage-value/{currency}/history` iter 75) | Both routes return `data_available=false` with empty payload when snapshot not loaded — no 503. |
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
| `src/components/dashboard/dashboard-page.tsx` | Parent wiring component, **1216 lines** (iter 74: +15 lines for Storage Value tab wiring). 6 presentational subcomponents extracted in iter 71-73. | Optional follow-up: `useDashboardData` hook for the ~250 lines of useQuery/memo wiring (deferred — high interdependency risk). |
| `src/components/dashboard/dashboard-toolbar.tsx` | Toolbar (TabsList + action buttons + category chips) (**P2-1 iter 73, step 4a**) | Pure presentational. Owns the tab strip + keyboard-shortcuts/alerts/comparison/pair-comparison buttons + the currencies/uniques category-filter chip strip. Tab switching still goes through the parent `<Tabs onValueChange=...>` scope. |
| `src/components/dashboard/dashboard-dialogs.tsx` | Dialog/sheet/banner wrappers (**P2-1 iter 73, step 4b**) | Pure presentational. Wraps DetailDialog, PairDetailDialog, ComparisonDialog, PairComparisonDialog, PriceAlertDialog, EventsSidebar, OfflineBanner, ShortcutsDialog — 8 primitives that sit at the bottom of the Dashboard render tree. Each open/close flag is a prop. |
| `src/components/dashboard/exchange-tab-content.tsx` | Exchange tab content (**P2-1 iter 71**) | Pure presentational component. Takes all state as props from `Dashboard` — no store/i18n imports of its own. Pattern reused by the iter 72-73 extractions. |
| `src/components/dashboard/currencies-tab-content.tsx` | Currencies tab content (**P2-1 iter 72**) | Pure presentational. Owns data-freshness badge, loading/empty/error states, virtual-vs-static grid switch, pagination. |
| `src/components/dashboard/uniques-tab-content.tsx` | Uniques tab content (**P2-1 iter 72**) | Pure presentational. Owns data-freshness badge, loading/empty/error states, UniqueTable, pagination. |
| `src/components/dashboard/overview-tab-content.tsx` | Overview tab content (**P2-1 iter 72**, updated iter 76) | Pure presentational. Composes 3 panels, each wrapped in its own ErrorBoundary: ContentPulseWidget (F4 iter 76, mounted FIRST for first-load visibility) + MarketOverview + ComparativeChart. |
| `src/components/dashboard/storage-value-tab.tsx` | Storage Value tab (**F2 iter 74 + iter 75**) | Wraps the existing `/api/v1/storage-value/{currency}` endpoint. Lazy-loaded, ErrorBoundary-wrapped. Currency picker (default list of 14 canonical currencies) + horizon picker (1/6/24/48/168h) + quantity input + Compute button. Renders: decision card (BUY_HOLD / SELL_CONVERT / NEUTRAL with hint), projection breakdown (current/projected/risk-discount/adjusted/net/ratio), holdings totals (×quantity), inputs panel (momentum/volatility/acceleration/liquidity/α/horizon), historical chart (iter 75). Full i18n (en/ru/zh/ko). Backend offline → offline card with start-backend hint. data_available=false → "no price history" notice. 12 jest tests in `src/__tests__/storage-value-tab.test.tsx`. |
| `src/components/dashboard/storage-value-history-chart.tsx` | Storage Value history chart (**F2 follow-up iter 75**) | Dependency-free SVG line chart (~290 lines) rendering two ratios: `currency/mirror` (blue) and `currency/hinekora` (emerald). Fetches via `useQuery` bound to `/api/flipper/storage-value/[currency]/history?days=30`. Graceful degradation: <2 points → "no history" notice; all-null ratios → "no reference data" notice; loading → spinner text. 11 jest tests in `src/__tests__/storage-value-history-chart.test.tsx`. |
| `src/components/dashboard/content-pulse-widget.tsx` | Content Pulse widget — «Что фармить сегодня» (**F4 iter 76**) | Two-column card showing top rising (emerald) + falling (red) league mechanic categories with per-category `delta_7d_pct` badge + top-3 movers (`trend_pct` per item). Fetches via `useQuery` (60s staleTime) bound to `/api/flipper/content-pulse`. Mounted FIRST in `overview-tab-content.tsx` (above MarketOverview) so it's visible on first dashboard load — wrapped in its own `<ErrorBoundary>`. Graceful degradation: backendOffline → compact amber notice (no full-card takeover); loading → spinner text; error → error card + refresh button; data_available=false → "no data yet"; all categories stable → "no signals today"; empty top_rising/top_falling → "no movers" per category. `maxPerSide` prop (default 2) caps category count per column. 16 jest tests in `src/__tests__/content-pulse-widget.test.tsx`. |
| `src/components/dashboard/speculation-tab.tsx` | Speculation tab — BUY/SELL/HOLD per item (**F5 iter 77**) | Renders a sortable list of currencies with per-item z-score (vs N-day rolling mean/std) + percentile + BUY/SELL/HOLD signal badge + horizon hint + dependency-free SVG mini-sparkline (last 14 price points). Filter chips (ALL/BUY/SELL/HOLD), days selector (7/14/30/90). Fetches via `useQuery` (30s staleTime) bound to `/api/flipper/speculation?days={days}&limit=50&signal={filter}`. Lazy-loaded via `next/dynamic`, wrapped in `<ErrorBoundary>`. Tab is in `TAB_MAP` at index 9 (between `storage-value` and `liquid-chain`) for keyboard-shortcut navigation. Tab trigger in `dashboard-toolbar.tsx` (Sparkles icon). Graceful degradation: backendOffline → offline card + hint; loading → spinner text; error → error card + refresh; data_available=false → "no data yet" notice; empty signals → "no actionable signals" notice. 18 jest tests in `src/__tests__/speculation-tab.test.tsx`. |
| `src/components/dashboard/phase-hints-widget.tsx` | Phase-aware hints widget — «League Phase Hints» (**F6 iter 78**) | Static info banner mounted BELOW ContentPulseWidget in `overview-tab-content.tsx`. Shows current phase badge (emerald/violet/amber for EARLY/MID/LATE) + day count + reference currency + phase summary + bulleted hint list (each row: bullet + title + detail + action). Fetches via `useQuery` (5min staleTime — phase only changes daily) bound to `/api/flipper/phase-hints`. Wrapped in `<ErrorBoundary fallbackTitle={t("fallbackPhaseHints")}>`. Graceful degradation: backendOffline → compact amber notice; loading → spinner; error → card + refresh; data_available=false → "no data" notice; empty hints → "no hints" notice. 26 jest tests in `src/__tests__/phase-hints-widget.test.tsx`. |

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

27. **Storage Value tab** (F2, iter 74). The new tab at `src/components/dashboard/storage-value-tab.tsx` is a UI-only wrapper — it does NOT add any new backend route. It calls the existing `GET /api/v1/storage-value/{currency}` endpoint (via the existing `/api/flipper/storage-value/[currency]` proxy). The tab is lazy-loaded via `next/dynamic` (chunk only loads when user navigates to it) and wrapped in `<ErrorBoundary>` so a render error in the tab doesn't crash the whole dashboard. The tab is in `TAB_MAP` at index 9 (between `analyst` and `liquid-chain`) for keyboard-shortcut navigation. The tab trigger is in `dashboard-toolbar.tsx` (Gem icon). StorageValueResponse type extended with optional `totalCurrentValue` / `totalProjectedValue` / `totalNetValue` fields — these are returned by the backend (see `routes_storage_value.py` lines 134-137) but were missing from the TS type.

28. **Storage Value History endpoint** (F2 follow-up, iter 75). `GET /api/v1/storage-value/{currency}/history?days=30` returns a time-series of `price(currency) / price(mirror)` and `price(currency) / price(hinekora)` ratios. For each timestamp in the currency's price history, the backend finds the nearest mirror/hinekora price point within a **24h tolerance** (see `backend/economy/storage_value_history.py:_find_nearest_price`). Points beyond tolerance emit `mirror_price=None` / `hinekora_price=None` and corresponding `ratio_*=None` — the frontend chart renders gaps in the line for these points (using `M` instead of `L` in the SVG path). When ALL ratios are null (e.g. mirror/hinekora not traded in the current league), the chart shows a "no reference data" notice instead of an empty chart. The Next.js proxy lives at `src/app/api/flipper/storage-value/[currency]/history/route.ts` and returns an empty `points` array with `dataAvailable: false` when the backend is offline (no 503).

29. **Content Pulse endpoint** (F3, iter 75). `GET /api/v1/content-pulse` returns per-category trade volume + 7d/30d rolling deltas + top movers. The heavy lifting is in `backend/economy/content_pulse.py:compute_content_pulse()` — a **pure function** (no side effects, no I/O) that takes a `DataSnapshot` + `AppConfig` and returns a dict. The route handler in `routes_content_pulse.py` is a thin wrapper that fetches the snapshot and calls the function. This separation makes the logic testable without spinning up FastAPI. Signal thresholds are module-level constants (NOT in config.yaml): `SIGNAL_RISING_THRESHOLD_PCT=10.0`, `SIGNAL_FALLING_THRESHOLD_PCT=-10.0`. `delta_7d_pct` is `null` (not 0) when there's no historical data — the frontend should treat `null` as "no signal yet" rather than "stable". Categories with no items in the snapshot still emit a row (with `item_count: 0`) so the UI can render "0 items / no data" rather than hiding the category entirely.

30. **Content Pulse widget wiring** (F4, iter 76). The widget at `src/components/dashboard/content-pulse-widget.tsx` is mounted FIRST inside `overview-tab-content.tsx` — ABOVE MarketOverview — so users see actionable farming signals on first dashboard load. The widget is wrapped in its own `<ErrorBoundary fallbackTitle={t("fallbackContentPulse")}>` so a render failure in the widget doesn't blank out MarketOverview or ComparativeChart. The widget consumes `/api/flipper/content-pulse` (Next.js proxy → `/api/v1/content-pulse`) via `useQuery` with 60s staleTime (rolling 7d average changes slowly). `maxPerSide` prop (default 2) caps how many rising + falling categories are shown — keep this small to preserve the 1-glance UX per PRODUCT_VISION §3.6. The widget only surfaces categories with `signal="rising"` or `signal="falling"` (|delta_7d_pct| ≥ 10%); stable categories are filtered out as noise.

31. **Speculation tab wiring** (F5, iter 77). The tab at `src/components/dashboard/speculation-tab.tsx` is lazy-loaded via `next/dynamic` (chunk only loads when user navigates to it) and wrapped in `<ErrorBoundary fallbackTitle={t("fallbackSpeculation")}>` so a render error doesn't crash the whole dashboard. The tab is in `TAB_MAP` at index 9 (between `storage-value` at 8 and `liquid-chain` at 10) for keyboard-shortcut navigation. Tab trigger in `dashboard-toolbar.tsx` (Sparkles icon, between Gem and Droplets). The tab consumes `/api/flipper/speculation` (Next.js proxy → `/api/v1/speculation`) via `useQuery` with 30s staleTime. Query params: `days` (7/14/30/90, default 30), `limit=50`, `signal` (ALL/BUY/SELL/HOLD, default ALL). The proxy forwards all query params to the backend and returns empty `signals: []` + `dataAvailable: false` when the backend is offline (no 503). Z-score thresholds: BUY when z < -1.5, SELL when z > +1.5, HOLD when |z| ≤ 1.5 (inclusive boundaries → HOLD). Population std (ddof=0) used — minimum 2 valid price points required for non-null z-score. Items with std=0 (all prices identical) are excluded from the result list (no actionable signal).

32. **Phase-aware hints widget wiring** (F6, iter 78). The widget at `src/components/dashboard/phase-hints-widget.tsx` is mounted SECOND inside `overview-tab-content.tsx` — directly BELOW ContentPulseWidget and ABOVE MarketOverview — so users see phase-aware advisory context (Temporalis, skill gems 18-20 lvl, vault keys, etc.) alongside the live farming signals on first dashboard load. The widget is wrapped in its own `<ErrorBoundary fallbackTitle={t("fallbackPhaseHints")}>` so a render failure doesn't blank out ContentPulseWidget or MarketOverview. The widget consumes `/api/flipper/phase-hints` (Next.js proxy → `/api/v1/phase-hints`) via `useQuery` with **5min staleTime** — the league phase only changes once per day at most (when `days_since_reference` crosses the early/mid or mid/late boundary), so 5min is plenty. The backend route fetches the global `PhaseDetector` singleton via `get_phase_detector()` (from `backend/api/shared.py`), calls `detector.get_phase_info()` to get phase + days_since_reference + reference_currency, then forwards to the pure function `get_phase_hints()` in `backend/economy/phase_hints.py`. **Does NOT depend on DataSnapshot** — the hint table is hardcoded (`_PHASE_HINTS` dict in `phase_hints.py`) and always returns `data_available=True`. The only way `data_available` is false is if `get_phase_detector()` raises an exception (e.g. config.league.league_start_date is invalid). Phase badge color: early → emerald, mid → violet, late → amber, unknown → muted. Hint slugs (e.g. `mid-skill-gems-18-20`) are stable identifiers used in `data-testid` attributes — keep them stable across refactors so tests don't break.

33. **Speculation backtest is a SEPARATE endpoint** (F5 follow-up, iter 79). The backtest lives at `GET /api/v1/speculation/backtest` — NOT as a query-param mode on `/api/v1/speculation`. Rationale: a backtest iterates every item with enough price history and is significantly more expensive than the live signal computation. Keeping it as a separate route makes the cost opt-in — the live Speculation tab can still fetch `/api/v1/speculation` cheaply without triggering backtest logic. The pure function `backtest_speculation_signals()` lives in `backend/economy/speculation_backtest.py` (NOT `speculation.py`) and **reuses** `compute_zscore` (from `pricing.py`) + `_extract_prices` + `_signal_from_zscore` + the `Z_BUY_THRESHOLD` / `Z_SELL_THRESHOLD` / `MIN_SAMPLE_SIZE` constants from `speculation.py` — guarantees the backtest uses the same strategy as the live signal. The baseline window is **strictly BEFORE** the entry timestamp — entry price itself is NOT in the baseline (no signal leak). `TOLERANCE_HOURS=24` between target timestamp and nearest price log (matches `storage_value_history.py:_NEAREST_PRICE_TOLERANCE_HOURS`). Aggregates (`buy_stats` / `sell_stats` / `overall_stats`) are computed over ALL trades — the `limit` query param only narrows the per-trade `trades` list, NOT the stats. `unevaluated_count` counts items with an actionable signal (BUY/SELL) but no exit price within tolerance (e.g. holding period extends past the last observed price). Return sign convention: BUY → `(exit-entry)/entry*100` (profit when price rises); SELL → `(entry-exit)/entry*100` (profit when price falls — short-sale equivalent). HOLD signals never produce trades (no position taken) but ARE counted in `signal_breakdown.HOLD`. No frontend UI yet — backend-only. Adding a Backtest panel to the Speculation tab is a safe follow-up that doesn't break the existing UI.

## 4. Known Issues

**All technical-debt issues are closed** (P0=0, P1=0, P2=0, P3=0, P4=0). Switch focus to product features in `PRODUCT_VISION.md` (F1–F6). See `STATUS.md` for the current product-feature status table.

Quick reference for the most common symptoms:

| Symptom | Cause | STATUS.md ID |
|---------|-------|--------------|
| Adding a new Russian translation | Edit `backend/data/currency_names.json` (NOT the `.py` loader). Run `pytest tests/test_currency_names_ru.py`. | F1 (blocked) |
| Frontend shows fallback data without notice | check `X-Flipper-Fallback` header via `isFlipperFallbackResponse(res)` | — |
| `/scanner/scan` 404 | Endpoint deleted in iter 68 — use `/api/v1/arbitrage/flips` with the same params | — |
| Need to inspect circuit breaker state | `GET /api/flipper/health/circuit-breakers` | — |
| LightGBM skips for new currency | (Fixed iter 67 — adaptive fallback from `floor=5`) | — |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle — fall back to `direct_rate` | — |
| Concurrent EventManager access raises `KeyError` / `dict changed size during iteration` | (Fixed iter 71) `threading.RLock` guards all in-memory `_events` access | — |
| `SnapshotManager.get_snapshot` returns stale snapshot paired with fresh ts | (Fixed iter 71) `(snapshot, ts)` wrapped in immutable `_SnapshotState` swapped atomically | — |
| `dashboard-page.tsx` still 1216 lines | Optional follow-up: extract `useDashboardData` hook for ~250 lines of useQuery/memo wiring. Not blocking. | — |
| Storage Value tab shows "no price history" | Backend reachable but `price_histories[currency]` is empty. Try `divine` / `exalted` / `chaos` first. | F2 (done) |
| Storage Value history chart shows "no history" | Currency has <2 price points in last 30 days, OR all mirror/hinekora ratios are null. | F2 (done) |
| `/api/v1/content-pulse` returns `data_available: false` | Snapshot not loaded yet, OR no items in any configured category. | F3 (done) |
| Content Pulse `delta_7d_pct` is `null` | No historical price_logs for any item in that category — only today's volume is known. Not a bug. | F3 (done) |
| Content Pulse widget shows "no signals today" | All categories have `signal="stable"` (|delta_7d_pct| < 10%). Correct behavior — widget only surfaces strong signals. | F4 (done) |
| Content Pulse widget shows "no movers" for a category | Category has signal but its items lack ≥2 price points to compute per-item trend. Will populate as scheduler collects more data. | F4 (done) |
| `/api/v1/speculation` returns `data_available: false` | Snapshot not loaded, OR no item has ≥2 valid price points in the requested `days` window. | F5 (done) |
| Speculation tab shows "no actionable signals" | All items have `|z_score| < 1.5` — prices are within ±1.5σ of their recent mean. Try widening days (90 instead of 30). | F5 (done) |
| Speculation z-score is null for an item | Item has <2 valid price points, OR all prices are identical (std=0). Both → excluded from the result list. | F5 (done) |
| `/api/v1/phase-hints` returns `data_available: false` | Only happens if PhaseDetector cannot be constructed (e.g. config.league.league_start_date is invalid). Otherwise always True — hint table is hardcoded. | F6 (done) |
| Phase hints widget shows wrong phase | Phase computed from `days_since_reference` since `league_start_datetime` (or last `major_patch` event). Check `config.yaml:league.league_start_date` matches actual league start. | F6 (done) |
| `/api/v1/speculation/backtest` returns `data_available: false` | Snapshot not loaded, OR no item has price_logs spanning both the eval timestamp and exit timestamp. Try widening `eval_days_ago`. | F5 (done) |
| Speculation backtest returns `evaluated_count=0` but `unevaluated_count>0` | Items have actionable signal at entry but no price log within 24h of exit — holding period extends past last observed price. Decrease `holding_days` or wait for more data. | F5 (done) |
| Speculation backtest `trades` list shorter than `overall_stats.count` | `limit` query param caps per-trade list (default 50). Aggregates computed over ALL trades. Raise `limit` for full list. | F5 (done) |

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
| GET | `/api/v1/storage-value/{currency}/history` | **F2 follow-up (iter 75)** — time-series of currency/mirror + currency/hinekora ratios |
| GET | `/api/v1/optimizer/path` | Optimal conversion path (P1-8 iter 64) |
| GET | `/api/v1/optimizer/matrix` | Conversion matrix |
| GET | `/api/v1/analyst/summary` | League analyst summary |
| GET | `/api/v1/portfolio/correlation` | Correlation matrix |
| GET | `/api/v1/liquid-chain/analysis` | Liquid chain analysis |
| GET | `/api/v1/liquid-chain/opportunities` | Liquid chain opportunities |
| GET | `/api/v1/content-pulse` | **F3 (iter 75)** — per-category turnover + 7d/30d rolling + top movers |
| GET | `/api/v1/speculation` | **F5 (iter 77)** — per-item z-score + BUY/SELL/HOLD signals. Query: `days` (1-90, default 30), `limit` (1-500, default 50), `signal` (ALL/BUY/SELL/HOLD, default ALL). |
| GET | `/api/v1/speculation/backtest` | **F5 follow-up (iter 79)** — backtest z-score signals on historical price_logs. Query: `eval_days_ago` (1-365, default 14), `holding_days` (1-90, default 7), `lookback_days` (1-90, default 30), `limit` (1-500, default 50), `signal` (ALL/BUY/SELL/HOLD, default ALL). Returns per-trade results + per-signal aggregates (win_rate, mean/median/best/worst return_pct). Backend-only — no frontend UI yet. |
| GET | `/api/v1/phase-hints` | **F6 (iter 78)** — phase-aware advisory hints (Temporalis, skill gems, etc.). No query params. Always returns `data_available=True` (hint table is hardcoded). |

**Frontend-only routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/flipper/health` | Proxies backend `/health` |
| GET | `/api/flipper/health/circuit-breakers` | **P2-6 iter 67** — JSON snapshot of per-endpoint circuit breaker state |
| GET | `/api/flipper/content-pulse` | **F4 (iter 76)** — Next.js proxy to `/api/v1/content-pulse`. Returns empty `categories: []` + `dataAvailable: false` when backend is offline. |
| GET | `/api/flipper/speculation` | **F5 (iter 77)** — Next.js proxy to `/api/v1/speculation`. Forwards `days`/`limit`/`signal` query params. Returns empty `signals: []` + `dataAvailable: false` when backend is offline. |
| GET | `/api/flipper/phase-hints` | **F6 (iter 78)** — Next.js proxy to `/api/v1/phase-hints`. No query params. Returns empty `hints: []` + `dataAvailable: false` when backend is offline. |
| GET | `/api/flipper/{resource}` | Proxies to FastAPI `{resource}` (currencies, prices, flips, etc.) |

(WebSocket endpoints removed in iter 58.)

## 6. Documentation Map

| File | Purpose |
|------|---------|
| `STATUS.md` | **Known issues & refactoring backlog** — read first |
| `PRODUCT_VISION.md` | **Product direction** — analytics helper, NOT a poe2scout/poe2ninja clone. Read before proposing features. |
| `docs/ARCHITECTURE.md` | Layers, data flow, invariants, principles |
| `docs/DATA_CONTRACTS.md` | TypeScript types, API contracts |
| `docs/DATA_FLOW.md` | Data flow traces, field transforms |
| `docs/BACKEND_GUIDE.md` | FastAPI backend internals |
| `docs/CORS_PROXY_GUIDE.md` | CORS proxy setup |
| `PoE2_Flipper_Canonical_Formulas.md` | Mathematical formulas |

> **Note:** `REFACTOR_PLAN.md` and `worklog.md` were deleted in iter 73 (P3-7) after all P2/P3 issues were closed. For old task history see `git log`.


