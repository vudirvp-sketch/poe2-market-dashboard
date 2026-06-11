# PoE2 Market Dashboard — План рефакторинга

> Версия: 2.0 | Дата: 2026-06-12

## Диагноз

Проект имеет 4 системных проблемы:

1. **Дублирование вкладок** — Arbitrage и Flips используют одни и те же API (`/flips`, `/triangular`, `/phase`), одни и те же фильтры, одни и те же предупреждения. MarketHeatmap дублирует heatmap внутри MarketOverview.
2. **3 уровня кеша без координации** — poe2api.ts (in-memory), pipeline_cache (SQLite), daily_stats_cache (SQLite). Нет инвалидации между уровнями.
3. **Дублирование API-запросов** — exchange pairs запрашиваются в 5+ местах с разными queryKeys (`["exchange", ...]` vs `["exchangePairs", ...]`). Heatmap запрашивается с `["flipper-heatmap", ...]` и `["heatmap", ...]`.
4. **Нет cross-rate калькулятора для флипа** — currency-optimal.ts работает только для exchange pairs, но не даёт быстрый ответ: «сколько X стоит в Divine/Chaos/Exalted?»

---

## Аудит вкладок (итерация 34)

### Текущие 11 вкладок

| # | Вкладка | Компонент | Строк | API endpoints | Вердикт |
|---|---------|-----------|-------|---------------|---------|
| 1 | Overview | MarketOverview + MarketHeatmap + ComparativeChart | ~1720 | `/overview`, `/heatmap` | Оставить. Убрать MarketHeatmap как отдельный компонент — встроить в MarketOverview |
| 2 | Currencies | VirtualCurrencyGrid / CurrencyCard | ~60 | `/items` | Оставить. Базовая функциональность |
| 3 | Uniques | UniqueTable | ~50 | `/items` | Оставить. Базовая функциональность |
| 4 | Exchange | ExchangeTable / ExchangePairCard + VolumeLiquidityIndicators | ~780 | `/exchange` | Оставить. Уникальная функциональность |
| 5 | Arbitrage | ArbitrageTab | ~345 | `/flips`, `/triangular`, `/phase` | **Удалить — объединить с Flips** |
| 6 | Flips | FlipsTab + TierDriftTracker | ~860 | `/flips`, `/triangular`, `/storage-value` | **Расширить** — поглотить Arbitrage |
| 7 | Optimizer | OptimizerTab | ~581 | `/optimizer/path`, `/optimizer/matrix` | Оставить. Уникальная функциональность (Dijkstra path + rate matrix) |
| 8 | Analyst | AnalystTab | ~457 | `/analyst/summary`, `/analyst-fallback` | Оставить. Уникальная fallback-логика |
| 9 | Liquid Chain | LiquidChainTab | ~413 | `/liquid-chain` | Оставить. Уникальный домен (vendor reforge) |
| 10 | Currency Graph | CurrencyGraphTab | ~889 | `/prices`, `/triangular` | Оставить. Уникальная D3-визуализация |
| 11 | Watchlist | WatchlistTab | ~512 | `/exchange` | Оставить. Переиспользует exchange data с другим UX |

### Детальный анализ дублирований

#### 🔴 Arbitrage ↔ Flips (критическое дублирование)

Обе вкладки:
- Используют `useFlipsQuery()` с одним и тем же `FLIPS_QUERY_KEY`
- Запрашивают `/api/flipper/triangular` с `queryKey: ["flipper-triangular"]`
- Запрашивают `/api/flipper/phase` с `queryKey: ["flipper-phase"]`
- Показывают одинаковые предупреждения: cross-rate warning, event status banner
- Имеют фильтры minScore/minVolume

Различие: Arbitrage — «обзор» (3 stat-карточки + компактная таблица + triangular), Flips — «детали» (rich table, cluster filter, search, detail dialog, WebSocket, auto-refresh).

**Решение:** Объединить в единую вкладку Flips с секцией Triangular Arbitrage внизу. Stats-карточки из Arbitrage добавляются в верхнюю часть Flips.

#### 🔴 MarketHeatmap ↔ MarketOverview (дублирование внутри вкладки)

- `market-overview.tsx` запрашивает `/api/flipper/heatmap` с `queryKey: ["flipper-heatmap", realm, league]`
- `market-heatmap.tsx` запрашивает тот же `/api/flipper/heatmap` с `queryKey: ["heatmap", realm, league]`
- Оба рендерят цветовую сетку валют с HSL-маппингом
- MarketHeatmap добавляет «Market Tops» (top 5 gainers/losers)

**Решение:** Удалить standalone MarketHeatmap. Встроить «Market Tops» в MarketOverview. Стандартизировать queryKey на `["heatmap", realm, league]`.

#### 🟡 Top Movers в 3 местах (умеренное дублирование)

MarketOverview, MarketHeatmap, AnalystTab — все показывают top gainers/losers. После удаления MarketHeatmap остаётся MarketOverview + AnalystTab — это допустимо, т.к. контекст разный (overview = рыночный снэпшот, analyst = аналитика трендов).

### Итоговая структура вкладок (после рефакторинга)

| # | Вкладка | Содержание |
|---|---------|-----------|
| 1 | Overview | MarketOverview (со встроенным heatmap + Market Tops) + ComparativeChart |
| 2 | Currencies | Без изменений |
| 3 | Uniques | Без изменений |
| 4 | Exchange | Без изменений |
| 5 | Flips | Расширенная: stats row + disclaimer + подробная таблица + triangular section + TierDriftTracker |
| 6 | Optimizer | Без изменений |
| 7 | Analyst | Без изменений |
| 8 | Liquid Chain | Без изменений |
| 9 | Currency Graph | Без изменений |
| 10 | Watchlist | Без изменений |

**Итого:** 11 → 10 вкладок. Удалён 1 компонент (arbitrage-tab.tsx), 1 компонент встроен (market-heatmap.tsx → market-overview.tsx).

---

## Фаза 1: Унификация кеша (приоритет: HIGH)

### 1.1 Стандартизация queryKeys + defaults ✅ (итерация 34)
- **Проблема:** Exchange pairs: `["exchange", ...]` vs `["exchangePairs", ...]`. Heatmap: `["flipper-heatmap", ...]` vs `["heatmap", ...]`.
- **Решение:**
  - Единый queryKey для exchange pairs: `["exchangePairs", realm, league]`
  - Единый queryKey для heatmap: `["heatmap", realm, league]`
  - `queryClient.setQueryDefaults()` в providers.tsx для staleTime по категориям
- **Статус:** DONE

### 1.2 Синхронизация backend cache
- **Проблема:** `pipeline_cache.py` и `daily_stats_cache.py` — два отдельных SQLite-кеша с разными TTL.
- **Решение:** Объединить в один `unified_cache.py` с namespace-based TTL.
- **Действие:**
  - Создать `backend/data/unified_cache.py` с API: `get(key, namespace)`, `set(key, value, namespace, ttl)`
  - Мигрировать `pipeline_cache` и `daily_stats_cache` на unified_cache
  - Добавить endpoint `/api/flipper/cache/status` для мониторинга

### 1.3 Prefetch при смене league/realm
- **Проблема:** При смене лиги все данные сбрасываются, потом загружаются по одному.
- **Решение:** При смене лиги запускать prefetch всего набора данных.
- **Действие:**
  - В `dashboard-page.tsx` добавить `useEffect` на смену league: prefetch currencies, exchange pairs, uniques
  - Использовать `queryClient.prefetchQuery()`

---

## Фаза 2: Переиспользование данных (приоритет: HIGH)

### 2.1 Единый exchange pair store
- **Проблема:** Exchange pairs запрашиваются в 5+ местах с разными queryKeys.
- **Решение:** `useExchangePairs()` hook с единым queryKey `["exchangePairs", realm, league]`.
- **Действие:**
  - Создать `src/hooks/use-exchange-pairs.ts`
  - Заменить все вызовы с разными queryKeys
  - Включить `placeholderData: keepPreviousData`

### 2.2 Общий currency price store
- **Проблема:** Currencies и items запрашиваются отдельно, хотя это один и тот же API.
- **Решение:** `useCurrencyItems()` и `useUniqueItems()` hooks.
- **Действие:**
  - Создать `src/hooks/use-currency-items.ts`
  - Создать `src/hooks/use-unique-items.ts`

### 2.3 Cross-rate калькулятор
- **Проблема:** Нет быстрого ответа «сколько X в Divine/Chaos/Exalted?» для флип-анализа.
- **Решение:** `useCrossRates()` hook.
- **Действие:**
  - Создать `src/hooks/use-cross-rates.ts`
  - Использовать в MultiCurrencyPrice, FlipsTab

---

## Фаза 3: API оптимизация (приоритет: MEDIUM)

### 3.1 Batch-запросы
- Endpoint `/api/poe2/batch` — один запрос, несколько действий.

### 3.2 SSE/WebSocket для real-time обновлений
- Расширить `use-websocket.ts` для подписки на price updates.

### 3.3 Compressed responses
- Добавить `compress: true` в `next.config.ts`.

---

## Фаза 4: Архитектурные улучшения (приоритет: LOW)

### 4.1 Lazy-loaded tabs
- Каждый tab — lazy-loaded через `next/dynamic`.

### 4.2 Backend API versioning
- Префикс `/api/v1/flipper/...`.

### 4.3 Typed API client
- Zod-схемы для валидации ответов API.

---

## Порядок реализации

| Итерация | Что делаем | Сложность | Статус |
|----------|-----------|-----------|--------|
| 33 | MultiCurrencyPrice + REFACTOR_PLAN v1 | LOW | DONE |
| 34 | Аудит вкладок + Фаза 1.1 (queryKeys) + merge Arbitrage→Flips + merge Heatmap→Overview | HIGH | DONE |
| 35 | Фаза 2.1: useExchangePairs() + замена дублирующих вызовов | MEDIUM | — |
| 36 | Фаза 2.3: useCrossRates() + интеграция | MEDIUM | — |
| 37 | Фаза 1.2: Unified backend cache | HIGH | — |
| 38 | Фаза 3.1: Batch endpoint | MEDIUM | — |
| 39 | Фаза 1.3: Prefetch при смене лиги | LOW | — |
| 40 | Фаза 4.1: Lazy-loaded tabs | MEDIUM | — |

---

## Ключевые принципы

1. **Итеративность** — каждая фаза независима, можно останавливаться между фазами
2. **Обратная совместимость** — новые hooks не ломают существующий код
3. **Тестируемость** — каждый новый hook покрывается Jest-тестами
4. **Документация** — каждый новый файл получает JSDoc-комментарии
