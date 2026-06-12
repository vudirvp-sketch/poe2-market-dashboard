# PoE2 Market Dashboard — План рефакторинга

> Версия: 9.0 | Дата: 2026-06-12

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
- `brotli>=1.0` добавлен в requirements.txt
- Batch endpoint: `Accept-Encoding: identity` для внутренних запросов (skip compression на localhost)
- `nginx.example.conf`: добавлены gzip/brotli директивы для static assets
- 13 тестов в `tests/test_compression.py`

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
| 42 | Фаза 3.3: Compressed responses (gzip + brotli) | DONE |
| 43 | Фаза 4.2: Backend API versioning / Фаза 4.3: Typed API client | — |

---

## Ключевые принципы

1. **Итеративность** — каждая фаза независима
2. **Обратная совместимость** — новые hooks не ломают существующий код
3. **Тестируемость** — каждый новый hook покрывается тестами
4. **Документация** — каждый новый файл получает JSDoc-комментарии
5. **SSE — дополнение к polling, не замена** — React Query продолжает polling, SSE добавляет push-инвалидацию
6. **Compression — прозрачный** — не ломает API контракт, только уменьшает размер ответов
