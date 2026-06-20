# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-20 (iter 57 — P0-5 fixed)
> This file is the **single source of truth** for known bugs and refactoring priorities.
> Update it **before** fixing any issue. Cross-reference issue IDs in commits.
>
> **Iter 57 status:** P0-5 fixed and verified. `backend/economy/pricing.py` created (unified `compute_transitive_prices` + `find_price_24h_ago`). `data_snapshot.py` + `scheduler.py` now share the same BFS helper. Dead `prices` param removed from `find_triangular_arbitrage` + `_find_triangular_arbitrage_sync`. 15 new tests in `tests/test_pricing.py`. Backend: 375 pass / 4 skip. e2e: 30 pass / 4 skip. Remaining P0: 1 (P0-2).

---

## P0 — Критичные проблемы (стабильность/корректность) — 1 active

### P0-2. WebSocket endpoints блокируют event loop
- **Файл:** `backend/api/routes_ws.py:415-468` (`_compute_anomalies`), `routes_ws.py:478-522` (`_compute_flips`)
- **Проблема:** `_push_loop` (строка 364) каждые 30с запускает `await compute_fn()` где compute_fn — `_compute_anomalies` (600+ валют, AnomalyDetector.detect = STL+MACD+RSI для каждой) **синхронно в event loop**, без ProcessPoolExecutor. Один WS-клиент = блокировка 30-секундным циклом. Каскад при нескольких клиентах.
- **Решение:** Использовать `loop.run_in_executor(process_pool, _detect_anomalies_sync, ...)` как в `routes_anomalies.py:155-169`. Или полностью удалить WS (см. P1-1).

---

## P1 — Серьёзные (производительность, maintainability)

### P1-1. WS endpoints дублируют REST-логику с урезанными полями
- **Файл:** `backend/api/routes_ws.py:415-522`
- **Проблема:** `_compute_storage_value`, `_compute_forecast`, `_compute_anomalies`, `_compute_flips` — копипаста из REST routes с урезанными полями.
- **Решение:** Удалить WS endpoints (REST + polling достаточно) или вынести computation в общие сервисы.

### P1-2. `useFlipperWebSocket` открывает 2 параллельных WS-соединения
- **Файл:** `src/hooks/use-websocket.ts:507-518`
- **Решение:** Один мультиплексный WS или polling + React Query.

### P1-3. (Resolved by P0-5) `_compute_transitive_prices` — was O(V×E)
- **Closed by iter 57** — the BFS in `backend/economy/pricing.py:compute_transitive_prices` already builds the queue from the seeded `prices_in_base` set, so each currency is enqueued at most once. Effective complexity is O(V+E). Leave this entry here as a historical note until the next doc cleanup.

### P1-4. Кластеризация дублируется между routes_prices и routes_arbitrage
- **Решение:** Один cache key `cluster_labels`, единая helper-функция.

### P1-5. `compute_quantized_analysis` — O(lot_sizes × max_lot_search) на пару
- **Решение:** Бинарный поиск вместо linear scan.

### P1-6. `HistoricalStore._prune_old_league_data` — DELETE без лимитов
- **Решение:** Chunked delete с `await db.commit()` между итерациями.

### P1-7. `EventManager.create_event` — fire-and-forget SQLite write
- **Решение:** Сделать `create_event` async, `await self._store.write_event(event)`.

### P1-8. `routes_optimizer._bellman_ford` — теряет profitable arbitrage
- **Решение:** После max_hops релаксаций — проверить negative cycle.

### P1-9. Spread model — магические числа без теоретической основы
- **Решение:** Вынести в `config.yaml:scoring.spread_model.*`.

### P1-10. `flipper-proxy.ts` circuit breaker — глобальный, не per-endpoint
- **Решение:** Per-endpoint CB (Map<path, CircuitBreaker>).

### P1-11. `routes_events.create_event` не инвалидирует `daily_stats` namespace
- **Решение:** Добавить `daily_stats_cache.invalidate()` после `pipeline_cache.invalidate()`.

---

## P2 — Средние (clean code, dev experience)

- **P2-1.** `dashboard-page.tsx` — 1705 строк, god-component. Разбить на tab-specific подкомпоненты.
- **P2-2.** `pipeline_cache.py` / `daily_stats_cache.py` — shim-модули (23 строки каждый). Удалить, обновить импорты.
- **P2-3.** `currency_names_ru.py` — 966 строк hardcoded словаря. Перенести в JSON.
- **P2-4.** `routes_scanner.py` — дублирует `/flips`. Расширить `/flips` query params или удалить.
- **P2-5.** `routes_auth.py` комментарий в `main.py:516-519`. Удалить.
- **P2-6.** Двойной circuit breaker не синхронизирован. Экспонировать статус CB в `/health`.
- **P2-7.** `usePriceStream` инвалидирует 6 query keys безусловно. Теперь backend шлёт `pair` (P0-1 fixed) — можно делать targeted invalidation.
- **P2-8.** `proxyWithFallback` глушит ВСЕ 5xx → 200. Pass-through в dev, mark fallback в prod.
- **P2-9.** `lightgbm_min_data_points: 15` — adaptive fallback вместо хардкода.
- **P2-10.** WS path prefix `/v1/ws/*` vs REST `/api/v1/*`. Унифицировать.
- **P2-11.** Нет тестов для WS, `/optimizer/*` endpoints. SSE и `/analyst/summary` покрыты (iter 54-55).

---

## P3 — Низкий приоритет (nice-to-have)

- **P3-1.** `routes_ws._compute_anomalies` и `routes_anomalies._detect_anomalies_sync` — два разных пути. Унифицировать после P0-2.
- **P3-2.** `_prune_old_records` — тоже chunked delete.
- **P3-3.** `EventManager` не thread-safe для multi-worker uvicorn.
- **P3-4.** `SnapshotManager._snapshot` swap неатомарный для итераторов.
- **P3-5.** Нет integration-теста на полный `/flips` flow.
- **P3-6.** `.env.example` не включает `NEXT_PUBLIC_FLIPPER_WS_ENABLED`.
- **P3-7.** `REFACTOR_PLAN.md` и `worklog.md` — удалить после закрытия всех issues.
- **P3-8.** `asyncio.get_event_loop()` в `events.py:210` deprecated. Заменить на `asyncio.get_running_loop()`.

---

## Fixed

### P0-5 (fixed in iter 57 — `refactor(P0-5): unified pricing helper + remove dead prices param`) — Transitive prices
- **Was (3 parts):**
  1. **Maintainability:** Three different algorithms for "price of every currency in the base currency" — `_compute_transitive_prices` in `data_snapshot.py` (BFS, correct), `collect_price_snapshot` in `scheduler.py` (5-iter relaxation, buggy), and the dead `prices` parameter in `find_triangular_arbitrage` (passed but never read).
  2. **Correctness bug:** The 5-iteration relaxation in `scheduler.py` silently failed for currencies whose shortest path from the base currency exceeded 5 hops. With ~600 currencies and a sparse pair graph, 5-hop chains are real. The scheduler would then fall back to using `rate.raw_rate` as the price — a wrong value with no log warning.
  3. **Dead parameter:** `find_triangular_arbitrage(rates, prices, ...)` accepted a `prices` dict but the Bellman-Ford path never read it. The hardcode `prices["chaos"] = 1.0` (removed in iter 56, P0-6) only existed to keep the misleading parameter "consistent".
- **Now:**
  - New `backend/economy/pricing.py` exposes `compute_transitive_prices(prices_in_base, rates, base)` (single BFS) and `find_price_24h_ago(history, max_drift_hours)` (extracted from `routes_arbitrage.py` so the analyst route no longer has to import from a sibling `routes_*` module).
  - `data_snapshot.py` and `scheduler.py` both import `compute_transitive_prices` from the new module — the two pricing paths can no longer diverge.
  - The 5-iter relaxation block in `scheduler.py` is deleted entirely.
  - `find_triangular_arbitrage` and `_find_triangular_arbitrage_sync` no longer accept `prices`. The call site in `routes_arbitrage.py:get_triangular_arbitrage` no longer passes it.
  - `routes_analyst.py` now imports `find_price_24h_ago` directly from `backend.economy.pricing` (TODO comment removed).
- **Files changed:** `backend/economy/pricing.py` (NEW), `backend/api/data_snapshot.py`, `backend/scheduler.py`, `backend/api/routes_arbitrage.py`, `backend/api/routes_analyst.py`, `backend/arbitrage/triangular.py`, `tests/test_triangular.py`, `tests/test_pricing.py` (NEW).
- **Tests:** 15 new tests in `tests/test_pricing.py` (7 for `compute_transitive_prices` — including a 7-hop chain regression that the old 5-iter relaxation would have failed — and 8 for `find_price_24h_ago`). Existing `tests/test_triangular.py` updated to drop `prices` param (7/7 pass). Full backend: 375 pass / 4 skip. e2e: 30 pass / 4 skip. No regressions.

### P0-6 (fixed in iter 56 — `fix(P0-6): remove chaos hardcode in triangular arbitrage`) — Triangular numeraire
- **Was:** `backend/api/routes_arbitrage.py:755-770` contained two redundant blocks:
  1. A chaos-normalization block that converted `prices_in_base` from base currency to chaos-normalized when `base_currency != "chaos"`.
  2. A hardcode `prices["chaos"] = 1.0; prices["Chaos Orb"] = 1.0` that ran unconditionally, even when `base_currency == "exalted"` or when `chaos` was missing from the snapshot.
- **Why it broke:** Bellman-Ford path in `_find_triangular_arbitrage_sync` actually uses `rates` only — `prices` is a dead parameter — so the hardcode was misleading dead code, but it would silently corrupt any future logic that consults `prices`. The conditional normalization also created two inconsistent code paths (chaos vs base) for the same concept.
- **Now:** Single numeraire = `config.league.base_currency`. `prices = dict(snapshot.prices_in_base)` is used directly. No chaos normalization, no hardcode. Cleanup of the dead `prices` parameter is deferred to P0-5 (unified pricing helper).
- **Files changed:** `backend/api/routes_arbitrage.py` (16 lines removed, 9-line explanatory comment added).
- **Tests:** Existing `tests/test_triangular.py` (7/7 pass) and `tests/e2e/test_api_e2e.py::test_arbitrage_triangular` (pass) — no regression. No new tests added because the deleted code was dead (no observable behavior to assert).

### P0-1 (fixed in iter 55 — `fix(P0-1): SSE contract fix — remove dead monitor, add change_pct, align payload`) — SSE price stream
- **Was (3 части):**
  1. Dead monitor: `start_sse_monitor()` / `_sse_monitor_loop()` — пустой `asyncio.sleep(60)` loop, wasting task slot.
  2. `threshold_pct` игнорировался — backend отправлял любое изменение.
  3. Contract mismatch: backend отправлял `{type, changes_count, changes: [{api_id, price}], timestamp}`, frontend ожидал `{pair, change_pct, new_price, old_price, timestamp}` → `change_pct` отсутствовал → invalidation никогда не срабатывала.
- **Now:**
  1. Удалён `_sse_monitor_loop`, `start_sse_monitor`, `stop_sse_monitor` + вызовы из `main.py`.
  2. `_sse_event_generator` хранит previous snapshot, вычисляет `change_pct` для changed currencies, фильтрует по `threshold_pct`.
  3. Каждое SSE-сообщение = одна изменённая валюта: `{pair, change_pct, new_price, old_price, timestamp}` — совпадает с `SSEPriceUpdate` в `use-price-stream.ts`.
- **Files changed:** `backend/api/routes_sse.py` (full rewrite), `backend/main.py` (removed start/stop calls), `src/hooks/use-price-stream.ts` (updated `SSEPriceUpdate` interface to required fields).
- **Tests added:** `tests/e2e/test_sse.py` (4 tests):
  - `test_sse_event_format_matches_frontend_contract` — verifies `{pair, change_pct, new_price, old_price, timestamp}` shape.
  - `test_sse_threshold_filters_below_threshold` — 0.18% change filtered, 5% passes.
  - `test_sse_no_event_on_first_snapshot` — baseline recorded, no spurious events.
  - `test_sse_multiple_currencies_change` — each qualifying currency gets its own event.

### P0-3 (fixed in iter 54) — `routes_analyst._compute_trends` 24h change
- Uses `_find_price_24h_ago` — timestamp-aware ±6h drift tolerance. 4 tests in `tests/e2e/test_analyst.py`.

### P0-4 (fixed in iter 54) — `PhaseDetector._reference_date` reset
- `patch_reset_date` возвращается безусловно, без `max()`. Regression-тест в `tests/test_lifecycle.py`.

---

## Частые проблемы (Quick Reference)

| Симптом | Причина | Где фиксить |
|---------|--------|-------------|
| Backend "жив" но `/flips` висит 5-15с | Кластеризация cold-start (P1-4) | `routes_prices.py:259-274` |
| WS подключён но `/anomalies` в REST тормозит | `_push_loop` блокирует event loop (P0-2) | `routes_ws.py:_compute_anomalies` |
| 500 от backend превращается в "no data" | `proxyWithFallback` глушит 5xx (P2-8) | `flipper-proxy.ts:480-485` |
| Event создан но forecast stale | `daily_stats` namespace не инвалидирован (P1-11) | `routes_events.py:135` |
| WS `/flips` не содержит `profit_per_unit_base` | WS возвращает урезанные flips (P1-1) | `routes_ws.py:498-509` |
| После перезапуска backend часть events пропала | `create_event` fire-and-forget SQLite write (P1-7) | `events.py:212` |
