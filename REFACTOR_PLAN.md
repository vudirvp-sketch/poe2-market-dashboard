# PoE2 Market Dashboard — План рефакторинга

> Версия: 5.0 | Дата: 2026-06-12

## Диагноз (resolved)

Исходные 4 проблемы:
1. ~~Дублирование вкладок~~ → FIXED (iter 34)
2. **3 уровня кеша без координации** — Phase 1.2 (NOT STARTED)
3. ~~Дублирование API-запросов~~ → FIXED (iter 34-37: queryKeys + все hooks)
4. ~~Нет cross-rate калькулятора~~ → FIXED (iter 36)

---

## Фаза 1: Унификация кеша

### 1.1 Стандартизация queryKeys + defaults ✅ (iter 34, расширен iter 37)
- `QUERY_KEYS` (30 констант) + `STALE_TIME_DEFAULTS` в `providers.tsx`
- iter 37: все queryKey в dashboard-page.tsx и use-price-alerts.ts переведены на QUERY_KEYS
- Статус: DONE

### 1.2 Синхронизация backend cache
- Объединить `pipeline_cache.py` + `daily_stats_cache.py` → `unified_cache.py`
- Примечание: PipelineCache (sync, OrderedDict+TTL+LRU) и DailyStatsCache (async, cachetools.TTLCache+stale_store) имеют фундаментально разные паттерны доступа — объединение требует осторожной архитектуры
- Статус: NOT STARTED

### 1.3 Prefetch при смене league/realm ✅ (iter 38)
- `usePrefetch()` в `src/hooks/use-prefetch.ts`
- Prefetch 4 запроса: exchangePairs, referenceCurrencies, allItems, itemCategories
- Интегрировано в dashboard-page.tsx
- Статус: DONE

---

## Фаза 2: Переиспользование данных

### 2.1 Единый exchange pair store ✅ (iter 36)
- `useExchangePairs()` + `useReferenceCurrencies()` в `src/hooks/use-exchange-pairs.ts`
- Статус: DONE

### 2.2 Общий currency price store ✅ (iter 37)
- `useCurrencyItems()` + `useAllItems()` + `useItemCategories()` в `src/hooks/use-currency-items.ts`
- `useUniqueItems()` в `src/hooks/use-unique-items.ts`
- Статус: DONE

### 2.3 Cross-rate калькулятор ✅ (iter 36)
- `useCrossRates()` в `src/hooks/use-cross-rates.ts`
- Статус: DONE

---

## Фаза 3: API оптимизация

### 3.1 Batch-запросы — NOT STARTED
### 3.2 SSE/WebSocket для price updates — NOT STARTED
### 3.3 Compressed responses — NOT STARTED

---

## Фаза 4: Архитектурные улучшения

### 4.1 Lazy-loaded tabs — NOT STARTED
### 4.2 Backend API versioning — NOT STARTED
### 4.3 Typed API client — NOT STARTED

---

## Порядок реализации

| Итерация | Что делаем | Статус |
|----------|-----------|--------|
| 33 | MultiCurrencyPrice + REFACTOR_PLAN v1 | DONE |
| 34 | Фаза 1.1 (queryKeys) + merge Arbitrage→Flips + merge Heatmap→Overview | DONE |
| 35 | Фаза 2.1: useExchangePairs() (заявлено, но файл не существовал) | CLAIMED DONE, ACTUALLY MISSING |
| 36 | Фаза 2.1 (фактически) + Фаза 2.3: useCrossRates() + интеграция | DONE |
| 37 | Фаза 2.2 + cleanup: useCurrencyItems/useUniqueItems + delete deprecated files + queryKeys normalization | DONE |
| 38 | Фаза 1.3: Prefetch при смене league/realm | DONE |
| 39 | Фаза 1.2: Unified backend cache | — |
| 40 | Фаза 3.1: Batch endpoint | — |
| 41 | Фаза 4.1: Lazy-loaded tabs | — |

---

## Ключевые принципы

1. **Итеративность** — каждая фаза независима
2. **Обратная совместимость** — новые hooks не ломают существующий код
3. **Тестируемость** — каждый новый hook покрывается Jest-тестами
4. **Документация** — каждый новый файл получает JSDoc-комментарии
