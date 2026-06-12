# Worklog

---
Task ID: 33
Agent: main
Task: Итерация 33 — MultiCurrencyPrice + REFACTOR_PLAN v1

Stage Summary:
- MultiCurrencyPrice + DetailDialog integration
- REFACTOR_PLAN v1.0 (4 фазы)
- Точка остановки: Phase 1.1

---
Task ID: 34
Agent: main
Task: Итерация 34 — queryKeys, merge Arbitrage→Flips, merge Heatmap→Overview

Stage Summary:
- queryKeys: 30+ инстансов стандартизировано, QUERY_KEYS (25 констант) + STALE_TIME_DEFAULTS
- Tab merge: 11 → 10 вкладок. ArbitrageTab → FlipsTab
- Точка остановки: Phase 2.1

---
Task ID: 35
Agent: main
Task: Итерация 35 — useExchangePairs() (заявлено, но файл не существовал в репо)

Stage Summary:
- **ВНИМАНИЕ:** Worklog итерации 35 неточный — файл use-exchange-pairs.ts не был создан
- Фактическое создание хуков выполнено в итерации 36

---
Task ID: 36
Agent: main
Task: Итерация 36 — Фаза 2.1 (фактически) + Фаза 2.3: useCrossRates() + интеграция

Work Log:
- Обнаружил, что `src/hooks/use-exchange-pairs.ts` не существует (worklog iter 35 неточный)
- Создал `src/hooks/use-exchange-pairs.ts` с `useExchangePairs()` и `useReferenceCurrencies()`
  - Оба hook используют `QUERY_KEYS` из providers.tsx
  - Оба hook включают `placeholderData: keepPreviousData`
  - Принимают `realm`/`league` как параметры + fallback на store
- Создал `src/hooks/use-cross-rates.ts` с `useCrossRates()`
  - Делегирует вычисления в `currency-optimal.ts` (buildRelativePriceMap, selectAnchor, detectCrossRateFlips)
  - Возвращает: relativePriceMap, anchorId, anchorRelPrice, crossRateFlips, convertPrice(), getCrossRate()
  - Принимает `exchangePairsOverride` — если данные уже загружены, не делает лишний API запрос
- Заменил 2 inline useQuery+fetchApi вызова в `dashboard-page.tsx`:
  - reference currencies: `useQuery+fetchApi` → `useReferenceCurrencies({ realm, league: effectiveLeague })`
  - exchange pairs: `useQuery+fetchApi` → `useExchangePairs({ realm, league: effectiveLeague, snapshot: true })`
- Интегрировал `useCrossRates` в `dashboard-page.tsx`:
  - `crossRates = useCrossRates({ exchangePairsOverride: exchangeData })` — использует уже загруженные данные
  - `clientOptimalResult` теперь использует `crossRates.relativePriceMap/anchorId/crossRateFlips` вместо дублирующих вычислений
  - Убраны импорты `buildRelativePriceMap`, `selectAnchor`, `detectCrossRateFlips` из currency-optimal
- Интегрировал `useCrossRates` в `multi-currency-price.tsx`:
  - Убраны дублированные `buildRelativePriceMap()` и `effectiveAnchorPrice()` — теперь из `currency-optimal.ts` + `useCrossRates()`
  - Добавлен prop `crossRates?: CrossRatesResult` для передачи pre-computed данных
  - Добавлен `useCrossRates({ exchangePairsOverride })` для внутреннего использования
- Интегрировал `useCrossRates` в `flips-tab.tsx`:
  - Добавлен prop `crossRates?: CrossRatesResult`
  - Добавлен "Cross-Rate Opportunities" banner (показывается когда crossRateFlips.length > 0 и нет triData.crossRateWarning)
- Добавил `crossRates` в `QUERY_KEYS` + `STALE_TIME_DEFAULTS` в `providers.tsx`
- TypeScript type-check: 0 ошибок
- Обновил документацию: REFACTOR_PLAN v3.0, AGENT_NAVIGATION v3.0

Stage Summary:
- **useExchangePairs() + useReferenceCurrencies()**: созданы, интегрированы в dashboard-page.tsx
- **useCrossRates()**: создан, интегрирован в dashboard-page, MultiCurrencyPrice, FlipsTab
- **Дублирование устранено:** buildRelativePriceMap/effectiveAnchorPrice больше не дублируются в компонентах
- **QUERY_KEYS**: добавлен crossRates
- **Точка остановки:** Phase 2.2 (useCurrencyItems/useUniqueItems) или Phase 1.2 (Unified backend cache)
