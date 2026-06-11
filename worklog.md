# Worklog

---
Task ID: 33
Agent: main
Task: Итерация 33 — Анализ poe2db.tw, создание MultiCurrencyPrice, план рефакторинга

Work Log:
- Создал `multi-currency-price.tsx` — отображение цены в нескольких валютах
- Обновил `detail-dialog.tsx` — добавил MultiCurrencyPrice
- Добавил i18n ключи (5 ключей × 4 локали)
- Создал `REFACTOR_PLAN.md` v1.0
- Обновил `AGENT_NAVIGATION.md`

Stage Summary:
- MultiCurrencyPrice + DetailDialog integration
- REFACTOR_PLAN v1.0 (4 фазы)
- Точка остановки: Phase 1.1 (стандартизация queryKeys)

---
Task ID: 34
Agent: main
Task: Итерация 34 — Аудит вкладок, стандартизация queryKeys, merge Arbitrage→Flips, merge Heatmap→Overview

Work Log:
- Провёл аудит всех 11 вкладок: оценена ценность, дублирование, сложность каждой
- Обновил REFACTOR_PLAN.md до v2.0 с детальным аудитом вкладок (таблица + вердикты)
- Стандартизировал все queryKeys: `["exchange", ...]` → `["exchangePairs", ...]`, `["flipper-heatmap", ...]` → `["heatmap", ...]`, все flipper-ключи в camelCase
- Добавил `QUERY_KEYS` константы и `STALE_TIME_DEFAULTS` в `providers.tsx` (25+ ключей с per-key staleTime)
- Объединил ArbitrageTab + FlipsTab в единую FlipsTab: добавлены stats row (6 карточек), disclaimer, ArbitrageFlipperTriangular секция, FlipperPhaseResponse query
- Убрал standalone MarketHeatmap из рендера Overview (функционал уже есть в MarketOverview)
- Пометил arbitrage-tab.tsx и market-heatmap.tsx как DEPRECATED
- Обновил AGENT_NAVIGATION.md: добавил §4 (Query Key Convention), §5 (Tab Structure), обновил критические правила

Stage Summary:
- **queryKeys:** 30+ инстансов стандартизировано
- **providers.tsx:** QUERY_KEYS (25 констант) + STALE_TIME_DEFAULTS (25 записей) + setQueryDefaults()
- **Tab merge:** 11 → 10 вкладок. ArbitrageTab → FlipsTab
- **MarketHeatmap:** убран из рендера, помечен DEPRECATED
- **REFACTOR_PLAN.md:** v2.0 с аудитом вкладок
- **Точка остановки:** Phase 2.1 (useExchangePairs hook)

---
Task ID: 35
Agent: main
Task: Итерация 35 — Фаза 2.1: useExchangePairs() hook + замена всех fetchApi("/api/poe2/exchange", ...) вызовов

Work Log:
- Создал `src/hooks/use-exchange-pairs.ts` с двумя hooks: `useExchangePairs()` и `useReferenceCurrencies()`
- Оба hook используют `QUERY_KEYS` из providers.tsx для единых queryKey
- Оба hook включают `placeholderData: keepPreviousData` для плавных переходов при смене league/realm
- Заменил 5 inline useQuery+fetchApi вызовов на hooks:
  - `watchlist-tab.tsx`: action "pairs" → `useExchangePairs({ snapshot: true })`
  - `volume-liquidity-indicators.tsx`: action "pairs" → `useExchangePairs()`
  - `detail-dialog.tsx`: action "pairs" → `useExchangePairs()`
  - `dashboard-page.tsx`: action "pairs" → `useExchangePairs({ snapshot: true })`
  - `dashboard-page.tsx`: action "reference" → `useReferenceCurrencies()`
- Убрал неиспользуемые импорты (useQuery, fetchApi) из файлов, где они больше не нужны
- TypeScript type-check: 0 ошибок в изменённых файлах
- Обновил REFACTOR_PLAN.md: Phase 2.1 → DONE
- Обновил AGENT_NAVIGATION.md: §8 (Shared Hooks), правило #16, обновлён src/hooks/ description

Stage Summary:
- **useExchangePairs()**: единый hook для exchange pairs, `placeholderData: keepPreviousData`, per-consumer overrides (enabled, snapshot, refetchInterval, staleTime, retry)
- **useReferenceCurrencies()**: единый hook для reference currencies, `placeholderData: keepPreviousData`
- **5 вызовов** `fetchApi("/api/poe2/exchange", ...)` заменены на hooks (0 осталось в компонентах)
- **REFACTOR_PLAN.md**: Phase 2.1 marked DONE
- **AGENT_NAVIGATION.md**: §8 Shared Hooks, rule #16
- **Точка остановки:** Phase 2.3 (useCrossRates hook) — следующая итерация
