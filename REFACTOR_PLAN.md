# PoE2 Market Dashboard — План рефакторинга

> Версия: 8.0 | Дата: 2026-06-12

## Фаза 1: Унификация кеша — DONE ✅

## Фаза 2: Переиспользование данных — DONE ✅

## Фаза 3: API оптимизация

### 3.1 Batch-запросы ✅ (iter 40)
### 3.2 SSE для price updates ✅ (iter 41)
- `GET /api/prices/stream` — SSE endpoint (Server-Sent Events)
- `backend/api/routes_sse.py` — SSE router с фоновым монитором DataSnapshot
- Мониторит DataSnapshot на изменения, рассылает `price_update` события подключённым клиентам
- Порог изменения: ≥0.5% по умолчанию (параметр threshold_pct)
- Автоматические heartbeat каждые 30s, таймаут клиента 5 мин
- Лимит 50 одновременных SSE клиентов
- `src/app/api/flipper/prices/stream/route.ts` — Next.js SSE прокси
- `src/hooks/use-price-stream.ts` — `usePriceStream()` hook
  - Подключается к SSE, получает price_update события
  - Инвалидирует React Query кеш зависимых запросов при значимых изменениях
  - Circuit breaker: останавливает реконнект после 5 неудач за 60s
  - Уважает backendOnline сигнал
- Интегрировано в dashboard-page.tsx (дополнение к polling, не замена)
- Запуск/останов SSE монитора в FastAPI lifespan

### 3.3 Compressed responses — NOT STARTED

---

## Фаза 4: Архитектурные улучшения

### 4.1 Lazy-loaded tabs ✅ (iter 40)
### 4.2 Backend API versioning — NOT STARTED
### 4.3 Typed API client — NOT STARTED

---

## Порядок реализации

| Итерация | Что делаем | Статус |
|----------|-----------|--------|
| 40 | Фаза 3.1: Batch endpoint + Фаза 4.1: Lazy-loaded tabs | DONE |
| 41 | Фаза 3.2: SSE для price updates + фикс 5 тестов | DONE |
| 42 | Фаза 3.3: Compressed responses / Фаза 4.2: API versioning | — |
| 43 | Фаза 4.3: Typed API client | — |

---

## Исправленные проблемы

- 5 тестов в `test_optimal_currency.py` — FIXED (iter 41)
  - Причина: тесты ожидали camelCase ключи (`effectiveAnchorPrice`, `premiumPct`, `buyCurrencyId`, `estimatedProfitPct`), но backend возвращает snake_case
  - Исправлено: тесты обновлены на snake_case ключи (соответствует backend)

## Ключевые принципы

1. **Итеративность** — каждая фаза независима
2. **Обратная совместимость** — новые hooks не ломают существующий код
3. **Тестируемость** — каждый новый hook покрывается тестами
4. **Документация** — каждый новый файл получает JSDoc-комментарии
5. **SSE — дополнение к polling, не замена** — React Query продолжает polling, SSE добавляет push-инвалидацию
