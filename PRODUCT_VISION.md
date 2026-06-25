# PRODUCT_VISION.md — PoE2 Market Dashboard

> Last updated: 2026-06-26 (iter 86 — F1 CLOSED: live sync run completed, `against-the-darkness` EN-name conflict resolved inline by aligning to poe2scout's canonical full name)
> Owner: project lead (user)
> Audience: every contributor agent. Read this BEFORE proposing features.

---

## 1. One-liner

**Не очередной poe2scout / poe2ninja.** Это инструмент аналитики, систематизации и
спекулятивных подсказок для рынка Path of Exile 2 — чтобы игрок мог вовремя
увидеть, **что** фармить, **почему** и **куда** потом конвертировать лут.

---

## 2. Что мы НЕ делаем (анттипаттерны)

- ❌ Копировать UI/UX poe2scout или poe2ninja.
- ❌ Быть «ещё одной биржевой доской с таблицами курсов».
- ❌ Делать ставки на моментальный снапшот цен — это уже умеют каждый сайт.
- ❌ Хранить «как есть» английские имена предметов в русском UI.

Если фича выглядит как «просто ещё одна таблица цен», она не нужна.

---

## 3. Что мы ДЕЛАЕМ (ядро ценности)

### 3.1. Полная русская локализация предметов и валюты
- Все предметы и валюты — на русском, как в русском клиенте игры.
- Источник истины: `poe2db.tw/ru/` (PoE2 wiki). Дополнительно: `poedb.tw/ru/`,
  официальный сайт GGG. Приоритет — данные из русского клиента PoE2.
- Данные живут в `backend/data/currency_names.json` (с iter 70 — P2-3 закрыт).
- TS-side fallback-копия: `src/lib/currency-names.ts`.
- **Расширение**: добавлять новые api_id по мере их появления в POE2Scout API.
  На iter 32 зафиксировано 625 предметов в API, из них 349 имеют русский
  перевод. Цель — закрыть оставшиеся ~276 (руны, династические камни поддержки,
  часть фрагментов Разлома/Бездны).

### 3.2. Аналитика для спекуляций (buy low, sell high)
Инструмент должен уметь:
- Показывать **отклонения** текущей цены от исторического диапазона
  (z-score, %ile относительно 7/30/90 дней).
- Сигнализировать «дешевле обычного» / «дороже обычного» на каждом таймфрейме.
- Предлагать окно «купить сейчас» / «продать сейчас» с указанием ожидаемой
  доходности и горизонта.
- **Бэктестить сигналы на исторических данных** — насколько BUY/SELL сигналы
  были прибыльны при удержании позиции N дней. ✅ iter 79: endpoint
  `GET /api/v1/speculation/backtest` возвращает per-trade результаты +
  агрегаты (win_rate, mean/median/best/worst return) по BUY/SELL/overall.
  ✅ iter 80: collapsible Backtest panel inside Speculation tab — toggle button
  (NOT autoload), 3 day selectors (eval/holding/lookback), 3 stats blocks
  (Overall/BUY/SELL), signal breakdown, top-trades list.
- Помнить паттерны прошлых лиг (см. §3.4).

### 3.3. «Инвестиционный» помощник — в какой валюте хранить ценность
- Сравнение текущей покупательной способности валют по отношению к
  **Зеркалу Каландры** (топовый эталон) и **Пряди Хинекоры** (новый эталон
  PoE2 для дорогих манипуляций с предметами).
- Метрика: `storage_value(currency) = price(currency) / price(mirror)` и
  аналогично для Hinekora. Хотим видеть **тренд** этой метрики во времени —
  какая валюта «дешевеет относительно зеркала», какая «дорожает».
- Уже есть endpoint `GET /api/v1/storage-value/{currency}` (реализован в
  `backend/api/routes_storage_value.py` + `backend/predictors/storage_value.py`).
  Цель — вывести это в отдельный UI-таб «Storage Value» с историческим графиком
  и подсказками.

### 3.4. Поведенческие паттерны по фазам лиги
Известные паттерны, которые дашборд должен **автоматически** распознавать и
подсвечивать:

| Паттерн | Когда | Что делать |
|---------|-------|------------|
| **Temporalis** дешёвый → дорогой | старт лиги → конец лиги | покупать на старте, продавать под конец |
| Камни умений определённых уровней | середина-конец лиги | следить за ростом спроса на камни 18-20 lvl |
| **Омены ритуала** | падение оборота Ritual → рост цены | если оборот ритуала падает — омены дорожают |
| **Катализаторы Разлома** (Breach) | аналогично | оборот breach упал → катализаторы в дефиците |
| **Ключи реликвария** (vaultkeys) | старт-середина | обычно дешевеют к концу, когда насыщается рынок |

Механика определения: дашборд должен считать **оборот** по каждой категории
(volumé trades) и сравнивать с rolling average. Падение оборота ≥ N% за M
дней = сигнал «люди перестали туда ходить → лут станет дефицитным → цены
вырастут».

### 3.5. Аналитика популярности контента (что фармить сейчас)
Для каждой лиг-механики (Ritual, Breach, Delirium, Ultimatum, Expedition,
Abyss, Incursion) показывать:
- Текущий дневной оборот (число сделок через POE2Scout API).
- Дельту к 7-дневному и 30-дневному rolling average.
- Топ-3 предмета этой механики, которые **дорожают** при падении оборота
  (потому что предложение сокращается быстрее спроса).
- Топ-3 предмета, которые **дешевеют** при росте оборота (насыщение рынка —
  туда лучше НЕ идти, а бежать из другой механики).

### 3.6. Подсказки «куда бежать сейчас»
Финальный вывод дашборда в одну строку:
> «Сегодня выгодно фармить **Breach**: оборот упал на 34% за неделю, катализаторы
> Ксофа подорожали на 12%. Избегать **Ritual**: оборот вырос на 50%, омены
> подешевели на 8%.»

Это — главная «killer feature». Все остальные табы — вспомогательные.

---

## 4. Где какие части должны жить (architecture alignment)

| Слой | Что | Где |
|------|-----|-----|
| Data | api_id → RU/EN names | `backend/data/currency_names.json` (iter 70+) |
| Data | Исторические цены по парам | `backend/data/historical.py` (SQLite) |
| Logic | Storage value vs Mirror / Hinekora | `backend/predictors/storage_value.py` |
| Logic | Storage value history (currency/mirror time-series) | ✅ `backend/economy/storage_value_history.py` (iter 75) |
| Logic | Z-score / percentile | ✅ `backend/economy/pricing.py` (iter 77) — `compute_zscore` + `compute_percentile` pure helpers |
| Logic | League mechanic turnover & signals | ✅ `backend/economy/content_pulse.py` (iter 75) |
| Logic | PhaseDetector (старт / середина / конец лиги) | ✅ `backend/economy/lifecycle.py` + `backend/economy/phase_hints.py` (iter 78 — hardcoded hint table for EARLY/MID/LATE phases) |
| API | `/api/v1/storage-value/{currency}` | `routes_storage_value.py` (существует) |
| API | `/api/v1/storage-value/{currency}/history` | ✅ `routes_storage_value.py` (iter 75) — time-series of currency/mirror ratios |
| API | `/api/v1/analyst/summary` | `routes_analyst.py` (существует, расширить) |
| API | `/api/v1/content-pulse` | ✅ `routes_content_pulse.py` (iter 75) — top farming suggestions |
| API | `/api/v1/speculation` | ✅ `routes_speculation.py` (iter 77) — per-item z-score + BUY/SELL/HOLD signals |
| API | `/api/v1/speculation/backtest` | ✅ `routes_speculation_backtest.py` (iter 79) — backtest z-score signals on historical price_logs; returns per-trade results + per-signal aggregates |
| API | `/api/v1/phase-hints` | ✅ `routes_phase_hints.py` (iter 78) — phase-aware advisory hints (Temporalis, skill gems, etc.) |
| UI | Tab «Storage Value» (decision card + projection breakdown + historical chart) | ✅ `src/components/dashboard/storage-value-tab.tsx` (iter 74) + `storage-value-history-chart.tsx` (iter 75). |
| UI | Widget «Content Pulse — Что фармить сегодня» (top rising/falling mechanics + per-category movers) | ✅ `src/components/dashboard/content-pulse-widget.tsx` (iter 76). Mounted at the top of the Overview tab so it's visible on first dashboard load. |
| UI | Tab «Content Pulse» (полная версия) | TODO — eventual full tab with all categories, sortable, filterable. F4 widget is the 1-glance MVP per §3.6. |
| UI | Tab «Speculation» (z-score list, buy/sell suggestions + backtest panel) | ✅ `src/components/dashboard/speculation-tab.tsx` (iter 77 live + iter 80 backtest UI). Full tab with filter chips (ALL/BUY/SELL/HOLD), days selector (7/14/30/90), per-row z-score + percentile + mini-sparkline + horizon hint. Below the list — collapsible Backtest panel (toggle button, 3 day selectors, 3 stats blocks, signal breakdown, top trades). |
| UI | Widget «League Phase Hints» (Temporalis, skill gems, etc.) | ✅ `src/components/dashboard/phase-hints-widget.tsx` (iter 78). Static info banner mounted BELOW Content Pulse widget on Overview tab. Shows current phase (EARLY/MID/LATE) + days since league start + bulleted list of phase-aware advisory hints from hardcoded table. |

---

## 5. Roadmap of product features (separate from refactor backlog)

Эти пункты НЕ в STATUS.md (там — только баги и технический рефакторинг).
Они — продуктовый бэклог, который берётся в работу **после** закрытия P2/P3
или параллельно с ними, по решению владельца.

### F2. Tab «Storage Value» (ценность относительно Mirror/Hinekora) — ✅ DONE iter 74 + iter 75
- Вывести исторический график `currency/mirror` для топ-N валют. ✅ iter 75: `src/components/dashboard/storage-value-history-chart.tsx` — SVG line chart с двумя линиями (mirror/hinekora ratios), обёрнут над новым endpoint `/api/v1/storage-value/{currency}/history`.
- Подсветка валют с трендом «дорожает к зеркалу» (хранить ценность выгодно) и «дешевеет» (лучше избавиться). *(Реализовано через decision BUY_HOLD / SELL_CONVERT / NEUTRAL.)*
- **Реализовано в iter 74:** `src/components/dashboard/storage-value-tab.tsx` — отдельный UI-таб, обёртка над готовым endpoint `/api/v1/storage-value/{currency}`. Lazy-loaded, ErrorBoundary-wrapped, full i18n (en/ru/zh/ko), 12 jest tests.
- **Реализовано в iter 75 (follow-up):**
  - `backend/economy/storage_value_history.py` — pure function `compute_storage_value_history()`. Для каждой точки истории currency находит ближайшую цену mirror/hinekora (24h tolerance) и считает ratio.
  - `backend/api/routes_storage_value.py` — новый route `GET /api/v1/storage-value/{currency}/history?days=30`.
  - `src/app/api/flipper/storage-value/[currency]/history/route.ts` — Next.js proxy.
  - `src/components/dashboard/storage-value-history-chart.tsx` — dependency-free SVG chart (~290 lines), 11 jest tests.
  - 24 pytest tests в `tests/test_storage_value_history.py`.

### F1. Доперевод оставшихся ~276 предметов — ✅ DONE (iter 85 script + iter 86 live run + conflict resolved)
- Скрипт `scripts/sync_currency_names_from_poe2db.py` (iter 85) — одноразовый/периодический импорт в `currency_names.json`. 4-stage pipeline: `--fetch-ids` → `--fetch-ru` → `--diff` → `--apply --confirm`. Fallback `--from-cache-snapshot` для мейнтейнеров без live poe2scout доступа. 32 pytest tests в `tests/test_sync_currency_names.py`.
- **Статус iter 86 (F1 CLOSED):** Мейнтейнер запустил pipeline с non-RU IP. Результаты: 639 items enumerated из poe2scout, 186 EN→RU pairs scraped из poe2db.tw (8 из 17 категорий вернули данные; остальные либо 0 пар, либо 404), 297 уже переведены, **0 новых** (poe2db.tw не имеет страниц для отсутствующих items), 1 conflict, 342 no-match. **Конфликт `against-the-darkness` разрешён inline:** EN-имя в JSON было коротким ("Against the Darkness"), а RU-имя — полным ("Ключ от Реликвария Зарока: Противление тьме"). EN выровнено на каноническое полное имя "Zarokh's Reliquary Key: Against the Darkness" (совпадает с соседней записью `temporalis`). Counts unchanged: ru=349, en=349. `pytest tests/test_currency_names_ru.py` 7/7 pass. 342 no-match остаются непереведёнными — poe2db.tw просто не имеет для них страниц. Скрипт можно повторно запустить в будущем, чтобы подхватить новые переводы, которые poe2db добавит.
- Запуск регрессионных тестов из `tests/test_currency_names_ru.py` — проходят 7/7.

### F3. Module `content_pulse` — оборот механик — ✅ DONE iter 75
- Ежедневный снапшот оборота (sum of trades) по category. ✅ `today_volume` = sum of `CurrentQuantity` всех предметов категории.
- Rolling 7d / 30d averages + дельта. ✅ `_rolling_mean` + `delta_7d_pct` / `delta_30d_pct`.
- Endpoint `/api/v1/content-pulse` → top rising / falling mechanics. ✅ Возвращает sorted-by-|delta_7d| список категорий, каждая с `signal` (rising/falling/stable, thresholds ±10%) + `top_rising`/`top_falling` (top-3 предметов по % цене).
- **Реализовано в iter 75:**
  - `backend/economy/content_pulse.py` — pure function `compute_content_pulse()`. 44 pytest tests в `tests/test_content_pulse.py`.
  - `backend/api/routes_content_pulse.py` — route handler `GET /api/v1/content-pulse`.
  - Pydantic response models: `ContentPulseMoverData`, `ContentPulseCategoryData`, `ContentPulseResponse` в `backend/api/response_models.py`.

### F4. Main dashboard widget «Что фармить сегодня» — ✅ DONE iter 76
- Карточка на главной странице: 1-2 механики с растущими ценами на лут
  (спрос превышает сокращающееся предложение).
- 1-2 механики «избегать» — где предложение растёт быстрее спроса.
- **Реализовано в iter 76:**
  - `src/components/dashboard/content-pulse-widget.tsx` (~400 lines) — два-колоночная карточка: RISING (emerald) + FALLING (red). Каждая категория показывает `delta_7d_pct` badge + top-3 movers с их `trend_pct`. Footer с `fetched_at`.
  - `src/app/api/flipper/content-pulse/route.ts` — Next.js proxy к `/api/v1/content-pulse`. Возвращает empty `categories: []` + `dataAvailable: false` в offline/insufficient-data состоянии.
  - Wired в `overview-tab-content.tsx` ПЕРВЫМ (выше MarketOverview), обёрнут в `<ErrorBoundary>` — виден на первом входе в дашборд.
  - TypeScript types: `ContentPulseMover`, `ContentPulseCategory`, `ContentPulseResponse` в `src/lib/types.ts`.
  - i18n: 17 новых ключей × 4 locales (en/ru/zh/ko) включая `fallbackContentPulse`.
  - 16 jest tests в `src/__tests__/content-pulse-widget.test.tsx`: offline / loading / error / no-data / no-signals / mixed / maxPerSide / refresh / empty-movers / fetched-at / proxy path / title / item-count.
  - Graceful degradation: offline → compact amber notice; loading → spinner text; error → error card + refresh; data_available=false → "no data yet"; all stable → "no signals today".

### F5. Speculation tab — z-score + buy/sell suggestions — ✅ DONE iter 77 (live signals) + iter 79 (backtest backend) + iter 80 (backtest UI)
- Для каждого предмета: z-score текущей цены vs 30-day rolling.
- Сигналы «BUY» (z < -1.5), «SELL» (z > +1.5), «HOLD» (|z| < 1).
- Бэктест на исторических данных прошлой лиги — насколько сигналы были прибыльны. ✅ iter 79 — endpoint `GET /api/v1/speculation/backtest`. ✅ iter 80 — frontend Backtest panel.
- **Реализовано в iter 77 (live signals):**
  - `backend/economy/pricing.py` — два новых pure-хелпера `compute_zscore(prices, current)` и `compute_percentile(prices, current)`. Population std (ddof=0), 2 valid points minimum для z-score (для std≠0). Linear-interpolation percentile (numpy default).
  - `backend/economy/speculation.py` (~280 lines) — pure function `compute_speculation_signals(snapshot, config, days=30, limit=50, signal_filter="ALL")`. Для каждого item: фильтрует price_logs по окну `days`, считает z-score + percentile, строит BUY/SELL/HOLD сигнал + `horizon_hint` (short/medium/long/unknown based on |z|). Возвращает топ-N items отсортированных по |z| desc.
  - `backend/api/routes_speculation.py` — thin route handler `GET /api/v1/speculation?days=30&limit=50&signal=ALL`. Query params валидируются FastAPI (ge/le/pattern). Returns `data_available=false` + empty signals list when snapshot not loaded.
  - Pydantic response models: `SpeculationPriceHistoryPoint`, `SpeculationSignalData`, `SpeculationResponse` в `backend/api/response_models.py`.
  - 43 pytest tests в `tests/test_speculation.py` (6 классов: extract_prices / signal_from_zscore / horizon_hint / build_signal_entry / compute_speculation_signals / route handler).
  - 22 новых pytest tests в `tests/test_pricing.py` (`TestComputeZscore` + `TestComputePercentile`).
  - `src/app/api/flipper/speculation/route.ts` — Next.js proxy с `proxyWithFallback` + empty signals fallback.
  - `src/components/dashboard/speculation-tab.tsx` (~480 lines) — UI-таб. Filter chips (ALL/BUY/SELL/HOLD), days selector (7/14/30/90), per-row BUY/SELL/HOLD badge + z-score + percentile + sample-size + mean ± std + current price + horizon hint + dependency-free SVG mini-sparkline (last 14 price points). Lazy-loaded via `next/dynamic`, wrapped in `<ErrorBoundary>`. 18 jest tests.
  - Tab wired в `dashboard-page.tsx` (lazy-load + TabsContent + `speculation` added to TAB_MAP at index 9, между `storage-value` и `liquid-chain`).
  - Tab trigger в `dashboard-toolbar.tsx` (Sparkles icon).
  - 28 new i18n keys × 4 locales (en/ru/zh/ko) + 1 fallbackSpeculation. Verified parity via ripgrep.
  - TypeScript types: `SpeculationSignal`, `SpeculationResponse`, `SpeculationPriceHistoryPoint`, `SpeculationSignalType`, `SpeculationHorizonHint` в `src/lib/types.ts`.
- **Реализовано в iter 79 (backtest):**
  - `backend/economy/speculation_backtest.py` (~340 lines) — pure function `backtest_speculation_signals(snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, limit=50, signal_filter="ALL")`. Для каждого item: находит entry_price (ближайший price_log к `now - eval_days_ago` в пределах 24h tolerance), считает z-score entry vs `[entry - lookback_days, entry)` window, мапит в BUY/SELL/HOLD, находит exit_price (ближайший к `entry + holding_days`), считает realized return:
    - BUY:  `(exit - entry) / entry * 100` (profit when price rises — bought low, expect mean reversion up)
    - SELL: `(entry - exit) / entry * 100` (profit when price falls — short-sale equivalent)
    - HOLD: skip (no position taken; counted in `signal_breakdown.HOLD` but not in `trades`).
  - Возвращает: `trades` list (sorted by |return_pct| desc, capped by `limit`), `signal_breakdown` ({BUY, SELL, HOLD} counts), `evaluated_count`, `unevaluated_count` (actionable signal but no exit price within tolerance), `buy_stats` / `sell_stats` / `overall_stats` blocks (count, win_rate, mean/median/best/worst return_pct), `data_available`, `fetched_at`, `eval_days_ago`, `holding_days`, `lookback_days`.
  - `backend/api/routes_speculation_backtest.py` (~140 lines) — thin route handler `GET /api/v1/speculation/backtest?eval_days_ago=14&holding_days=7&lookback_days=30&limit=50&signal=ALL`. Query params валидируются FastAPI (`ge=1, le=365` для eval_days_ago, `ge=1, le=90` для holding_days / lookback_days, `ge=1, le=500` для limit, `pattern=^(ALL|BUY|SELL|HOLD)$` для signal). Returns `data_available=false` + empty trades + zeroed stats blocks when snapshot not loaded.
  - Pydantic response models: `SpeculationBacktestTradeData`, `SpeculationBacktestStatsBlock`, `SpeculationBacktestResponse` в `backend/api/response_models.py`.
  - 54 pytest tests в `tests/test_speculation_backtest.py` (5 классов: TestFindPriceAt / TestStatsBlock / TestBuildTradeEntry / TestBacktest* pure-function / TestRouteHandler).
  - Reuses `compute_zscore` from `backend/economy/pricing.py` (same thresholds as live signals), `_extract_prices` + `_signal_from_zscore` + `Z_BUY_THRESHOLD` / `Z_SELL_THRESHOLD` / `MIN_SAMPLE_SIZE` from `backend/economy/speculation.py` — guarantees backtest uses the same strategy as the live signal.
  - Tolerance: 24h between target timestamp and nearest price log (matches `storage_value_history.py:_NEAREST_PRICE_TOLERANCE_HOURS`).
  - Baseline window is strictly BEFORE entry timestamp (entry price itself is NOT in the baseline — avoids leaking the signal into its own computation).
  - Aggregates computed over ALL trades, not just the `limit`-capped list. `limit` only narrows the response payload.
  - Frontend UI shipped in iter 80 (see "Реализовано в iter 80" below).
- **Реализовано в iter 80 (frontend UI):**
  - `src/app/api/flipper/speculation/backtest/route.ts` (~95 lines) — Next.js proxy с `proxyWithFallback` + empty fallback (zeroed stats blocks) when backend offline.
  - `src/lib/types.ts` — 3 new TS interfaces: `SpeculationBacktestTrade` (per-trade record), `SpeculationBacktestStatsBlock` (count, winRate, mean/median/best/worst ReturnPct), `SpeculationBacktestResponse` (league, trades, signalBreakdown, evaluated/unevaluated counts, buyStats/sellStats/overallStats, dataAvailable, fetchedAt, evalDaysAgo/holdingDays/lookbackDays).
  - `src/lib/i18n/locales/{en,ru,zh,ko}.ts` — 34 new i18n keys × 4 locales (title, subtitle, run/hide toggle buttons, day-selector labels, stats labels, breakdown labels, no-data/error/loading/no-trades notices, fetched-at footer, trades-table column headers).
  - `src/components/dashboard/speculation-tab.tsx` — добавлен `BacktestPanel` subcomponent (внутри того же файла, ~400 lines) + helpers `DaySelector` + `StatsBlock` + `TradeRow`. Панель монтируется ВНУТРИ главного `CardContent` (после fetched-at футера списка signals). **NOT autoload** — toggle button (default collapsed) gates `useQuery` via `enabled: showBacktest && backendOnline`. 3 day selectors: eval_days_ago (7/14/30/90, default 14), holding_days (1/3/7/14/30, default 7), lookback_days (7/14/30/90, default 30). Parent's `signalFilter` forwarded as `signal` query param — если parent отфильтрован BUY-only, backtest тоже ищет только BUY trades. 3 stats blocks (Overall/BUY/SELL — emerald/red/neutral accents) с count + winRate + mean/median/best/worst return_pct (color-coded: green >0, red <0). Signal breakdown row: BUY N · SELL N · HOLD N + evaluated N + unevaluated N. Top-trades list (sorted by |return_pct| desc от бэкенда): каждый TradeRow показывает signal badge + item name + category + entry → exit prices + return_pct (colored).
  - Graceful degradation: collapsed (default) → только toggle button; expanded + loading → spinner; expanded + error → red notice; expanded + dataAvailable=false → "no data yet"; expanded + dataAvailable=true + trades=[] → "no trades produced"; expanded + trades>0 → full content.
  - 15 jest tests в `src/__tests__/speculation-backtest-panel.test.tsx`: collapsed default + no fetch when collapsed + toggle expands + default params forwarded + loading + error + no-data + no-trades + stats blocks render + signal breakdown + trade rows + fetched-at footer + hide-button collapse + signalFilter passthrough + day selectors render.

### F6. Phase-aware hints (Temporalis, skill gems, etc.) — ✅ DONE iter 78
- На основе PhaseDetector показывать в Speculation tab блок
  «Исторические паттерны для текущей фазы лиги».
- Например: на 30+ день лиги — Temporalis дорожает, обратить внимание.
- **Реализовано в iter 78:**
  - `backend/economy/phase_hints.py` (~210 lines) — pure function `get_phase_hints(phase, days_since_reference, ...)`. Hardcoded `_PHASE_HINTS` table: 4 hints per phase (EARLY/MID/LATE) covering Temporalis price floor→peak, skill gems 18-20 lvl demand, vault keys cheap→saturated, Breach/Ritual catalysts equilibrium/scarcity, triangular arb window, portfolio hold. Each hint has stable slug id + title + detail + action + optional category. `_PHASE_META` table provides phase_label + phase_summary. Helpers `list_phases_with_hints()` + `hint_count_for_phase()` exposed for tests.
  - `backend/api/routes_phase_hints.py` (~70 lines) — thin route handler `GET /api/v1/phase-hints`. Fetches the global `PhaseDetector` singleton via `get_phase_detector()`, calls `detector.get_phase_info()` to get phase + days_since_reference + reference_currency, then forwards to `get_phase_hints()`. Always returns `data_available=True` (hint table is hardcoded — does NOT depend on DataSnapshot). On exception returns minimal response with `data_available=False` (no 500).
  - Pydantic response models: `PhaseHintData` + `PhaseHintsResponse` в `backend/api/response_models.py`.
  - 61 pytest tests в `tests/test_phase_hints.py` (6 классов: TestPerPhase / TestPassthrough / TestMetadata / TestHelpers / TestContentSanity / TestRouteHandler).
  - `src/app/api/flipper/phase-hints/route.ts` (~40 lines) — Next.js proxy с `proxyWithFallback` + empty hints fallback.
  - `src/components/dashboard/phase-hints-widget.tsx` (~280 lines) — UI widget. Phase badge (emerald/violet/amber for EARLY/MID/LATE) + day count + reference currency + phase summary + bulleted hint list (each row: bullet + title + detail + action). `useQuery` (5min staleTime — phase only changes daily). Graceful degradation: offline → compact amber notice; loading → spinner; error → card + refresh; data_available=false → "no data" notice; empty hints → "no hints" notice.
  - Wired в `overview-tab-content.tsx` BELOW ContentPulseWidget (wrapped в `<ErrorBoundary fallbackTitle={t("fallbackPhaseHints")}>`).
  - 28 new i18n keys × 4 locales (en/ru/zh/ko) + 1 fallbackPhaseHints. Verified parity via ripgrep.
  - TypeScript types: `PhaseHint` + `PhaseHintsResponse` в `src/lib/types.ts`.
  - 26 jest tests в `src/__tests__/phase-hints-widget.test.tsx`: offline / loading / error+refresh / no-data / mixed hints / phase badge variants (Early/Mid/Late/Unknown) / day count / reference currency / hint titles/details/actions / bullet rendering / hint count footer / fetched-at / proxy path / refresh refetch / empty hints notice / data-testids.

---

## 6. Критерии готовности продукта (Product DoD)

Продукт считается «аналитическим помощником», а не «очередным дашбордом цен»,
когда одновременно:

1. ✅ Все предметы в UI — на русском (или явно отмечены «нет перевода»).
2. ✅ Есть отдельный экран «Storage Value» с историческим графиком относительно Mirror/Hinekora. **(iter 74 — карточка решения Hold/Sell готова; iter 75 — исторический график готов)**
3. ✅ На главной — карточка «Что фармить сегодня» с конкретными механиками и обоснованием (обороты + цены). **(iter 76 — F4 widget готов, wired в Overview tab)**
4. ✅ Speculation tab даёт сигналы BUY/SELL/HOLD с z-score и горизонтом. **(iter 77 — F5 live tab готов; iter 79 — F5 backtest backend готов; iter 80 — F5 backtest UI готов, toggle-driven panel под списком сигналов)**
5. ✅ PhaseDetector влияет на подсказки (Temporalis mid/late league и т.д.). **(iter 78 — F6 Phase-aware hints widget готов, wired в Overview tab)**

**Все 5 пунктов DoD выполнены (iter 78).** Продукт перешёл из стадии «аналитический MVP» в стадию «аналитический помощник». Дальнейшие улучшения — операционные (F1 sync script shipped iter 85 + live-run verified iter 86 — F1 CLOSED; полная Content Pulse tab; config-driven phase hints — useDashboardData hook extraction COMPLETE: Stage 1 в iter 81, Stage 2 в iter 82, Stage 3a в iter 83, Stage 3b в iter 84; `dashboard-page.tsx` теперь 995 строк, было 1685 в iter 70) и не блокируют основной use case. F5 backtest полностью закрыт в iter 80 (backend + frontend UI).

---

## 7. Связанные документы

- `STATUS.md` — баги + технический рефакторинг (P0-P3).
- `AGENT_NAVIGATION.md` — где что лежит в коде.
- `docs/ARCHITECTURE.md` — слои, инварианты.
- `PoE2_Flipper_Canonical_Formulas.md` — математика скоринга.
