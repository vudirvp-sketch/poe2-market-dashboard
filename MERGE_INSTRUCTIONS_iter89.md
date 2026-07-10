# iter 89 — Merge Instructions

> Архив содержит 9 изменённых файлов + 3 helper-скрипта для слияния с локальной директорией.
> Сохранена полная структура папок — просто скопируйте файлы поверх существующих.

## Что в архиве

```
iter89_archive/
├── AGENT_NAVIGATION.md                              # добавлен invariant #41 (iter 89 patterns)
├── STATUS.md                                        # полностью переписан — KI-1..KI-6 статус + iter 89 row
├── worklog.md                                       # iter 89 full detail, iter 88 trimmed to Stage Summary
├── MERGE_INSTRUCTIONS_iter89.md                     # этот файл
├── e2e/
│   └── navigation.spec.ts                           # убран "graph" из tabValues (dead iter 87 leftover)
├── scripts/
│   ├── cleanup_dead_i18n_keys.py                    # NEW — canonical dead i18n key cleanup tool
│   ├── fix_duplicate_comments.py                    # NEW — fixes duplicate "REMOVED iter 89" suffixes
│   └── restore_blank_lines.py                       # NEW — restores blank lines around REMOVED markers
└── src/
    ├── components/
    │   └── dashboard/
    │       └── shortcuts-dialog.tsx                 # KI-6 fix: updated tab mapping (7→Optimizer, 8→Analyst, 9→StorageValue, 0→Speculation)
    └── lib/
        └── i18n/
            └── locales/
                ├── en.ts                            # −30 dead keys + REMOVED iter 89 markers
                ├── ko.ts                            # −30 dead keys + REMOVED iter 89 markers
                ├── ru.ts                            # −30 dead keys + REMOVED iter 89 markers
                └── zh.ts                            # −30 dead keys + REMOVED iter 89 markers
```

## Краткое содержание iter 89

### KI-6 (новый баг, найден во время cleanup, исправлен в iter 89)

**Симптом:** диалог горячих клавиш (`shortcuts-dialog.tsx`) показывал устаревшее соответствие клавиш и вкладок:
- Диалог показывал: 7→Forecast, 8→Portfolio, 0→Watchlist
- Фактическое `TAB_MAP` в `dashboard-page.tsx`: 7→Optimizer, 8→Analyst, 9→Storage Value, 0→Speculation

**Причина:** вкладки Forecast и Portfolio были удалены в более ранних итерациях, а TAB_MAP обновлён (добавлены optimizer, analyst, storage-value, speculation), но `shortcuts-dialog.tsx` не был синхронизирован.

**Фикс:** обновлены 3 строки в `shortcuts-dialog.tsx` — теперь соответствие клавиш и вкладок актуально. Добавлен комментарий о существующем ограничении: liquid-chain + watchlist НЕ доступны через горячие клавиши (TAB_MAP имеет 13 записей, но shortcuts покрывают только индексы 0–9). Это не регрессия — так было всегда.

### Dead i18n key cleanup (основная задача iter 89)

Удалено **30 мёртвых i18n ключей × 4 локали = 120 мёртвых строк** (~3.5KB на локаль):

| Категория | Ключи | Количество | Причина |
|-----------|-------|-----------|---------|
| Currency Graph Tab | `graphCurrencies`, `graphTradePairs`, `graphDensity`, `graphArbCycles`, `graphFocusOn`, `graphAllCurrencies`, `graphZoomIn`, `graphZoomOut`, `graphResetZoom`, `graphNoData`, `graphNoDataDesc`, `graphNoNodes`, `graphAriaLabel`, `graphLegendStable`, `graphLegendModerate`, `graphLegendVolatile`, `graphLegendArbCycle`, `graphDetectedCycles`, `graphNodeDetail`, `graphNodeVolume`, `graphNodeConnections`, `graphNodeCluster` | 22 | Currency Graph tab удалён в iter 87, ключи остались в locale-файлах |
| Currency Graph SVG labels | `graphArbCycleLabel`, `graphArbCycleTooltip` | 2 | Та же причина |
| Tab labels | `tabGraph`, `tabForecast`, `tabPortfolio` | 3 | Соответствующие вкладки удалены в более ранних итерациях |
| ErrorBoundary fallback titles | `fallbackForecasts`, `fallbackPortfolio`, `fallbackCurrencyGraph` | 3 | Fallback-заголовки для удалённых вкладок — не используются в `dashboard-page.tsx` и `dashboard-dialogs.tsx` |

**Процесс:** написан Python-скрипт `scripts/cleanup_dead_i18n_keys.py` — canonical tool для будущих cleanups. Запускать после каждого удаления вкладки/диалога/фичи.

### Code health

- `e2e/navigation.spec.ts`: удалён `"graph"` из `tabValues` списка (dead iter 87 leftover). Добавлен комментарий о том, что `storage-value` + `speculation` тоже отсутствуют — оставлено как есть, чтобы не расширять scope.

### Тесты

- `tsc --noEmit` → clean
- `pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py` → **757 passed** (без изменений)
- `pytest tests/e2e/test_analyst.py` → **11 passed** (без изменений)
- `jest` → **412 passed, 19 suites passed** (без изменений)
- **Total: 768 pytest + 412 jest = 1180 tests, 0 failures**
- Количество тестов не изменилось, потому что все изменения — это удаление мёртвого кода + 1 маленький UI-фикс, который не добавляет тестируемого поведения.

## Как слить с локальной директорией

```bash
# Из корня локального репозитория poe2-market-dashboard:
cp -r /path/to/iter89_archive/* .

# Или выборочно (только изменённые файлы):
cp /path/to/iter89_archive/AGENT_NAVIGATION.md .
cp /path/to/iter89_archive/STATUS.md .
cp /path/to/iter89_archive/worklog.md .
cp /path/to/iter89_archive/e2e/navigation.spec.ts e2e/
cp /path/to/iter89_archive/src/components/dashboard/shortcuts-dialog.tsx src/components/dashboard/
cp /path/to/iter89_archive/src/lib/i18n/locales/en.ts src/lib/i18n/locales/
cp /path/to/iter89_archive/src/lib/i18n/locales/ru.ts src/lib/i18n/locales/
cp /path/to/iter89_archive/src/lib/i18n/locales/zh.ts src/lib/i18n/locales/
cp /path/to/iter89_archive/src/lib/i18n/locales/ko.ts src/lib/i18n/locales/
mkdir -p scripts
cp /path/to/iter89_archive/scripts/*.py scripts/
```

## После слияния — проверка

```bash
# 1. TypeScript type check
./node_modules/.bin/tsc --noEmit

# 2. Backend tests
python3 -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py -q

# 3. Frontend tests
./node_modules/.bin/jest --silent

# 4. Visual verification (P1, deferred from iter 89 — requires running backend + frontend)
#    - Запустите backend: ./start.sh
#    - Запустите frontend: npm run dev
#    - Откройте http://localhost:3000
#    - Проверьте диалог горячих клавиш (нажмите "?"):
#        7 → Optimizer
#        8 → Analyst
#        9 → Storage Value
#        0 → Speculation
#    - Проверьте iter 88 изменения (если ещё не проверены):
#        Speculation spread details expand button
#        Premium tooltip в Exchange tab
#        Flips tab relabel на "Cross-rate Deviations"
#        7d Change tooltip в Exchange tab
#        Analyst facts локализованы в RU locale
```

## Git commands для push

```bash
git add AGENT_NAVIGATION.md STATUS.md worklog.md \
  e2e/navigation.spec.ts \
  src/components/dashboard/shortcuts-dialog.tsx \
  src/lib/i18n/locales/en.ts \
  src/lib/i18n/locales/ko.ts \
  src/lib/i18n/locales/ru.ts \
  src/lib/i18n/locales/zh.ts \
  scripts/cleanup_dead_i18n_keys.py \
  scripts/fix_duplicate_comments.py \
  scripts/restore_blank_lines.py

git commit -m "iter 89: dead i18n key cleanup (30 keys × 4 locales) + KI-6 shortcuts dialog mismatch fix

Removed 30 dead i18n keys × 4 locales = 120 dead lines (~3.5KB per locale):
- 24 graphXxx keys (Currency Graph tab removed iter 87, keys were dead)
- tabGraph, tabForecast, tabPortfolio (corresponding tabs removed in earlier iterations)
- fallbackForecasts, fallbackPortfolio, fallbackCurrencyGraph (ErrorBoundary fallback titles for removed tabs)

KI-6 (new bug found during cleanup, fixed in iter 89):
- shortcuts-dialog.tsx was showing outdated tab mapping (7→Forecast, 8→Portfolio, 0→Watchlist)
- Actual TAB_MAP in dashboard-page.tsx was already: 7→Optimizer, 8→Analyst, 9→StorageValue, 0→Speculation
- Fixed dialog to match TAB_MAP. Pre-existing limitation documented: liquid-chain + watchlist
  are NOT reachable via keyboard shortcuts (TAB_MAP has 13 entries, shortcuts cover indices 0-9).
  Not a regression — was always this way.

Code health:
- Removed 'graph' from e2e/navigation.spec.ts tabValues (dead iter 87 leftover)
- Added 3 helper scripts under scripts/ for future i18n cleanup work

Tests: 768 pytest (757 + 11 e2e/analyst) + 412 jest pass — same as iter 88 (no test count
change because all changes were deletions of dead code + 1 small UI fix).

Files changed (9 + 3 new scripts):
- src/components/dashboard/shortcuts-dialog.tsx (KI-6 fix)
- src/lib/i18n/locales/en.ts (−30 dead keys)
- src/lib/i18n/locales/ru.ts (−30 dead keys)
- src/lib/i18n/locales/zh.ts (−30 dead keys)
- src/lib/i18n/locales/ko.ts (−30 dead keys)
- e2e/navigation.spec.ts (removed 'graph' from tabValues)
- STATUS.md (iter 89 row + KI-6 closed + Quick Reference updates)
- AGENT_NAVIGATION.md (invariant #41 + 2 new symptom rows)
- worklog.md (iter 89 full detail, iter 88 trimmed to Stage Summary)
- scripts/cleanup_dead_i18n_keys.py (NEW — canonical cleanup tool)
- scripts/fix_duplicate_comments.py (NEW — dedup helper)
- scripts/restore_blank_lines.py (NEW — blank line restoration helper)"

git push origin main
```
