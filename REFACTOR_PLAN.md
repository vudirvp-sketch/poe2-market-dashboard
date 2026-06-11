# PoE2 Market Dashboard — План рефакторинга

> Версия: 1.0 | Дата: 2026-06-12

## Диагноз

Проект имеет 3 системных проблемы:

1. **3 уровня кеша без координации** — poe2api.ts (in-memory), pipeline_cache (SQLite), daily_stats_cache (SQLite). Нет инвалидации между уровнями. Данные могут быть stale на одном уровне и fresh на другом.
2. **Дублирование API-запросов** — exchange pairs, items, currencies запрашиваются отдельно в каждом компоненте через useQuery, хотя данные одни и те же. Нет единого data layer.
3. **Нет cross-rate калькулятора для флипа** —(currency-optimal.ts) работает только для exchange pairs, но не даёт быстрый ответ: «сколько X стоит в Divine/Chaos/Exalted?»

---

## Фаза 1: Унификация кеша (приоритет: HIGH)

### 1.1 Единый in-memory кеш на фронтенде
- **Проблема:** Каждый компонент делает свой `useQuery` → отдельный HTTP-запрос → отдельный кеш в poe2api.ts.
- **Решение:** React Query уже обеспечивает дедупликацию по `queryKey`. Но ключи НЕ совпадают между компонентами.
- **Действие:**
  - Стандартизировать `queryKey` для одинаковых данных: `["exchangePairs", realm, league]` — везде одинаково
  - Добавить `staleTime` по умолчанию для exchange pairs (5 мин) и items (2 мин)
  - Использовать `queryClient.setQueryDefaults()` в providers.tsx

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
- **Проблема:** Exchange pairs запрашиваются в 5+ местах (exchange tab, currency cards, arbitrage, flips, optimizer).
- **Решение:** Один источник данных — `useExchangePairs()` hook с умным кешированием.
- **Действие:**
  - Создать `src/hooks/use-exchange-pairs.ts` — обёртка над useQuery с общим queryKey
  - Заменить все вызовы `fetchApi("/api/poe2/exchange", ...)` на `useExchangePairs()`
  - Включить `placeholderData: keepPreviousData` для бесшовной смены лиги

### 2.2 Общий currency price store
- **Проблема:** Currencies и items запрашиваются отдельно, хотя это один и тот же API (`/api/poe2/items`).
- **Решение:** `useCurrencyItems()` и `useUniqueItems()` — hooks с общим queryKey паттерном.
- **Действие:**
  - Создать `src/hooks/use-currency-items.ts`
  - Создать `src/hooks/use-unique-items.ts`
  - Стандартизировать `queryKey`: `["items", realm, league, category, referenceCurrency]`

### 2.3 Cross-rate калькулятор
- **Проблема:** Нет быстрого ответа «сколько X в Divine/Chaos/Exalted?» для флип-анализа.
- **Решение:** `useCrossRates()` hook, который вычисляет все кросс-курсы из exchange pairs.
- **Действие:**
  - Создать `src/hooks/use-cross-rates.ts`
  - Вернуть Map<currencyId, Map<targetCurrencyId, rate>>
  - Использовать в MultiCurrencyPrice, FlipsTab, ArbitrageTab

---

## Фаза 3: API оптимизация (приоритет: MEDIUM)

### 3.1 Batch-запросы
- **Проблема:** 17+ отдельных запросов при загрузке дашборда (categories, realms, leagues, items по каждой категории, exchange pairs, benchmarks...).
- **Решение:** Endpoint `/api/poe2/batch` — один запрос, несколько действий.
- **Действие:**
  - Создать `src/app/api/poe2/batch/route.ts`
  - Принимать JSON body: `{ requests: [{endpoint, params}] }`
  - Выполнять параллельно, возвращать `{results: [...]}`
  - Frontend: использовать для начальной загрузки

### 3.2 SSE/WebSocket для real-time обновлений
- **Проблема:** Polling каждые 30-60 секунд. Для цен это приемлемо, но для flips/events — нет.
- **Решение:** Использовать существующий WebSocket endpoint (`/api/flipper/ws`) для push-уведомлений.
- **Действие:**
  - Расширить `use-websocket.ts` для подписки на price updates
  - При получении обновления — инвалидировать соответствующий queryKey
  - Использовать `queryClient.invalidateQueries()`

### 3.3 Compressed responses
- **Проблема:** Exchange pairs JSON может быть 500KB+. Без gzip это медленно.
- **Решение:** Включить compression в Next.js config.
- **Действие:**
  - Добавить `compress: true` в `next.config.ts`
  - Проверить, что Cloudflare Worker тоже сжимает

---

## Фаза 4: Архитектурные улучшения (приоритет: LOW)

### 4.1 Разделение concerns на фронтенде
- **Проблема:** `dashboard-page.tsx` — 1700+ строк, все tab-ы в одном файле.
- **Решение:** Каждый tab — отдельный lazy-loaded компонент (как CurrencyGraphTab).
- **Действие:**
  - Вынести Overview, Currencies, Uniques, Exchange в lazy-компоненты
  - Использовать `next/dynamic` для всех tab-ов
  - Оставить в dashboard-page только роутинг и shared state

### 4.2 Backend API versioning
- **Проблема:** Нет версионирования API. Изменение формата ломает фронтенд.
- **Решение:** Префикс `/api/v1/flipper/...`
- **Действие:**
  - Добавить роутер с префиксом `/v1`
  - Старые роуты — redirect на v1

### 4.3 Typed API client
- **Проблема:** `fetchApi<T>()` — небезопасный каст типов. Ответ API может не совпадать с ожидаемым типом.
- **Решение:** Zod-схемы для валидации ответов API.
- **Действие:**
  - Добавить `zod` в зависимости
  - Создать схемы для ключевых ответов (ExchangePair, PoeItem, FlipOpportunity)
  - Использовать `schema.parse()` в fetchApi

---

## Порядок реализации

| Итерация | Что делаем | Сложность | Время |
|----------|-----------|-----------|-------|
| 33 (текущая) | MultiCurrencyPrice + REFACTOR_PLAN + чистая документация | LOW | 1 итерация |
| 34 | Фаза 1.1: Стандартизация queryKeys + defaults | LOW | 1 итерация |
| 35 | Фаза 2.1: useExchangePairs() + замена дублирующих вызовов | MEDIUM | 1 итерация |
| 36 | Фаза 2.3: useCrossRates() + интеграция в MultiCurrencyPrice | MEDIUM | 1 итерация |
| 37 | Фаза 1.2: Unified backend cache | HIGH | 2 итерации |
| 38 | Фаза 3.1: Batch endpoint | MEDIUM | 1 итерация |
| 39 | Фаза 1.3: Prefetch при смене лиги | LOW | 0.5 итерации |
| 40 | Фаза 4.1: Lazy-loaded tabs | MEDIUM | 1 итерация |

---

## Ключевые принципы

1. **Итеративность** — каждая фаза независима, можно останавливаться между фазами
2. **Обратная совместимость** — новые hooks не ломают существующий код
3. **Тестируемость** — каждый новый hook покрывается Jest-тестами
4. **Документация** — каждый новый файл получает JSDoc-комментарии
