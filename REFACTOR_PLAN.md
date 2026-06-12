# PoE2 Market Dashboard — План рефакторинга

> Версия: 3.0 | Дата: 2026-06-12

## Диагноз (resolved)

Исходные 4 проблемы:
1. ~~Дублирование вкладок~~ → FIXED (iter 34: Arbitrage→Flips, Heatmap→Overview)
2. **3 уровня кеша без координации** — ещё не начато (Phase 1.2)
3. ~~Дублирование API-запросов~~ → FIXED (iter 34-35: queryKeys + useExchangePairs + useReferenceCurrencies)
4. ~~Нет cross-rate калькулятора~~ → FIXED (iter 36: useCrossRates)

---

## Фаза 1: Унификация кеша

### 1.1 Стандартизация queryKeys + defaults ✅ (iter 34)
- `QUERY_KEYS` (25+ констант) + `STALE_TIME_DEFAULTS` в `providers.tsx`
- Статус: DONE

### 1.2 Синхронизация backend cache
- Объединить `pipeline_cache.py` + `daily_stats_cache.py` → `unified_cache.py`
- Статус: NOT STARTED

### 1.3 Prefetch при смене league/realm
- `queryClient.prefetchQuery()` в `dashboard-page.tsx`
- Статус: NOT STARTED

---

## Фаза 2: Переиспользование данных

### 2.1 Единый exchange pair store ✅ (iter 35, фактически iter 36)
- `useExchangePairs()` + `useReferenceCurrencies()` в `src/hooks/use-exchange-pairs.ts`
- `placeholderData: keepPreviousData`, `realm`/`league` params + store fallback
- 2 inline `useQuery+fetchApi` вызова в `dashboard-page.tsx` заменены на hooks
- Статус: DONE

### 2.2 Общий currency price store
- `useCurrencyItems()` + `useUniqueItems()` hooks
- Статус: NOT STARTED

### 2.3 Cross-rate калькулятор ✅ (iter 36)
- `useCrossRates()` в `src/hooks/use-cross-rates.ts`
- Делегирует вычисления `currency-optimal.ts` (buildRelativePriceMap, selectAnchor, detectCrossRateFlips)
- Возвращает: relativePriceMap, anchorId, anchorRelPrice, crossRateFlips, convertPrice(), getCrossRate()
- Принимает `exchangePairsOverride` — если данные уже загружены, не делает лишний запрос
- Интегрирован в:
  - `dashboard-page.tsx`: crossRates computed from exchangeData, передан в clientOptimalResult и FlipsTab
  - `multi-currency-price.tsx`: убраны дублированные `buildRelativePriceMap` + `effectiveAnchorPrice`, использует effectiveAnchorPrice из currency-optimal.ts + useCrossRates
  - `flips-tab.tsx`: принимает `crossRates` prop, показывает client-side cross-rate flips banner
- Убраны неиспользуемые импорты из dashboard-page.tsx: `buildRelativePriceMap`, `selectAnchor`, `detectCrossRateFlips`
- Добавлен `crossRates` query key + staleTime в `providers.tsx`
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
| 37 | Фаза 1.2: Unified backend cache | — |
| 38 | Фаза 3.1: Batch endpoint | — |
| 39 | Фаза 1.3: Prefetch при смене лиги | — |
| 40 | Фаза 4.1: Lazy-loaded tabs | — |

---

## Ключевые принципы

1. **Итеративность** — каждая фаза независима
2. **Обратная совместимость** — новые hooks не ломают существующий код
3. **Тестируемость** — каждый новый hook покрывается Jest-тестами
4. **Документация** — каждый новый файл получает JSDoc-комментарии
