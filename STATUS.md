# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-20 | **Source:** Full codebase audit (analysis iter 52)
> This file is the **single source of truth** for known bugs and refactoring priorities.
> Update it **before** fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Критичные проблемы (стабильность/корректность)

### P0-1. SSE — мёртвый монитор, без пороговой фильтрации
- **Файл:** `backend/api/routes_sse.py`
- **Проблема:** `start_sse_monitor()` / `_sse_monitor_loop()` — пустой цикл `asyncio.sleep(60)`, не делает ничего. Реальные обновления — polling с интервалом 5с в каждом подключении. `threshold_pct` (query param) **игнорируется**. Backend не отправляет `change_pct` в payload → фронтенд-хук `use-price-stream.ts` никогда не триггерит инвалидацию React Query.
- **Решение:** Удалить мёртвый monitor; в `_sse_event_generator` сравнивать предыдущий snapshot с текущим, вычислять реальные `change_pct` для changed currencies, фильтровать по `threshold_pct` и отправлять только significant updates. Или отказаться от SSE в пользу polling + `If-Modified-Since`.

### P0-2. WebSocket endpoints блокируют event loop
- **Файл:** `backend/api/routes_ws.py`
- **Проблема:** `_push_loop` каждые 30с запускает `_compute_anomalies` (600+ валют, STL+MACD+RSI) **синхронно в event loop**, без ProcessPoolExecutor. Один WS-клиент = блокировка 30-секундным циклом. Каскад при нескольких клиентах.
- **Решение:** Использовать `loop.run_in_executor(process_pool, _detect_anomalies_sync, ...)` как в `routes_anomalies.py`. Или полностью удалить WS в пользу polling (WebSocket endpoints всё равно дублируют REST-логику — см. P1-1).

### P0-3. `routes_analyst._compute_trends` — неверная метрика "24h change"
- **Файл:** `backend/api/routes_analyst.py:43`
- **Проблема:** `price_24h_ago = prices[0]` — берётся первая точка истории (неделю назад), а не цена 24ч назад. Все `change_24h_pct` в `/analyst/summary` неверны.
- **Решение:** Использовать `_find_price_24h_ago` из `routes_arbitrage.py` или вынести в общий helper.

### P0-4. `PhaseDetector.reset_for_major_patch` — некорректный reset
- **Файл:** `backend/economy/lifecycle.py:80-84`
- **Проблема:** `_reference_date()` возвращает `max(league_start, patch_reset_date)`. Если патч вышел раньше старта лиги, фаза не сбрасывается. По спеке major_patch всегда должен сбрасывать фазу.
- **Решение:** Заменить логику на: если есть `patch_reset_date` — использовать его, игнорируя `max()` с `league_start`.

### P0-5. Дублирование логики transitive prices — 3 разные реализации
- **Файлы:** `backend/api/data_snapshot.py:_compute_transitive_prices` (BFS), `backend/scheduler.py:collect_price_snapshot` (5-итерационный relaxation), `backend/api/routes_arbitrage.py:get_triangular_arbitrage` (chaos-normalization)
- **Проблема:** Три разных алгоритма для одной концепции → несогласованные `prices_in_base` между /flips, /triangular и SQLite.
- **Решение:** Вынести в единый helper в `backend/economy/pricing.py`, использовать во всех трёх местах.

### P0-6. `prices["chaos"] = 1.0; prices["Chaos Orb"] = 1.0` — хардкод в Bellman-Ford
- **Файл:** `backend/api/routes_arbitrage.py:769-770`
- **Проблема:** Жёстко переопределяет цену chaos для triangular arbitrage, даже если base_currency=exalted. Сломается при смене лиги или отсутствии chaos в данных.
- **Решение:** Использовать единый numeraire (base_currency), не нормализовать к chaos.

---

## P1 — Серьёзные (производительность, maintainability)

### P1-1. WS endpoints дублируют REST-логику
- **Файл:** `backend/api/routes_ws.py`
- **Проблема:** `_compute_storage_value`, `_compute_forecast`, `_compute_anomalies`, `_compute_flips` — копипаста из REST routes. Расхождение в полях (WS возвращает урезанные flips). Поддержка = ад.
- **Решение:** Либо удалить WS endpoints (REST + polling достаточно), либо вынести computation в общие сервисы, которые вызываются и из REST, и из WS.

### P1-2. `useFlipperWebSocket` открывает 2 параллельных WS-соединения
- **Файл:** `src/hooks/use-websocket.ts:507-518`
- **Проблема:** При callback-API хук открывает `/ws/flips` и `/ws/anomalies` одновременно. Двойная нагрузка на backend, каждый со своей reconnect-логикой. Возвращает только flips-данные, anomalies теряются (только trigger callback).
- **Решение:** Один мультиплексный WS или polling + React Query.

### P1-3. `_compute_transitive_prices` — O(V×E) вместо O(V+E)
- **Файл:** `backend/api/data_snapshot.py:171-210`
- **Проблема:** BFS проверяет ВСЕ edges на каждом шаге (`for key, rate in rates.items()` внутри `while queue`). Для 600 валют × 1800 пар = 1.08M ops вместо 2400.
- **Решение:** Построить adjacency list один раз, итерироваться по neighbors.

### P1-4. Кластеризация дублируется между routes_prices и routes_arbitrage
- **Файлы:** `backend/api/routes_prices.py:196-283` (cache key `price_cluster_labels`), `backend/api/routes_arbitrage.py:191-249` (cache key `arbitrage_cluster_labels`, но не записывается обратно из subprocess)
- **Проблема:** `/prices` кэширует кластеризацию, `/flips` — пересчитывает каждый раз. Wasted work + несогласованность.
- **Решение:** Один cache key, единая helper-функция, запись в кэш после subprocess-возврата.

### P1-5. `compute_quantized_analysis` — O(lot_sizes × max_lot_search) на пару
- **Файл:** `backend/arbitrage/scorer.py` (вызывается в `_build_flip_opportunities_sync`)
- **Проблема:** 5 lot_sizes × 10000 max_lot_search = 50000 ops на пару. Для 600 пар = 30M ops в subprocess. Медленно.
- **Решение:** Бинарный поиск вместо linear scan по lot_sizes.

### P1-6. `HistoricalStore._prune_old_league_data` — DELETE без лимитов
- **Файл:** `backend/data/historical.py:146-188`
- **Проблема:** При смене лиги `DELETE FROM price_snapshots WHERE league = ?` без LIMIT. На проде с большим DB — транзакция пухнет до GB, блокирует другие writes.
- **Решение:** Chunked delete (1000 строк за итерацию, commit между итерациями).

### P1-7. `routes_events.create_event` — fire-and-forget SQLite write
- **Файл:** `backend/economy/events.py:create_event`
- **Проблема:** `asyncio.create_task(self._store.write_event(...))` — не await'ится. Если backend упадёт в течение секунды — событие потеряно (есть только в памяти).
- **Решение:** `await self._store.write_event(...)` или гарантированная запись через `asyncio.shield()`.

### P1-8. `routes_optimizer._bellman_ford` — теряет profitable arbitrage
- **Файл:** `backend/api/routes_optimizer.py:99-103`
- **Проблема:** `visited` set в path reconstruction возвращает `None` при цикле. Но при negative cycle (arbitrage!) predecessor map может содержать цикл → теряем прибыльные пути.
- **Решение:** Detect negative cycle через N-ю релаксацию (V-я итерация с обновлениями → negative cycle), отдельно восстановить cycle из predecessor map.

### P1-9. Spread model — магические числа без теоретической основы
- **Файл:** `backend/api/routes_arbitrage.py:283-300`
- **Проблема:** `0.04`, `40.0`, `0.5`, `1.5`, `0.005`, `0.15`, `0.20` — захардкожены, не в config.yaml. Не выводимы из `PoE2_Flipper_Canonical_Formulas.md`.
- **Решение:** Вынести в `config.yaml:scoring.spread_model.*`, задокументировать происхождение коэффициентов.

### P1-10. `flipper-proxy.ts` circuit breaker — глобальный, не per-endpoint
- **Файл:** `src/lib/flipper-proxy.ts`
- **Проблема:** Все запросы делят один CB. 5 падений `/health` блокируют `/flips`, даже если backend жив.
- **Решение:** Per-endpoint CB (или хотя бы separate CB для `/health` и для analytics).

---

## P2 — Средние (clean code, dev experience)

### P2-1. `dashboard-page.tsx` — 1705 строк, god-component
- **Решение:** Разбить на_tab-specific подкомпоненты, вынести shared state в context.

### P2-2. `backend/api/data/pipeline_cache.py` и `daily_stats_cache.py` — shim-модули
- **Решение:** Удалить, обновить импорты на `unified_cache` напрямую.

### P2-3. `currency_names_ru.py` — 966 строк hardcoded словаря
- **Решение:** Перенести в `config.yaml` или `data/currency_names.json`.

### P2-4. `routes_scanner.py` — дублирует `/flips` с доп. фильтрами
- **Решение:** Расширить `/flips` query params (min_score, max_score, cluster, sort_by) или удалить `/scanner`.

### P2-5. `routes_auth.py` удалён, но комментарий остался в `main.py:516`
- **Решение:** Удалить комментарий.

### P2-6. Двойной circuit breaker (frontend + backend) не синхронизирован
- **Решение:** Frontend CB реагирует на `provider: "unreachable"` из `/health`, backend экспонирует статус CB в `/health`.

### P2-7. `usePriceStream` инвалидирует 6 query keys безусловно
- **Решение:** Инвалидировать только queries, связанные с changed currencies (нужен P0-1 fix).

### P2-8. `proxyWithFallback` глушит ВСЕ 5xx → 200
- **Решение:** В dev режиме прокидывать 5xx, в prod — fallback с явным маркером "fallback data".

### P2-9. `Predictor.time_series.py` — `lightgbm_min_data_points: 15` (было 30)
- **Решение:** Это workaround для young-league данных. Лучше — adaptive fallback: при <15 точках использовать Holt-Winters, при <5 — naive.

### P2-10. Документация противоречива: WS endpoints на `/v1/ws/*`, REST на `/api/v1/*`
- **Решение:** Унифицировать — WS на `/api/v1/ws/*`. Обновить reverse-proxy правила.

---

## P3 — Низкий приоритет (nice-to-have)

- **P3-1.** `routes_ws._compute_anomalies` и `routes_anomalies._detect_anomalies_sync` — два разных пути (один через executor, другой нет). Унифицировать.
- **P3-2.** `_prune_old_records` — тоже chunked delete (как P1-6).
- **P3-3.** `EventManager` не thread-safe для multi-worker uvicorn. Документировать ограничение или перейти на shared store.
- **P3-4.** `SnapshotManager._snapshot` swap неатомарный для итераторов (push_loop). Сделать `snapshot = self._snapshot` локально.
- **P3-5.** `tests/` — нет integration-теста на полный flow. Добавить e2e pytest: `/flips` → check profit_per_unit_base presence.
- **P3-6.** `.env.example` не включает `NEXT_PUBLIC_FLIPPER_WS_ENABLED`. Добавить с дефолтом `false`.
- **P3-7.** `REFACTOR_PLAN.md` и `worklog.md` — удалить после миграции в STATUS.md.

---

## Частые проблемы (Quick Reference)

| Симптом | Причина | Где фиксить |
|---------|--------|-------------|
| Backend "жив" но `/flips` висит | Кластеризация cold-start 5-15с (P1-4) | `routes_prices.py:259-274` |
| SSE подключён но UI не обновляется | Backend не шлёт `change_pct` (P0-1) | `routes_sse.py:_sse_event_generator` |
| WS подключён но `/anomalies` в REST тормозит | `_push_loop` блокирует event loop (P0-2) | `routes_ws.py:_compute_anomalies` |
| `/analyst/summary` показывает странные 24h% | `prices[0]` вместо 24h-ago (P0-3) | `routes_analyst.py:43` |
| 500 от backend превращается в "no data" | `proxyWithFallback` глушит 5xx (P2-8) | `flipper-proxy.ts:480-485` |
| После major_patch фаза не сбросилась | `max(league_start, patch)` (P0-4) | `lifecycle.py:80-84` |
| `flip_opportunities` кэш живёт после event change | `pipeline_cache.invalidate()` сбрасывает не всё (P1-7) | `routes_events.py:135` |
