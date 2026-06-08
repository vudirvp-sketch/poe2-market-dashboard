# Worklog

---
Task ID: 7
Agent: main
Task: Optimal payment for craft items (Omens, Soul Cores) + Fix currency_names typo

Work Log:
- Added `currency1CategoryApiId` and `currency2CategoryApiId` fields to `ExchangePair` type in `src/lib/types.ts`
- Updated `mapSnapshotPair()` in `src/lib/poe2api.ts` to populate categoryApiId from `raw.CurrencyOne.CategoryApiId` / `raw.CurrencyTwo.CategoryApiId`
- Added `ITEM_CATEGORIES` set and `isItemCategory()` helper to `src/lib/currency-optimal.ts`
- Added `item_categories` config field to `config.yaml` (ritual, ultimatum) and `LeagueConfig` in `backend/config.py`
- Extended frontend `clientOptimalResult` in `dashboard-page.tsx` with item-aware second pass:
  - Groups pairs where `currency1CategoryApiId ∈ ITEM_CATEGORIES`
  - For each item with 2+ pricing options, finds cheapest payment currency
- Extended backend `/optimal-currency` endpoint with item-aware grouping:
  - Builds `currency_categories` lookup from `snapshot.currency_metadata`
  - Groups rates where `currency_from` belongs to `config.league.item_categories`
  - Computes optimal payment for each item group
- Fixed critical bug: `currency_nameseta.api_id.lower()]` → `currency_names[meta.api_id.lower()]` in `routes_arbitrage.py` (NameError at runtime)
- Updated test fixture in `src/__tests__/api.test.ts` with new category fields
- Updated documentation: AGENT_NAVIGATION.md v1.11, DATA_CONTRACTS.md, worklog.md
- All checks: tsc --noEmit (0 errors), 260 Jest tests pass, 308 pytest tests pass

Stage Summary:
- Modified: src/lib/types.ts (ExchangePair + category fields), src/lib/poe2api.ts (mapSnapshotPair), src/lib/currency-optimal.ts (ITEM_CATEGORIES + isItemCategory), src/components/dashboard/dashboard-page.tsx (item-aware grouping), config.yaml (item_categories), backend/config.py (LeagueConfig.item_categories), backend/api/routes_arbitrage.py (item-aware endpoint + currency_names bugfix), src/__tests__/api.test.ts (test fixture), docs/DATA_CONTRACTS.md (ExchangePair contract)
- Modified: AGENT_NAVIGATION.md (v1.11), worklog.md
