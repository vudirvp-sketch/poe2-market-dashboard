# PRODUCT_VISION.md — PoE2 Market Dashboard

> Last updated: 2026-06-25 (iter 77 — F5 Speculation tab shipped)
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
| Logic | PhaseDetector (старт / середина / конец лиги) | `backend/economy/lifecycle.py` |
| API | `/api/v1/storage-value/{currency}` | `routes_storage_value.py` (существует) |
| API | `/api/v1/storage-value/{currency}/history` | ✅ `routes_storage_value.py` (iter 75) — time-series of currency/mirror ratios |
| API | `/api/v1/analyst/summary` | `routes_analyst.py` (существует, расширить) |
| API | `/api/v1/content-pulse` | ✅ `routes_content_pulse.py` (iter 75) — top farming suggestions |
| API | `/api/v1/speculation` | ✅ `routes_speculation.py` (iter 77) — per-item z-score + BUY/SELL/HOLD signals |
| UI | Tab «Storage Value» (decision card + projection breakdown + historical chart) | ✅ `src/components/dashboard/storage-value-tab.tsx` (iter 74) + `storage-value-history-chart.tsx` (iter 75). |
| UI | Widget «Content Pulse — Что фармить сегодня» (top rising/falling mechanics + per-category movers) | ✅ `src/components/dashboard/content-pulse-widget.tsx` (iter 76). Mounted at the top of the Overview tab so it's visible on first dashboard load. |
| UI | Tab «Content Pulse» (полная версия) | TODO — eventual full tab with all categories, sortable, filterable. F4 widget is the 1-glance MVP per §3.6. |
| UI | Tab «Speculation» (z-score list, buy/sell suggestions) | ✅ `src/components/dashboard/speculation-tab.tsx` (iter 77). Full tab with filter chips (ALL/BUY/SELL/HOLD), days selector (7/14/30/90), per-row z-score + percentile + mini-sparkline + horizon hint. |

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

### F1. Доперевод оставшихся ~276 предметов — BLOCKED
- Парсинг `poe2db.tw/ru/` по категориям (runes, lineage support gems, uncategorized fragments).
- Скрипт `scripts/sync_currency_names_from_poe2db.py` — одноразовый/периодический импорт в `currency_names.json`.
- Запуск регрессионных тестов из `tests/test_currency_names_ru.py`.
- **Статус iter 75:** Без изменений — заблокирован на live-доступе к `poe2scout.com` (для полного списка api_id+EN_name) и `poe2db.tw/ru/` (для RU-переводов).

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

### F5. Speculation tab — z-score + buy/sell suggestions — ✅ DONE iter 77
- Для каждого предмета: z-score текущей цены vs 30-day rolling.
- Сигналы «BUY» (z < -1.5), «SELL» (z > +1.5), «HOLD» (|z| < 1).
- Бэктест на исторических данных прошлой лиги — насколько сигналы были прибыльны. *(TODO — separate task, not blocking F5 ship.)*
- **Реализовано в iter 77:**
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

### F6. Phase-aware hints (Temporalis, skill gems, etc.)
- На основе PhaseDetector показывать в Speculation tab блок
  «Исторические паттерны для текущей фазы лиги».
- Например: на 30+ день лиги — Temporalis дорожает, обратить внимание.

---

## 6. Критерии готовности продукта (Product DoD)

Продукт считается «аналитическим помощником», а не «очередным дашбордом цен»,
когда одновременно:

1. ✅ Все предметы в UI — на русском (или явно отмечены «нет перевода»).
2. ✅ Есть отдельный экран «Storage Value» с историческим графиком относительно Mirror/Hinekora. **(iter 74 — карточка решения Hold/Sell готова; iter 75 — исторический график готов)**
3. ✅ На главной — карточка «Что фармить сегодня» с конкретными механиками и обоснованием (обороты + цены). **(iter 76 — F4 widget готов, wired в Overview tab)**
4. ✅ Speculation tab даёт сигналы BUY/SELL/HOLD с z-score и горизонтом. **(iter 77 — F5 tab готов, wired как отдельная вкладка)**
5. ⬜ PhaseDetector влияет на подсказки (Temporalis mid/late league и т.д.).

До выполнения этих 5 пунктов продукт находится в стадии «аналитический MVP».

---

## 7. Связанные документы

- `STATUS.md` — баги + технический рефакторинг (P0-P3).
- `AGENT_NAVIGATION.md` — где что лежит в коде.
- `docs/ARCHITECTURE.md` — слои, инварианты.
- `PoE2_Flipper_Canonical_Formulas.md` — математика скоринга.
