# PRODUCT_VISION.md — PoE2 Market Dashboard

> Last updated: 2026-07-10 (iter 96 — Market Playbook + Circuit Patterns foundation)
> Owner: project lead (user)
> Audience: every contributor agent. Read this BEFORE proposing features.

---

## 1. One-liner

**Не очередной poe2scout / poe2ninja.** Это инструмент аналитики, систематизации и
спекулятивных подсказок для рынка Path of Exile 2 — чтобы игрок мог вовремя
увидеть, **что** фармить, **почему** и **куда** потом конвертировать лут.

---

## 2. Что мы НЕ делаем (антипаттерны)

- ❌ Копировать UI/UX poe2scout или poe2ninja.
- ❌ Быть «ещё одной биржевой доской с таблицами курсов».
- ❌ Делать ставки на моментальный снапшот цен — это уже умеет каждый сайт.
- ❌ Хранить «как есть» английские имена предметов в русском UI.

Если фича выглядит как «просто ещё одна таблица цен», она не нужна.

---

## 3. Что мы ДЕЛАЕМ (ядро ценности)

### 3.1. Полная русская локализация предметов и валюты
- Все предметы и валюты — на русском, как в русском клиенте игры.
- Источник истины: `poe2db.tw/ru/`. Данные в `backend/data/currency_names.json`
  (349 RU + 349 EN entries). TS-side fallback: `src/lib/currency-names.ts`.
- Скрипт `scripts/sync_currency_names_from_poe2db.py` — для повторного импорта
  при появлении новых api_id в POE2Scout.

### 3.2. Аналитика для спекуляций (buy low, sell high)
- **Z-score + percentile** текущей цены относительно 30-day rolling.
- Сигналы BUY (z < -1.5) / SELL (z > +1.5) / HOLD с горизонтом (short/medium/long).
- **Бэктест** сигналов на исторических данных — per-trade P&L + per-signal
  агрегаты (win_rate, mean/median/best/worst return).
- Endpoint: `GET /api/v1/speculation` + `/api/v1/speculation/backtest`.

### 3.3. «Инвестиционный» помощник — в какой валюте хранить ценность
- Метрика `storage_value(currency) = price(currency) / price(mirror)` и
  аналогично для Hinekora's Lock.
- Исторический график `currency/mirror` для топ-N валют.
- Решение `BUY_HOLD` / `SELL_CONVERT` / `NEUTRAL` на основе тренда.
- Endpoints: `GET /api/v1/storage-value/{currency}` + `/history`.

### 3.4. Поведенческие паттерны по фазам лиги
PhaseDetector (EARLY/MID/LATE) определяет текущую фазу по дням с старта лиги
или последнего major patch. Phase-aware hints дают контекстные подсказки:

| Паттерн | Когда | Что делать |
|---------|-------|------------|
| **Temporalis** дешёвый → дорогой | старт → конец лиги | покупать на старте, продавать под конец |
| Камни умений 18-20 lvl | середина-конец | следить за ростом спроса |
| **Омены ритуала** | падение оборота Ritual → рост цены | оборот упал → омены дорожают |
| **Катализаторы Разлома** | аналогично | оборот breach упал → катализаторы в дефиците |
| **Ключи реликвария** | старт-середина | дешевеют к концу при насыщении |

### 3.5. Аналитика популярности контента (что фармить сейчас)
Для каждой лиг-механики (Ritual, Breach, Delirium, Ultimatum, Expedition,
Abyss, Incursion):
- Текущий дневной оборот + 7d / 30d rolling averages.
- Сигнал rising / falling / stable (±10% threshold).
- Top-3 предмета, дорожающих / дешевеющих в категории.
- **Overheat Index** (iter 95) — composite score для post-streamer паттерна:
  volume spike + price drop → "hot" / "warm" / "cool".

### 3.6. Подсказки «куда бежать сейчас»
Главная «killer feature» — финальный вывод в одну строку:
> «Сегодня выгодно фармить **Breach**: оборот упал на 34% за неделю, катализаторы
> Ксофа подорожали на 12%. Избегать **Ritual**: оборот вырос на 50%, омены
> подешевели на 8%.»

Реализовано в Content Pulse widget на Overview tab.

### 3.7. Circuit Patterns — траектории роста валют (iter 96)
**Новый паттерн (P8 из `docs/MARKET_PLAYBOOK.md`):** автоматическая
классификация траектории цены каждой валюты в один из 7 архетипов:

| Архетип | Описание | Пример | Action |
|---------|----------|--------|--------|
| `EXPONENTIAL_GROWTH` | Лог-линейный рост, R² ≥ 0.7, total ≥ 50% | Chaos Orbs (1:1 → 1:36) | HOLD_FOR_GROWTH |
| `LINEAR_GROWTH` | Линейный рост, total 10–50% | — | HOLD_FOR_GROWTH |
| `PEAK_THEN_DECLINE` | Пик строго внутри окна, спад ≥ 20% от пика | Leveling uniques (Day 2 peak) | SELL_NOW |
| `MEAN_REVERTING` | CV < 0.15, |total change| < 10% | Exalt, Divine | NEUTRAL |
| `VOLATILE` | CV > 0.5, R² < 0.7 | Annulment Orbs | WATCH |
| `DECLINING` | Линейный спад, total ≤ -10% | — | AVOID |
| `STABLE` | CV 0.15–0.5, нет тренда | — | NEUTRAL |

**Статус iter 96:** pure function `compute_circuit_patterns()` готова в
`backend/economy/circuit_patterns.py` + 75 тестов. **Без API/UI** — iter 97
задача (см. TD-10 в STATUS.md).

### 3.8. Дорожная карта паттернов
Полный список из 20 паттернов рынка POE2 + статус реализации —
в **`docs/MARKET_PLAYBOOK.md`**. Это living-документ: при добавлении
нового паттерна обновлять и STATUS.md, и MARKET_PLAYBOOK.md.

Топ-5 на ближайшие итерации:
1. ✅ P8 Trajectory classification — iter 96 (foundation)
2. 🚧 P8 API + UI — iter 97
3. ⏳ P4 Time-of-day pattern — iter 98
4. ⏳ P5 Weekday/weekend pattern — iter 99
5. ⏳ P3 Leveling uniques lifecycle — iter 100

---

## 4. Где какие части должны жить (architecture alignment)

| Слой | Что | Где |
|------|-----|-----|
| Data | api_id → RU/EN names | `backend/data/currency_names.json` |
| Data | Исторические цены по парам | `backend/data/historical.py` (SQLite) |
| Logic | Storage value vs Mirror / Hinekora | `backend/predictors/storage_value.py` + `backend/economy/storage_value_history.py` |
| Logic | Z-score / percentile | `backend/economy/pricing.py` |
| Logic | Speculation signals + backtest | `backend/economy/speculation.py` + `speculation_backtest.py` |
| Logic | League mechanic turnover & overheat | `backend/economy/content_pulse.py` |
| Logic | PhaseDetector + phase hints | `backend/economy/lifecycle.py` + `phase_hints.py` |
| Logic | **Trajectory classification (iter 96)** | `backend/economy/circuit_patterns.py` |
| API | `/api/v1/storage-value/{currency}` + `/history` | `routes_storage_value.py` |
| API | `/api/v1/analyst/summary` | `routes_analyst.py` |
| API | `/api/v1/content-pulse` | `routes_content_pulse.py` |
| API | `/api/v1/speculation` + `/backtest` | `routes_speculation.py` + `routes_speculation_backtest.py` |
| API | `/api/v1/phase-hints` | `routes_phase_hints.py` |
| API | **`/api/v1/circuit-patterns`** (iter 97) | `routes_circuit_patterns.py` (TODO) |
| UI | Tab «Storage Value» | `storage-value-tab.tsx` + `storage-value-history-chart.tsx` |
| UI | Widget «Content Pulse» | `content-pulse-widget.tsx` (на Overview) |
| UI | Tab «Speculation» + Backtest panel | `speculation-tab.tsx` |
| UI | Widget «Phase Hints» | `phase-hints-widget.tsx` (на Overview) |
| UI | **Tab/widget «Circuit Patterns»** (iter 97) | TODO |

---

## 5. Критерии готовности продукта (Product DoD)

Продукт считается «аналитическим помощником», а не «очередным дашбордом цен»,
когда одновременно:

1. ✅ Все предметы в UI — на русском.
2. ✅ Есть экран «Storage Value» с историческим графиком относительно Mirror/Hinekora.
3. ✅ На главной — карточка «Что фармить сегодня» с обоснованием.
4. ✅ Speculation tab даёт BUY/SELL/HOLD сигналы с z-score, горизонтом и backtest'ом.
5. ✅ PhaseDetector влияет на подсказки (Temporalis mid/late league и т.д.).

**Все 5 пунктов DoD выполнены (iter 78).** Дальнейшие улучшения — операционные
(i18n cleanup iter 87, KI-1..5 fixes iter 88, FlipsTable 5 columns iter 92,
Best Payment view iter 93, Spread Capture iter 94, Overheat Index iter 95,
Circuit Patterns foundation iter 96).

---

## 6. Связанные документы

- `STATUS.md` — баги + технический рефакторинг (TD backlog).
- `docs/MARKET_PLAYBOOK.md` — **паттерны рынка POE2 (P1–P20) + дорожная карта**.
- `AGENT_NAVIGATION.md` — где что лежит в коде.
- `docs/ARCHITECTURE.md` — слои, инварианты.
- `PoE2_Flipper_Canonical_Formulas.md` — математика скоринга.
