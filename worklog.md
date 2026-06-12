# Worklog

---
Task ID: 40
Agent: main
Task: Итерация 40 — Фаза 3.1 (Batch-запросы) + Фаза 4.1 (Lazy-loaded tabs)

Work Log:
- Создан `backend/api/routes_batch.py` — POST /api/batch
- Создан `src/app/api/flipper/batch/route.ts` — Next.js proxy
- Создан `src/hooks/use-batch-query.ts` — useBatchQuery() + useInitialBatch()
- Интегрировано в dashboard-page.tsx
- 6 табов переведены на lazy loading via next/dynamic
- TypeScript: 0 ошибок, Jest: 291/291, pytest: 339/344 (5 предсуществующих падений)

Stage Summary:
- **Phase 3.1 DONE**: Batch endpoint + hooks + интеграция
- **Phase 4.1 DONE**: 6 табов на lazy loading
- **Точка остановки:** Фаза 3.2 (SSE/WebSocket) или Фаза 3.3

---
Task ID: 41
Agent: main
Task: Итерация 41 — Фаза 3.2 (SSE для price updates) + фикс 5 тестов

Work Log:
- Создан `backend/api/routes_sse.py`:
  - GET /api/prices/stream — SSE endpoint для live price updates
  - Фоновый монитор DataSnapshot: рассылает price_update события при изменении цен ≥0.5%
  - Heartbeat каждые 30s, клиентский таймаут 5 мин, лимит 50 клиентов
  - Circuit breaker для медленных клиентов (очередь 100 сообщений)
- Зарегистрирован SSE router в `backend/main.py`
- Добавлен запуск/останов SSE монитора в FastAPI lifespan
- Создан `src/app/api/flipper/prices/stream/route.ts`:
  - Next.js SSE прокси — стримит SSE от FastAPI к браузеру
- Создан `src/hooks/use-price-stream.ts`:
  - `usePriceStream()` hook — подключается к SSE, инвалидирует React Query кеш
  - Circuit breaker: останавливает реконнект после 5 неудач за 60s
  - Уважает backendOnline сигнал от health polling
  - SSE — дополнение к polling, не замена
- Интегрировано в dashboard-page.tsx:
  - `usePriceStream({ enabled: flipperBackendOnline, backendOnline: flipperBackendOnline })`
  - Инвалидирует: flipperPrices, flipperFlips, flipperTriangular, flipperOptimalCurrency, flipperTiers, flipperAnomalies, crossRates, flipperBatch, heatmap
- Добавлен QUERY_KEYS.flipperPriceStream в providers.tsx
- Исправлены 5 падающих тестов в test_optimal_currency.py:
  - Причина: тесты ожидали camelCase ключи (effectiveAnchorPrice, premiumPct, buyCurrencyId, estimatedProfitPct)
  - Backend возвращает snake_case (effective_anchor_price, premium_pct, buy_currency_id, estimated_profit_pct)
  - Обновлены ключи в тестах на snake_case
- TypeScript type-check: 0 ошибок
- Jest: 291/291 тестов пройдено
- pytest: 344/344 тестов пройдено (включая все 40 в test_optimal_currency.py)
- Обновлена документация: REFACTOR_PLAN v8.0, AGENT_NAVIGATION v7.0

Stage Summary:
- **Phase 3.2 DONE**: SSE endpoint + usePriceStream hook + интеграция + Next.js прокси
- **5 тестов FIXED**: test_optimal_currency.py — snake_case ключи
- **Новые файлы**: backend/api/routes_sse.py, src/app/api/flipper/prices/stream/route.ts, src/hooks/use-price-stream.ts
- **Изменённые файлы**: backend/main.py, src/components/dashboard/dashboard-page.tsx, src/components/providers.tsx, tests/test_optimal_currency.py
- **Точка остановки:** Фаза 3.3 (Compressed responses) или Фаза 4.2 (API versioning)
