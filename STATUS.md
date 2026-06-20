# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-20 (iter 53 — audit verified against code)
> This file is the **single source of truth** for known bugs and refactoring priorities.
> Update it **before** fixing any issue. Cross-reference issue IDs in commits.
>
> **Verification status (iter 53):** All P0 issues re-checked against source code. P0-1 supplemented with SSE contract mismatch. P0-5 supplemented with correctness bug. New P1-11, P2-11, P3-8 added. One Quick-Reference row corrected.

---

## P0 — Критичные проблемы (стабильность/корректность)

### P0-1. SSE — мёртвый монитор, без пороговой фильтрации, contract mismatch
- **Файл:** `backend/api/routes_sse.py` (+ frontend `src/hooks/use-price-stream.ts`)
- **Проблема (3 части):**
  1. **Dead monitor:** `start_sse_monitor()` / `_sse_monitor_loop()` (строки 142-181) — пустой цикл `asyncio.sleep(60)`, не делает ничего. Запускается из `main.py:245` — wasted memory + task slot.
  2. **threshold_pct игнорируется:** Query-параметр `threshold_pct` передаётся в `_sse_event_generator` (строка 128), но **не используется** внутри (строки 55-115). Backend отправляет любое изменение независимо от threshold.
  3. **Contract mismatch (двойной):** Backend отправляет `{type: "price_update", changes_count, changes: [{api_id, price}], timestamp}` (строки 94-101). Frontend ожидает `{pair, change_pct, new_price, old_price, timestamp}` для одного сообщения (use-price-stream.ts строки 60-71). Даже если добавить `change_pct` в items — frontend не сможет его прочитать из-за формы `{changes: [...]}`. Hook проверяет `data.change_pct` верхнего уровня (строка 192), которого нет в payload → **invalidation никогда не срабатывает**.
- **Доп.:** Каждое SSE-соединение создаёт свой polling loop (5с) — N клиентов = N параллельных loop'ов, читающих `get_snapshot_manager().last_snapshot`. Должен быть один broadcast-source.
- **Решение:**
  1. Удалить мёртвый monitor (`start_sse_monitor`, `_sse_monitor_loop`, `stop_sse_monitor`, вызовы из `main.py:244-248, 303-308`).
  2. В `_sse_event_generator`: хранить previous snapshot, вычислять `change_pct` для changed currencies, фильтровать по `threshold_pct`, отправлять **одно сообщение** per changed currency в формате, ожидаемом frontend: `{pair, change_pct, new_price, old_price, timestamp}`. ИЛИ обновить frontend-тип `SSEPriceUpdate` до актуального shape'а.
  3. Альтернатива: отказаться от SSE в пользу polling + `If-Modified-Since`.

### P0-2. WebSocket endpoints блокируют event loop
- **Файл:** `backend/api/routes_ws.py:415-468` (`_compute_anomalies`), `routes_ws.py:478-522` (`_compute_flips`)
- **Проблема:** `_push_loop` (строка 364) каждые 30с запускает `await compute_fn()` где compute_fn — `_compute_anomalies` (600+ валют, AnomalyDetector.detect = STL+MACD+RSI для каждой) **синхронно в event loop**, без ProcessPoolExecutor. Один WS-клиент = блокировка 30-секундным циклом. Каскад при нескольких клиентах. Подтверждено: `rg "run_in_executor|process_pool|to_thread" routes_ws.py` — 0 совпадений.
- **Решение:** Использовать `loop.run_in_executor(process_pool, _detect_anomalies_sync, ...)` как в `routes_anomalies.py:155-169`. Или полностью удалить WS (см. P1-1 — WS дублирует REST).

### P0-3. `routes_analyst._compute_trends` — неверная метрика "24h change"
- **Файл:** `backend/api/routes_analyst.py:43`
- **Проблема:** `price_24h_ago = prices[0] if len(prices) >= 2 else None` — берётся первая точка истории (старейшая в окне snapshot, обычно несколько дней назад, не 24ч). Все `change_24h_pct` в `/analyst/summary` неверны.
- **Решение:** Использовать `_find_price_24h_ago` из `routes_arbitrage.py:92-126` (принимает `list[(datetime, price)]`, ищет ближайшую точку к `now - 24h`, возвращает None если drift >6ч). Вынести в общий helper `backend/economy/pricing.py` или `backend/api/shared.py`.

### P0-4. `PhaseDetector._reference_date` — некорректный reset при major_patch
- **Файл:** `backend/economy/lifecycle.py:80-84`
- **Проблема:** `_reference_date()` возвращает `max(self._league_start, self._patch_reset_date)`. Если патч вышел раньше старта лиги (типовой сценарий: патч-превью за неделю до old-league end), `league_start` позднее → reset игнорируется → phase остаётся LATE вместо сброса в EARLY. Спека (`PoE2_Flipper_Canonical_Formulas.md §1`) требует: major_patch **всегда** сбрасывает фазу.
- **Решение:** Если есть `patch_reset_date` — вернуть его без `max()` с `league_start`:
  ```python
  def _reference_date(self) -> datetime:
      if self._patch_reset_date is not None:
          return self._patch_reset_date
      return self._league_start
  ```

### P0-5. Дублирование логики transitive prices — 3 разные реализации + correctness bug
- **Файлы:**
  - `backend/api/data_snapshot.py:171-210` `_compute_transitive_prices` (BFS, O(V+E))
  - `backend/scheduler.py:91-110` `collect_price_snapshot` (5-итерационный relaxation, O(5×E))
  - `backend/api/routes_arbitrage.py:755-770` `get_triangular_arbitrage` (chaos-normalization через `prices["chaos"] = 1.0`)
- **Проблема (2 части):**
  1. **Maintainability:** Три разных алгоритма для одной концепции → несогласованные `prices_in_base` между /flips, /triangular и SQLite.
  2. **Correctness bug (NEW):** 5-итерационный relaxation в scheduler.py НЕ находит цены для цепочек глубже 5 хопов (например, A→B→C→D→E→F→G — G не получит цену). BFS в data_snapshot.py находит все цены за один проход.
- **Решение:** Вынести в единый helper `backend/economy/pricing.py:compute_transitive_prices(prices_in_base, rates, base)` (использовать BFS-версию), вызывать из всех трёх мест.

### P0-6. `prices["chaos"] = 1.0; prices["Chaos Orb"] = 1.0` — хардкод в triangular arbitrage
- **Файл:** `backend/api/routes_arbitrage.py:769-770`
- **Проблема:** Жёстко переопределяет цену chaos для triangular arbitrage (строки 768-770), даже если `base_currency=exalted`. Дополнительно строка 766 делит все цены на `chaos_in_base` — это другая логика, не "установка 1.0", но тоже хардкод нормализации к chaos. Сломается при смене лиги или отсутствии chaos в данных.
- **Решение:** Использовать единый numeraire (`config.league.base_currency`), не нормализовать к chaos. Если Bellman-Ford требует numeraire с ценой 1.0 — использовать `base` (=1.0 по построению в `prices_in_base`).

---

## P1 — Серьёзные (производительность, maintainability)

### P1-1. WS endpoints дублируют REST-логику с урезанными полями
- **Файл:** `backend/api/routes_ws.py:415-522`
- **Проблема:** `_compute_storage_value`, `_compute_forecast`, `_compute_anomalies`, `_compute_flips` — копипаста из REST routes. Подтверждено: WS `_compute_flips` возвращает 10 полей per opportunity (строки 498-509); REST `routes_arbitrage.py:650-691` возвращает ~15 полей (включая `profit_per_unit_base`, `quantized_analysis`, `tier_distance`, `fair_rate`, `deviation_pct`, `price_from_in_base`, `price_to_in_base`, `data_source`). WS-клиенты получают урезанную картину.
- **Решение:** Либо удалить WS endpoints (REST + polling достаточно — см. P0-1, P0-2), либо вынести computation в общие сервисы (`backend/services/flips.py` etc.), вызывать и из REST, и из WS.

### P1-2. `useFlipperWebSocket` открывает 2 параллельных WS-соединения
- **Файл:** `src/hooks/use-websocket.ts:507-518`
- **Проблема:** При callback-API хук открывает `/ws/flips` и `/ws/anomalies` одновременно (строки 507, 513). Двойная нагрузка на backend, каждый со своей reconnect-логикой. Возвращает только `flipsResult` (строка 542) — данные anomalies теряются на data-слое, только trigger'ит callback.
- **Решение:** Один мультиплексный WS (одно соединение, `type` field для маршрутизации) или polling + React Query (рекомендуется, учитывая P0-2).

### P1-3. `_compute_transitive_prices` — O(V×E) вместо O(V+E)
- **Файл:** `backend/api/data_snapshot.py:189-209`
- **Проблема:** BFS на каждой итерации `while queue:` перебирает ВСЕ edges `for key, rate in rates.items()`. Для 600 валют × 1800 пар = 1.08M ops вместо 2400.
- **Решение:** Построить adjacency list один раз (`adj: dict[str, list[(str, float)]]`), итерироваться по neighbors of `current` только.

### P1-4. Кластеризация дублируется между routes_prices и routes_arbitrage
- **Файлы:** `backend/api/routes_prices.py:196-283` (cache key `price_cluster_labels`), `backend/api/routes_arbitrage.py:191-249, 520` (cache key `arbitrage_cluster_labels`)
- **Проблема:** `/prices` кэширует кластеризацию в pipeline_cache, `/flips` — пересчитывает каждый раз (cache miss для `arbitrage_cluster_labels`). Wasted work + несогласованность кластерных labels между endpoints.
- **Решение:** Один cache key `cluster_labels`, единая helper-функция `backend/predictors/clustering.py:cluster_prices(snapshot)`, запись в кэш после subprocess-возврата.

### P1-5. `compute_quantized_analysis` — O(lot_sizes × max_lot_search) на пару
- **Файл:** `backend/arbitrage/scorer.py` (вызывается в `_build_flip_opportunities_sync`)
- **Проблема:** 5 lot_sizes × 10000 max_lot_search = 50000 ops на пару. Для 600 пар = 30M ops в subprocess. Медленно.
- **Решение:** Бинарный поиск вместо linear scan по lot_sizes.

### P1-6. `HistoricalStore._prune_old_league_data` — DELETE без лимитов
- **Файл:** `backend/data/historical.py:172`
- **Проблема:** При смене лиги `DELETE FROM price_snapshots WHERE league = ?` без LIMIT. На проде с большим DB — транзакция пухнет до GB, блокирует другие writes.
- **Решение:** Chunked delete: `DELETE FROM price_snapshots WHERE league = ? AND rowid IN (SELECT rowid FROM price_snapshots WHERE league = ? LIMIT 1000)` в loop'е с `await db.commit()` между итерациями.

### P1-7. `EventManager.create_event` — fire-and-forget SQLite write
- **Файл:** `backend/economy/events.py:206-216`
- **Проблема:** `asyncio.ensure_future(self._store.write_event(event))` (строка 212) — не await'ится. Если backend упадёт в течение секунды — событие потеряно (есть только в памяти `_events[event_id]`, строка 204).
- **Доп.:** Используется deprecated `asyncio.get_event_loop()` (строка 210) — должен быть `asyncio.get_running_loop()` (см. P3-8). Sync-fallback через `loop.run_until_complete(write_event(...))` (строка 214) некорректен — `create_event` может вызываться из async-context'а без running loop'а, но в реальном deployment loop всегда running.
- **Решение:** Сделать `create_event` async, `await self._store.write_event(event)`. Или гарантированная запись через `asyncio.shield()` + retry.

### P1-8. `routes_optimizer._bellman_ford` — теряет profitable arbitrage
- **Файл:** `backend/api/routes_optimizer.py:99-103`
- **Проблема:** `visited` set в path reconstruction (строки 99-103) возвращает `None` при цикле в predecessor map. Bellman-Ford с `max_hops=5` релаксаций не детектит negative cycle (классический признак: V-я итерация с обновлениями). Profitable arbitrage = negative cycle в -log(rate) graph → predecessor map может содержать цикл → reconstruction возвращает None → теряем прибыльные пути.
- **Решение:** После max_hops релаксаций — проверить, обновляются ли расстояния за ещё одну итерацию (если да — negative cycle detect'нут). Отдельно восстановить cycle из predecessor map (следовать от узла с обновлением, пока не зациклимся).

### P1-9. Spread model — магические числа без теоретической основы
- **Файл:** `backend/api/routes_arbitrage.py:283-309`
- **Проблема:** `0.04`, `40.0`, `0.05`, `8.0`, `0.08`, `0.5`, `1.5`, `0.005`, `0.15`, `0.5`, `0.20` — захардкожены, не в config.yaml. Не выводимы из `PoE2_Flipper_Canonical_Formulas.md`.
- **Решение:** Вынести в `config.yaml:scoring.spread_model.*` с комментариями-источниками, задокументировать происхождение каждого коэффициента в `docs/SPREAD_MODEL.md`.

### P1-10. `flipper-proxy.ts` circuit breaker — глобальный, не per-endpoint
- **Файл:** `src/lib/flipper-proxy.ts:32-34`
- **Проблема:** Все запросы делят один CB (`flipperCircuitBreakerOpen`). 5 падений `/health` блокируют `/flips`, даже если analytics-backend жив.
- **Решение:** Per-endpoint CB (Map<path, CircuitBreaker>), или хотя бы separate CB для `/health` и для analytics endpoints.

### P1-11. (NEW) `routes_events.create_event` не инвалидирует `daily_stats` namespace
- **Файл:** `backend/api/routes_events.py:134-136`
- **Проблема:** После создания event вызывается `pipeline_cache.invalidate()` (строка 135) — очищает ВСЁ pipeline namespace (`unified_cache.py:547-549` + `:390-399`). Однако `daily_stats_cache` — это **отдельный namespace** (`unified_cache.py:556-618`, namespace=`"daily_stats"`), который НЕ инвалидируется. Forecast endpoints, использующие daily_stats (`routes_storage_value.py`, `routes_ws._compute_forecast`), могут сервить stale данные после event creation. Особенно problematic для `economy_shift` events, влияющих на liquidity.
- **Решение:** В `routes_events.create_event` после `pipeline_cache.invalidate()` добавить `daily_stats_cache = get_daily_stats_cache(); daily_stats_cache.invalidate()`. Или вызывать `unified_cache.invalidate(namespace=None)` для полной очистки.

---

## P2 — Средние (clean code, dev experience)

### P2-1. `dashboard-page.tsx` — 1705 строк, god-component
- **Подтверждено:** `wc -l` = 1705.
- **Решение:** Разбить на tab-specific подкомпоненты (`<FlipsTab>`, `<TriangularTab>`, `<AnomaliesTab>` etc.), вынести shared state в context.

### P2-2. `backend/data/pipeline_cache.py` и `daily_stats_cache.py` — shim-модули
- **Подтверждено:** `pipeline_cache.py` = 23 строки, `daily_stats_cache.py` = 23 строки — оба просто re-export'ят из `unified_cache.py`.
- **Решение:** Удалить, обновить импорты на `from backend.data.unified_cache import get_pipeline_cache, get_daily_stats_cache` напрямую.

### P2-3. `backend/data/currency_names_ru.py` — 966 строк hardcoded словаря
- **Подтверждено:** `wc -l` = 966.
- **Решение:** Перенести в `config.yaml` или `backend/data/currency_names.json` (загружать лениво).

### P2-4. `routes_scanner.py` — дублирует `/flips` с доп. фильтрами
- **Решение:** Расширить `/flips` query params (min_score, max_score, cluster, sort_by) или удалить `/scanner`.

### P2-5. `routes_auth.py` удалён, но комментарий остался в `main.py:516-519`
- **Подтверждено:** 4-строчный комментарий в `main.py:516-519`.
- **Решение:** Удалить комментарий (или сократить до 1 строки).

### P2-6. Двойной circuit breaker (frontend + backend) не синхронизирован
- **Решение:** Frontend CB реагирует на `provider: "unreachable"` из `/health`, backend экспонирует статус CB в `/health` (новое поле `circuit_breaker_state`).

### P2-7. `usePriceStream` инвалидирует 6 query keys безусловно
- **Подтверждено:** `use-price-stream.ts:124-132` — 6 unconditional `invalidateQueries`.
- **Решение:** Инвалидировать только queries, связанные с changed currencies (нужен P0-1 fix — backend должен слать `api_id` для каждого change).

### P2-8. `proxyWithFallback` глушит ВСЕ 5xx → 200
- **Подтверждено:** `flipper-proxy.ts:480-485`.
- **Решение:** В dev режиме прокидывать 5xx (better DX), в prod — fallback с явным маркером `"fallback_data": true` в payload (чтобы frontend мог отрисовать banner "data may be stale").

### P2-9. `Predictor.time_series.py` — `lightgbm_min_data_points: 15` (было 30)
- **Подтверждено:** `config.yaml:83` = 15, `time_series.py:644` использует его.
- **Решение:** Adaptive fallback: при <15 точках использовать Holt-Winters, при <5 — naive (last-value). Удалить `lightgbm_min_data_points` из config.

### P2-10. Документация противоречива: WS endpoints на `/v1/ws/*`, REST на `/api/v1/*`
- **Подтверждено:** `routes_ws.py:42` `prefix="/v1"`, REST routers `prefix="/api/v1/..."`.
- **Решение:** Унифицировать — WS на `/api/v1/ws/*`. Обновить `nginx.example.conf` (или что используется как reverse-proxy) + `src/hooks/use-websocket.ts` URLs.

### P2-11. (NEW) Нет тестов для SSE, WS, `/analyst/summary` endpoints
- **Файлы:** `tests/e2e/test_api_e2e.py` (10 тестов, покрывает health/phase/currencies/prices/heatmap/events/flips/triangular/anomalies/storage_value)
- **Проблема:** Нет e2e-тестов для:
  - SSE endpoint `/api/v1/prices/stream` (нет test_sse.py)
  - WS endpoints `/v1/ws/*` (нет test_ws.py)
  - `/api/v1/analyst/summary` (нет test_analyst.py) — критично, т.к. P0-3 bug должен быть покрыт regression-тестом
  - `/api/v1/optimizer/*` (нет test_optimizer.py)
- **Решение:** Добавить 4 новых test-файла с minimum 2-3 тестами каждый. После фикса P0-3 — обязательно добавить regression-тест `test_analyst_24h_change_uses_timestamp`.

---

## P3 — Низкий приоритет (nice-to-have)

- **P3-1.** `routes_ws._compute_anomalies` и `routes_anomalies._detect_anomalies_sync` — два разных пути (один через executor, другой нет). Унифицировать после P0-2.
- **P3-2.** `_prune_old_records` (`historical.py:472`) — тоже chunked delete (как P1-6).
- **P3-3.** `EventManager` (`events.py`) не thread-safe для multi-worker uvicorn. `_events: dict` без lock. Документировать ограничение "single worker only" или перейти на shared store (Redis).
- **P3-4.** `SnapshotManager._snapshot` swap неатомарный для итераторов (`_push_loop` в WS). Сделать `snapshot = self._snapshot` локально в начале каждой итерации.
- **P3-5.** (Expanded в P2-11) tests/ — нет integration-теста на полный flow. После P2-11 добавить e2e pytest: `/flips` → check `profit_per_unit_base` presence.
- **P3-6.** `.env.example` не включает `NEXT_PUBLIC_FLIPPER_WS_ENABLED`. Добавить с дефолтом `false` (т.к. WS endpoints blocked by P0-2).
- **P3-7.** `REFACTOR_PLAN.md` и `worklog.md` — удалить после миграции в STATUS.md (когда все issues закрыты).
- **P3-8.** (NEW) `asyncio.get_event_loop()` в `events.py:210` deprecated с Python 3.10. Заменить на `asyncio.get_running_loop()` (raises `RuntimeError` если нет running loop — это OK, т.к. `create_event` должен вызываться из async-context'а).

---

## Частые проблемы (Quick Reference)

| Симптом | Причина | Где фиксить |
|---------|--------|-------------|
| Backend "жив" но `/flips` висит 5-15с | Кластеризация cold-start (P1-4) | `routes_prices.py:259-274` |
| SSE подключён но UI не обновляется | (1) backend не шлёт `change_pct`; (2) payload shape не совпадает с frontend-типом (P0-1) | `routes_sse.py:_sse_event_generator` + `use-price-stream.ts:SSEPriceUpdate` |
| WS подключён но `/anomalies` в REST тормозит | `_push_loop` блокирует event loop (P0-2) | `routes_ws.py:_compute_anomalies` |
| `/analyst/summary` показывает странные 24h% | `prices[0]` вместо 24h-ago (P0-3) | `routes_analyst.py:43` |
| 500 от backend превращается в "no data" | `proxyWithFallback` глушит 5xx (P2-8) | `flipper-proxy.ts:480-485` |
| После major_patch фаза не сбросилась | `max(league_start, patch)` (P0-4) | `lifecycle.py:80-84` |
| Event создан но forecast показывает stale данные | `daily_stats` namespace не инвалидирован (P1-11) | `routes_events.py:135` |
| WS `/flips` не содержит `profit_per_unit_base` | WS возвращает урезанные flips (P1-1) | `routes_ws.py:498-509` |
| После перезапуска backend часть events пропала | `create_event` fire-and-forget SQLite write (P1-7) | `events.py:212` |
