# PoE2 Market Dashboard — План рефакторинга

> Версия: 10.0 | Дата: 2026-06-12

## Фаза 1: Унификация кеша — DONE ✅

## Фаза 2: Переиспользование данных — DONE ✅

## Фаза 3: API оптимизация

### 3.1 Batch-запросы ✅ (iter 40)
### 3.2 SSE для price updates ✅ (iter 41)
### 3.3 Compressed responses ✅ (iter 42)
- `backend/api/middleware_compression.py` — `CompressionMiddleware` (gzip + brotli)
  - Проверяет `Accept-Encoding`, предпочитает brotli (>gzip), fallback на gzip
  - Только JSON/compressible типы, минимальный размер 500 байт
  - SSE streams (text/event-stream) — НЕ сжимаются (латентность)
  - Ошибки (4xx/5xx) — НЕ сжимаются
  - Добавляет `Vary: Accept-Encoding` для корректности кешей
  - Настройка через env: `COMPRESSION_MIN_SIZE`, `COMPRESSION_GZIP_LEVEL`, `COMPRESSION_BROTLI_LEVEL`

---

## Фаза 4: Архитектурные улучшения

### 4.1 Lazy-loaded tabs ✅ (iter 40)
### 4.2 Backend API versioning ✅ (iter 43)
- Все маршруты FastAPI используют префикс `/api/v1/` (было `/api/`)
- WebSocket маршруты используют префикс `/v1/` (было без префикса)
- `X-API-Version: 1` заголовок на всех ответах (APIVersionMiddleware)
- Обновлено 12 router файлов, 22 Next.js proxy routes, batch ALLOWED_PREFIXES
- `flipper-proxy.ts` health probe: `/api/v1/health/ping`
- Все тесты обновлены на `/api/v1/` пути
- `backend/main.py`: APIVersionMiddleware добавлена после CompressionMiddleware

### 4.3 Typed API client ✅ (iter 43)
- `backend/api/response_models.py` — Pydantic response models для 28 endpoints
  - HealthResponse, PhaseResponse, CurrenciesResponse, PricesResponse
  - HeatmapResponse, PriceForPairResponse, TiersResponse, BenchmarksResponse
  - FlipsResponse, TriangularResponse, OptimalCurrencyResponse
  - EventCreateResponse, EventsListResponse, EventSummaryResponse, EventMessageResponse
  - AnomaliesResponse, StorageValueResponse
  - OptimizerPathResponse, OptimizerMatrixResponse
  - AnalystSummaryResponse, CorrelationResponse
  - ScannerResponse, LiquidChainAnalysisResponse, LiquidChainOpportunitiesResponse
- `response_model=` добавлен ко всем endpoint декораторам
- OpenAPI схема генерируется автоматически (56 схем, 26 путей)
- `src/lib/api-types.ts` — TypeScript типы из OpenAPI (3286 строк)
  - Генерация: `npx openapi-typescript openapi_schema.json --output src/lib/api-types.ts`
  - Содержит типы для всех paths и components/schemas

---

## Ключевые принципы

1. **Итеративность** — каждая фаза независима
2. **Обратная совместимость** — новые hooks не ломают существующий код
3. **Тестируемость** — каждый новый hook покрывается тестами
4. **Документация** — каждый новый файл получает JSDoc-комментарии
5. **SSE — дополнение к polling, не замена** — React Query продолжает polling, SSE добавляет push-инвалидацию
6. **Compression — прозрачный** — не ломает API контракт, только уменьшает размер ответов
7. **API Versioning — /v1/ префикс** — все маршруты под /api/v1/, заголовок X-API-Version
