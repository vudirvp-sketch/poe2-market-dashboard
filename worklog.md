# Worklog

---
Task ID: 37
Agent: main
Task: Итерация 37 — Фаза 2.2 (useCurrencyItems/useUniqueItems) + cleanup deprecated files + queryKeys normalization

Work Log:
- Удалены 4 deprecated файла: arbitrage-tab.tsx, arbitrage-flipper-flips.tsx, arbitrage-helpers.ts, market-heatmap.tsx
- Создан `src/hooks/use-currency-items.ts` с 3 hooks:
  - `useCurrencyItems()` — paginated currency items с keepPreviousData
  - `useAllItems()` — все items (comparison, overview, alerts)
  - `useItemCategories()` — категории items
- Создан `src/hooks/use-unique-items.ts`:
  - `useUniqueItems()` — paginated unique items с keepPreviousData
- В `dashboard-page.tsx`:
  - 4 inline useQuery+fetchApi заменены на hooks (allItems, currencies, itemCategories, uniques)
  - Все queryKey строки переведены на QUERY_KEYS константы (flipperHealth, flipperPhase, flipperEventsCount, realms, leagues, flipperOptimalCurrency)
  - Убраны неиспользуемые типы ItemCategory, PaginatedResponse из импортов
  - Добавлен импорт QUERY_KEYS из providers.tsx
- В `use-price-alerts.ts`:
  - queryKey "allItems" переведён на QUERY_KEYS.allItems
  - Добавлен импорт QUERY_KEYS
- В `docs/ARCHITECTURE.md`:
  - Убрана ссылка на market-heatmap из Overview tab
  - Убрана дублирующая строка Arbitrage tab (заменена на актуальную Flips tab)
- TypeScript type-check: 0 ошибок
- Обновлена документация: REFACTOR_PLAN v4.0, AGENT_NAVIGATION v4.0

Stage Summary:
- **Phase 2.2 DONE**: useCurrencyItems/useAllItems/useItemCategories/useUniqueItems созданы и интегрированы
- **Все inline queries в dashboard-page.tsx переведены на shared hooks**
- **Все queryKey строки → QUERY_KEYS константы** в dashboard-page.tsx и use-price-alerts.ts
- **4 deprecated файла удалены**
- **Точка остановки:** Phase 1.2 (Unified backend cache) или Phase 1.3 (Prefetch при смене лиги)
