# PoE2 Market Dashboard — План рефакторинга

> Версия: 7.0 | Дата: 2026-06-12

## Диагноз (resolved)

Исходные 4 проблемы — все FIXED (iter 34-39).

---

## Фаза 1: Унификация кеша — DONE ✅

### 1.1 Стандартизация queryKeys + defaults ✅ (iter 34, 37)
### 1.2 Синхронизация backend cache ✅ (iter 39)
### 1.3 Prefetch при смене league/realm ✅ (iter 38)

---

## Фаза 2: Переиспользование данных — DONE ✅

### 2.1 Единый exchange pair store ✅ (iter 36)
### 2.2 Общий currency price store ✅ (iter 37)
### 2.3 Cross-rate калькулятор ✅ (iter 36)

---

## Фаза 3: API оптимизация

### 3.1 Batch-запросы ✅ (iter 40)
- `POST /api/batch` — FastAPI endpoint для множественных GET-запросов в одном HTTP-вызове
- `backend/api/routes_batch.py` — batch router (до 10 sub-requests, asyncio.gather, 15s timeout/sub)
- `src/app/api/flipper/batch/route.ts` — Next.js proxy route
- `src/hooks/use-batch-query.ts` — `useBatchQuery()` + `useInitialBatch()` hooks
- Интегрировано в dashboard-page.tsx: `useInitialBatch()` предзаполняет кеш React Query для health/phase/events/optimalCurrency
- Безопасность: только GET-эндпоинты, denied mutation paths (/api/events/), whitelist путей

### 3.2 SSE/WebSocket для price updates — NOT STARTED
### 3.3 Compressed responses — NOT STARTED

---

## Фаза 4: Архитектурные улучшения

### 4.1 Lazy-loaded tabs ✅ (iter 40)
- 6 табов переведены на `next/dynamic` lazy loading:
  - FlipsTab, OptimizerTab, AnalystTab, LiquidChainTab, CurrencyGraphTab, WatchlistTab
- Общий `TabSkeleton` компонент для loading state
- Лёгкие табы (Overview, Currencies, Uniques, Exchange) остаются eagerly loaded
- Уменьшение initial JS bundle: тяжёлые компоненты загружаются только при навигации

### 4.2 Backend API versioning — NOT STARTED
### 4.3 Typed API client — NOT STARTED

---

## Порядок реализации

| Итерация | Что делаем | Статус |
|----------|-----------|--------|
| 33 | MultiCurrencyPrice + REFACTOR_PLAN v1 | DONE |
| 34 | Фаза 1.1 (queryKeys) + merge Arbitrage→Flips + merge Heatmap→Overview | DONE |
| 35 | Фаза 2.1 (заявлено, но файл не существовал) | CLAIMED DONE, ACTUALLY MISSING |
| 36 | Фаза 2.1 (фактически) + Фаза 2.3: useCrossRates() + интеграция | DONE |
| 37 | Фаза 2.2 + cleanup + queryKeys normalization | DONE |
| 38 | Фаза 1.3: Prefetch при смене league/realm | DONE |
| 39 | Фаза 1.2: Unified backend cache | DONE |
| 40 | Фаза 3.1: Batch endpoint + Фаза 4.1: Lazy-loaded tabs | DONE |
| 41 | Фаза 3.2: SSE/WebSocket / Фаза 3.3: Compressed responses | — |
| 42 | Фаза 4.2: API versioning / Фаза 4.3: Typed API client | — |

---

## Предсуществующие проблемы

- 5 тестов в `test_optimal_currency.py` падают (KeyError) — не связаны с текущими итерациями

## Ключевые принципы

1. **Итеративность** — каждая фаза независима
2. **Обратная совместимость** — новые hooks не ломают существующий код
3. **Тестируемость** — каждый новый hook покрывается Jest-тестами
4. **Документация** — каждый новый файл получает JSDoc-комментарии
