# iter 88 — Merge Instructions

> Архив содержит 27 изменённых файлов для слияния с локальной директорией.
> Сохранена полная структура папок — просто скопируйте файлы поверх существующих.

## Что в архиве

```
iter88_archive/
├── AGENT_NAVIGATION.md                              # добавлен invariant #40 (iter 88 patterns)
├── PRODUCT_VISION.md                                # добавлена iter 88 запись в changelog
├── STATUS.md                                        # полностью переписан — KI-1..KI-5 статус + iter 88 row
├── worklog.md                                       # iter 88 full detail, iter 87 trimmed to Stage Summary
├── MERGE_INSTRUCTIONS_iter88.md                     # этот файл
├── backend/
│   └── api/
│       ├── response_models.py                       # FactData + template_id + params (backward compat)
│       └── routes_analyst.py                        # _generate_facts emits template_id + params
├── src/
│   ├── __tests__/
│   │   └── speculation-tab.test.tsx                 # +7 jest тестов для spread-details (KI-1)
│   ├── app/
│   │   └── api/poe2/analyst-fallback/route.ts       # FallbackFact + templateId + params
│   ├── components/
│   │   └── dashboard/
│   │       ├── analyst-tab.tsx                      # formatFactText + TEMPLATE_ID_TO_I18N_KEY (KI-5)
│   │       ├── comparative-chart.tsx                # formatLocaleDate (date cleanup)
│   │       ├── comparison-dialog.tsx                # formatLocaleDate
│   │       ├── detail-dialog.tsx                    # formatLocaleDate × 2 call sites
│   │       ├── events-sidebar.tsx                   # refactored to formatLocaleDateTime
│   │       ├── exchange-table.tsx                   # Premium tooltip (KI-3) + 7d tooltip (KI-2)
│   │       ├── market-overview.tsx                  # formatLocaleDate
│   │       ├── pair-comparison-dialog.tsx           # formatLocaleDate
│   │       ├── pair-detail-dialog.tsx               # formatLocaleDate
│   │       ├── speculation-tab.tsx                  # /flips join + expandable spread details (KI-1)
│   │       ├── storage-value-history-chart.tsx      # formatLocaleDate
│   │       └── watchlist-tab.tsx                    # formatLocaleDate
│   ├── lib/
│   │   ├── i18n/locales/
│   │   │   ├── en.ts                                # +21 new keys (5 analystFact + 4 crossCurrencyPremium + 3 change7d + 9 speculationSpread)
│   │   │   ├── ko.ts                                # +21 new keys
│   │   │   ├── ru.ts                                # +21 new keys + tabFlips rename + arbitrageTheoretical rewrite
│   │   │   └── zh.ts                                # +21 new keys + tabFlips rename + arbitrageTheoretical rewrite
│   │   ├── types.ts                                 # LeagueFact + templateId + params
│   │   └── utils.ts                                 # formatLocaleDate + formatLocaleDateTime + localeToBcp47
└── tests/
    └── e2e/
        └── test_analyst.py                          # +7 pytest тестов для TestGenerateFactsTemplateId
```

## Как слить с локальной директорией

### Linux / macOS / Git Bash

```bash
# Из корня вашей локальной копии репозитория
cp -r /path/to/iter88_archive/* .

# Проверьте, что git видит изменения
git status
# Должно быть ~27 modified файлов (никаких new / deleted)

# Если есть untracked files в archive dir, удалите их:
rm -f MERGE_INSTRUCTIONS_iter88.md
```

### Windows (PowerShell)

```powershell
# Из корня вашей локальной копии репозитория
Copy-Item -Path C:\path\to\iter88_archive\* -Destination . -Recurse -Force

# Удалите этот файл инструкций
Remove-Item MERGE_INSTRUCTIONS_iter88.md
```

## После слияния — проверка

```bash
# Backend тесты (было 757, стало 757 — без e2e/analyst)
PYTHONPATH=. python -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py -q

# E2E analyst тесты (было 4, стало 11 — добавилось 7 template_id тестов)
PYTHONPATH=. python -m pytest tests/e2e/test_analyst.py -q

# Frontend тесты (было 405, стало 412 — добавилось 7 spread-details тестов)
npx jest

# TypeScript type check (должен быть без ошибок)
npx tsc --noEmit
```

Ожидаемый результат:
- `pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py` → **757 passed**
- `pytest tests/e2e/test_analyst.py` → **11 passed** (4 existing + 7 new TestGenerateFactsTemplateId)
- `npx jest` → **412 passed, 19 suites passed**
- `npx tsc --noEmit` → clean (no errors)

## Git-команды для коммита

```bash
git add -A
git commit -m "iter 88: KI-1..KI-5 addressed + date formatting cleanup

All 5 Known Issues from iter 87 resolved:

KI-5 (P2): analyst fact templates moved to frontend
- Backend _generate_facts now emits template_id + params alongside text
- FactData model extended with optional fields (backward compatible)
- Frontend formatFactText() formats via i18n keys, falls back to text
- 5 new i18n keys × 4 locales: analystFactBiggestGainer/Loser/AnomalyActivity/Tracking/Stable
- 7 new pytest tests in test_analyst.py::TestGenerateFactsTemplateId

KI-1 (P1): Speculation tab joins /api/flipper/flips for synthetic spread
- Parallel useQuery for /api/flipper/flips (60s staleTime)
- flipsByApiId lookup keyed by FROM currency
- SignalRow accepts optional flip prop → expandable Spread Details panel
- Shows synthetic bid/ask/spread/mid + fair rate + deviation + disclaimer
- 7 new jest tests in speculation-tab.test.tsx
- 9 new i18n keys × 4 locales

KI-2 (P2): 7d Change column tooltip
- Investigation: sevenDayChangePercent is frontend-computed
- Returns null by design on new leagues (<2 PriceLogs or drift >16.8h)
- Added tooltip on column header + on — cell explaining the null state
- 3 new i18n keys × 4 locales

KI-3 (P3): Premium column tooltip
- Column header + Info icon + tooltip explaining what Premium means
- — cell also has tooltip explaining no premium data
- 4 new i18n keys × 4 locales

KI-4 (P3): Flips tab relabel
- tabFlips: 'Flips' → 'Cross-rate Deviations' in all 4 locales
- arbitrageTheoretical disclaimer rewritten

Date formatting cleanup:
- Added formatLocaleDate/formatLocaleDateTime/localeToBcp47 in src/lib/utils.ts
- Migrated 8 chart components from inline toLocaleDateString('en-US', ...)
- Refactored events-sidebar.tsx to use shared helper

Tests: 768 pytest (757 + 11 e2e/analyst) + 412 jest pass
Files changed: 27 (3 backend + 12 frontend components + 1 infra + 1 tests + 1 API route + 1 types + 4 i18n + 4 docs)"

git push origin main
```

## Точка остановки для продолжения в новом чате (iter 89)

**Статус:** iter 88 ЗАВЕРШЁН. 768 pytest + 412 jest pass. Архив загружен на tmpfiles.org. Все 5 пользовательских жалоб (KI-1 — KI-5) адресованы.

**Что читать в новом чате:**
- `STATUS.md` — раздел "Known Issues — Deferred to iter 89" (пустой — новых Known Issues нет) + iter 88 row в Product Features
- `AGENT_NAVIGATION.md` — invariant #40 (iter 88 patterns: formatLocaleDate helper + analyst fact template_id + Speculation /flips join + Flips tab relabel + Premium tooltip + 7d Change tooltip)
- `worklog.md` — iter 88 полный detail + iter 87 Stage Summary

**Приоритеты для iter 89:**
1. **Visual verification (P1)** — manual test всех iter 88 изменений: (a) Speculation tab spread details expand button; (b) Premium column header tooltip + "—" cell tooltip; (c) Flips tab renamed to "Cross-rate Deviations" с новым disclaimer; (d) 7d Change column header tooltip + "—" cell tooltip; (e) Analyst tab facts localized (RU locale должен показывать переведённые факты, не English)
2. **KI-1 full redesign (deferred)** — если user хочет REAL buy-low/sell-high с order book, единственный путь — GGG official trade API scraping (требует OAuth2 + rate-limit handling). iter 88 partial fix выводит synthetic spread data рядом с z-score signals — это максимум без real order book.
3. **Dead i18n key cleanup (low priority)** — 4 locale files всё ещё содержат ~30 неиспользуемых `graphXxx` ключей от удалённого Currency Graph tab (iter 87). Harmless (~2KB per locale), но можно очистить.
4. **Code health** — opportunistic per-file refactoring (нет staged plan).

**Важные замечания:**
- KI-1 partial fix: synthetic bid/ask из `/flips` теперь отображается в expandable panel per signal row, но данные synthetic (volume-based formula, не real order book).
- KI-2 closed: `sevenDayChangePercent` computed frontend-side, null by design on new leagues — NOT a bug.
- KI-3/4/5 closed полностью.
- iter 88 не добавил новых Known Issues — backlog чистый.
- Speculation tab теперь делает 2 параллельных запроса (`/speculation` + `/flips`) — нагрузка на backend выросла незначительно (60s staleTime на /flips).
- Все 4 локали синхронизированы (en/ru/zh/ko) — каждый новый ключ добавлен во все 4 файла (21 ключ × 4 локали = 84 новых переводов).
- Integration test `integration.test.tsx` не изменён (3 pure-logic FlipperApiError теста из iter 87).
- `recipe.py` + `RecipeOpportunity` уже удалены в iter 87 — в iter 88 не трогались.
- Liquid Chain (config.yaml) уже очищен в iter 87 — в iter 88 не трогался.
- Phase hints backend уже имеет `?lang=ru` query param из iter 87 — в iter 88 не трогался.
