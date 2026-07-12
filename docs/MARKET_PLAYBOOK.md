# MARKET_PLAYBOOK.md — паттерны рынка POE2 и дорожная карта дашборда

> **Last updated:** 2026-07-13 (iter 142 — doc cleanup: P10 Gold Map ROI marked SHIPPED, sections C.1–C.7 iter-by-iter detail trimmed to concise pointer to git log, §D.3 outdated iter-110 stop-point removed.)
> **Source:** анализ видео-гайда «Step By Step Currency Making Guide In POE 2» + кодовая база проекта.
> **Цель:** превратить дашборд из «копирки scout/ninja» в инструмент, который **сам** находит схемы заработка. Каждый паттерн здесь → либо уже реализован, либо имеет конкретный план реализации.

---

## 0. Как читать этот документ

- **Часть A** — извлечённые из гайда паттерны, логика и алгоритмы (что делает игрок).
- **Часть B** — соответствие паттернов текущей кодовой базе (что уже есть).
- **Часть C** — план реализации недостающих паттернов (что и как добавлять).
- **Часть D** — приоритеты и точки остановки по итерациям.

---

## A. Извлечённые паттерны (что делает игрок)

### P1. Треугольный арбитраж (3-way flips)
**Логика.** Игрок ищет цепочки A → B → C → A, где произведение курсов даёт прибыль. Пример из гайда: купить 100 Alch за 25 Exalt → продать 100 Alch за 150 Regal → продать 150 Regal за 30 Exalt → прибыль 5 Exalt за 5–10 минут.
**Ключевой инсайт.** Искать надо не «пару к Exalt», а именно 3-way пары — на прямых парах маржа минимальна, на треугольниках её не видят ленивые игроки.

### P2. Жизненный цикл курсов на старте лиги
**Логика.** В Day 1–2 курсы быстро мигрируют: Alch:Regal 1:2, Regal:Alch 1:2, Alch/Regal:Exalt 1:1, Exalt:Chaos 1:1, Chaos:Exalt 1:2 → 1:3–5. Это «перетекание ликвидности» — игроки конвертируют низшие орбы в Exalt по мере роста запасов.
**Алгоритм.** Отслеживать все пары на старте лиги и сигнализировать, когда курс делает скачок (например, Exalt:Alch сдвинулся с 1:1 на 1:3 за день).

### P3. Жизненный цикл leveling-уников
**Паттерн.** Day 1: 1–10 Exalt → Day 2: 10–20 Exalt (пик спроса на прокачку) → Day 3+: падение обратно.
**Пример.** Polcirkeln Sapphire Ring — найден через Unique Ring Remnants Crafting, продан за 15 Exalt (пол-Div) на Day 1.
**Алгоритм.** Для каждого leveling-уника отслеживать форму кривой цены. «Spike-then-crash» — пик на Day 2, затем спад. Сигнализировать: «Сейчас Day 2 — окно продажи X», «Сейчас Day 3+ — не покупайте».

### P4. Внутрисуточный паттерн (US/EU/Asia)
**Паттерн.** Когда просыпается Азия — предложение растёт (фермаеры сбрасывают лут), цены падают на 10–20%. Когда просыпаются US/EU — спрос растёт, цены поднимаются. Дополнительно: курс Divine:Exalt на 3–5% лучше, когда US/EU засыпают.
**Алгоритм.** Для каждой валюты посчитать среднюю цену по часу суток (UTC) за последние N дней. Показывать хитмэп «час × валюта» и подсвечивать «buy window» (Asia-wake) и «sell window» (US/EU-wake).

### P5. Недельный паттерн (weekday vs weekend)
**Паттерн.** Perfect Jewelers Orb в будни на 20–30% дешевле (через Exalt), в выходные на 30% дороже (через Divine). Аналогично — повышенный спрос на дорогие орбы в выходные.
**Алгоритм.** Посчитать среднюю цену по дню недели (Mon–Sun). Флаг «значимый weekday/weekend delta» — если |mean_weekday − mean_weekend| / mean > порог (например, 10%).

### P6. Priority Listing Arbitrage (механика самого trade-site)
**Паттерн.** Из-за приоритетного отображения listings, предметы, выставленные в Annu/Chaos-орбах, могут стоить **больше** в эффективных Divines, но показываться **выше** в поиске. Игроки листят в alt-orbs → продают с прибылью 0.5–1 Div → откупают за Divines → повторяют. Это вызывает краткосрочный надув и последующий крах Annu/Chaos.
**Алгоритм.** Для каждого предмета сравнить: цена в Divines vs (цена в Chaos × Chaos:Divine) vs (цена в Annu × Annu:Divine). Если alt-orb-цена эффективно дороже Divine-цены на > N% → флаг «priority listing arb opportunity». Дополнительно: детектор надува Annu/Chaos (резкий рост + последующий крах) = раннее предупреждение.

### P7. Mirror ↔ Divine Arbitrage на дорогих предметах
**Паттерн.** Для chase-уников (1+ Mirror): продать за 1 Mirror → откупить за Divines (или наоборот) → 100–200 Div прибыли из-за колебаний курса Mirror:Divine.
**Пример.** Купил 49% Adored за 8700 Div → продал за 2 Mirror → продал 2 Mirror за 9200 Div (+500 Div). Voice: купил 4500 Div → продал 1 Mirror (+100 Div).
**Алгоритм.** Отслеживать курс Mirror:Divine. Для предметов ≥ 1 Mirror: показывать оба способа оплаты (Mirror vs Divines) и фиксировать разницу. Когда разница > 100 Div → флаг.

### P8. Траектория роста валюты (Chaos-паттерн)
**Паттерн.** Chaos Orbs: 1:1 Exalt (Week 1) → 1:2 → 1:5 → 1:10 → 1:36 (Week 2+). То есть экспоненциальный рост на протяжении лиги. Автор купил 5000 Chaos за 5000 Exalt на Week 1, продал за 25000 Exalts на Week 2 (+400%).
**Алгоритм.** Для каждой валюты классифицировать траекторию: `EXPONENTIAL_GROWTH` / `LINEAR_GROWTH` / `PEAK_THEN_DECLINE` / `MEAN_REVERTING` / `VOLATILE` / `DECLINING` / `STABLE`. Для `EXPONENTIAL_GROWTH` — рекомендовать HOLD; для `PEAK_THEN_DECLINE` — SELL; для `DECLINING` — AVOID.

### P9. Investment Lifecycle (по фазам лиги)
**Паттерн.** Конкретные окна прибыльности:
- Week 1–2: Omen of Light, Perfect Jewelers Orb, Chaos Orbs, Soul Cores → 200–300% profit.
- Week 2–3: Mirror (цена падает в выходные, потом растёт).
- Week 1+: Hinekora's Lock (народ ещё не крафтит).
**Алгоритм.** Phase-aware investment advisor: на основе текущего дня лиги показывать «что покупать сейчас». Таблица: phase × item → рекомендуемое действие.

### P10. Gold Map ROI (Castaway runs)
**Паттерн.** Castaway map = 500k gold за пробег. Стоимость 1–2 Div в первую неделю. Автор считает: «если 500k gold через 3-way flips дают 5 Div, минус 2 Div за map = 3 Div чистой прибыли».
**Алгоритм.** Калькулятор: `expected_div = (gold × best_3way_rate) − map_cost`. Флаг, когда ROI > порог → рекомендовать фарм.

### P11. Meta Build Item Live Searches (Megalomaniac и +3 Prism)
**Паттерн.** Megalomaniac diamonds с 1–2 хорошими нодами: покупка за 1–2 Div → продажа за 20–40 Div. +3 Prism Skill Gems (+3 Spectre купил за 60 Div → продал за 199 Div; +3 Companions купил за 200 Div → продал за 409 Div).
**Алгоритм.** Поддерживать библиотеку «meta-build фильтров». Для каждого билда — список хороших аффиксов/нод. Live-сканировать listings и флагать underpriced.

### P12. Tablet resell
**Паттерн.** Купить tablet за 3–5 Div → перепродать за 10+ Div (Temple Monkey взлетал до 25 Div; автор продал слишком рано).
**Алгоритм.** Отслеживать цены tablets по категориям. Сигнализировать underpriced listings.

### P13. Crafting Profit Discovery
**Паттерн.** Raven-Touched Unique Gloves: крафт за 20–30 Div → продажа за 100–250 Div (1000+ Div прибыли за 2 дня). Аналогично — Orb of Sacrifice в 0.5.4.
**Алгоритм.** Для каждого крафтового ввода (Orb of Sacrifice, Raven-Touched Gloves, Anointment oils) отслеживать цену готового результата. Считать `profit = output_price − input_cost`. Флаг при margin > порог.

### P14. Side income: масс-листинг мета-камней
**Паттерн.** Uncut Support lvl 1–5 продаётся за 1–5 Exalt. Когда игроки богатеют, они покупают конкретные камни (Feeding Frenzy 2, Muster) за 5–10 Exalt вместо Uncut.
**Алгоритм.** Сравнивать: цена Uncut Support vs цена готового мета-камня. Если gap растёт → рекомендовать листить готовые.

### P15. Vendor gold strategy
**Паттерн.** Продавать рары за 500/1000+ gold вендору → копить на Exchange fees (в Act 4).
**Алгоритм.** Не относится к маркет-дашборду напрямую (это gameplay), но дашборд может показывать «gold → Divine конверсию через Exchange».

### P16. Reinvestment strategy
**Паттерн.** Не копить Divines. Реинвестировать в: (а) better gear → faster mapping, (b) growth orbs (Omens, Perfect Jewelers, Chaos, Soul Cores).
**Алгоритм.** Ранжировать варианты реинвеста по ожидаемому росту. Показывать топ-3 «куда вложить Divine сейчас».

### P17. New Season Items Discovery
**Паттерн.** Следить за патч-нотами — новые предметы (Orb of Sacrifice в 0.5.4) создают краткосрочный спрос.
**Алгоритм.** При событии `major_patch` / `minor_patch` — автоматически сканировать новые api_id и помечать их как «watch list».

### P18. Market Trend Detection (Origin, Frags, hypes, sell-offs)
**Паттерн.** Внимание к Origin (Divinity Arbiter Tickets), фрагам, связанным хайпам и sell-off волнам. Топ предметов: T15/16 maps, Tablets, 5-socket +1/+1 23% meta gems, +4 Skill amulets (после 20% quality → 34%).
**Алгоритм.** Сканер sudden volume spike + price movement по категориям. Алерт при одновременном: `volume_today > 2× rolling_7d` AND `|price_change| > 10%`.

### P19. Meta gem demand divergence
**Паттерн.** Когда игроки богатеют, готовый мета-камень (5–10 Exalt) дорожает относительно Uncut Support (1 Exalt).
**Алгоритм.** Для каждой пары (Uncut Support, готовый камень) отслеживать ratio. Если ratio растёт → рекомендовать крафтить и листить готовые.

### P20. Skill gem quality crafting
**Паттерн.** +4 Skill amulets после 20% quality → доводка до 34% quality → продажа с прибылью.
**Алгоритм.** Отслеживать цены «сырых» и «качественных» предметов. Считать `profit = quality_price − raw_price − quality_orb_cost`.

---

## B. Соответствие кодовой базе (что уже есть)

| Паттерн | Где реализовано | Статус |
|---------|-----------------|--------|
| **P1** Triangular arb | `backend/arbitrage/triangular.py` + `routes_arbitrage.py` `/flips` | ✅ Готово. TD-3: нет persistence/backtest — на roadmap. |
| **P2** Rate lifecycle | Частично: `speculation.py` (z-score) + `phase_hints.py` (статичные подсказки) | ⚠️ Нет визуализации «миграции курсов на старте». |
| **P3** Leveling uniques lifecycle | `backend/economy/leveling_uniques.py` (iter 100) + `routes_leveling_uniques.py` + UI widget `leveling-uniques-widget.tsx` | ✅ Готово. Static table (10 leveling уников) + pure function `compute_leveling_uniques_lifecycle()` (86 pytest) + API route `/api/v1/leveling-uniques` + Next.js proxy + UI widget на Overview (между PhaseHints и MarketOverview) с lifecycle stage badges (PRE_PEAK / AT_PEAK / POST_PEAK) + recommendation badges (BUY/HOLD / SELL NOW / AVOID BUYING) + est. price heuristic + i18n × 4 locales (31 ключ × 4) + 28 jest-тестов. Зависит только от PhaseDetector — иммунен к KI-11 (upstream API 404). |
| **P4** Time-of-day pattern | `backend/economy/intraday_patterns.py` (iter 98) + `routes_intraday_patterns.py` + UI tab `intraday-patterns-tab.tsx` | ✅ Готово. Pure function (89 unit-тестов) + API route `/api/v1/intraday-patterns` + Next.js proxy + UI heatmap tab (час × валюта) с buy/sell window badges + i18n × 4 locales (43 ключа × 4) + 23 jest-теста + 4 pytest route smoke-теста. |
| **P5** Weekday/weekend pattern | `backend/economy/weekly_patterns.py` (iter 99) + `routes_weekly_patterns.py` + UI tab `weekly-patterns-tab.tsx` | ✅ Готово. Pure function (99 unit-тестов) + API route `/api/v1/weekly-patterns` + Next.js proxy + UI heatmap tab (день недели × валюта) с buy/sell day badges + weekday_delta_pct (weekend vs weekday) + i18n × 4 locales (50 ключей × 4) + 25 jest-тестов + 4 pytest route smoke-теста. |
| **P6** Priority Listing Arb | Нет | ❌ Требует данных trade-site, которых у нас нет (POE2Scout не отдаёт listings по alt-orbs отдельно). Доступно только через GGG official trade API. |
| **P7** Mirror ↔ Divine arb | `backend/economy/mirror_divine_arb.py` (iter 108) + `routes_mirror_divine_arb.py` + Next.js proxy + UI tab (iter 109) | ✅ Готово (end-to-end). Backend: pure function `compute_mirror_divine_arb()` (70 pytest) + API route `/api/v1/mirror-divine-arb` + Next.js proxy + TS types. Single-object response (Mirror:Divine = one market). UI (iter 109): `mirror-divine-arb-tab.tsx` — single-card render with current rate / z-score / deviation / signal+action badges / sparkline + 7/14/30/90-day selector. 42 i18n keys × 4 locales. Profit threshold = 100 Div per Mirror (per playbook). |
| **P8** Trajectory classification | `backend/economy/circuit_patterns.py` (iter 96) + `routes_circuit_patterns.py` + UI tab `circuit-patterns-tab.tsx` (iter 97) | ✅ Готово. Pure function (75 unit-тестов) + API route `/api/v1/circuit-patterns` + Next.js proxy + UI tab с бейджами траекторий и mini-sparkline + i18n × 4 locales (47 ключей × 4) + 20 jest-тестов + 4 pytest route smoke-теста. |
| **P9** Phase-aware investment | `phase_hints.py` (iter 78 + iter 110 live-price binding) | ✅ Готово (iter 110). Static table 4 hints/phase + live-price enrichment: 3 hints tracked (exalted/divine) with current_price / change_pct_week / change_pct_month / momentum / phase-aware recommendation. |
| **P10** Gold Map ROI | `backend/economy/triangular_cycles.py` (TD-3) + `src/components/dashboard/gold-map-roi-tab.tsx` + `gold-map-roi-calculator.tsx` + `gold-map-roi-trend-chart.tsx` | ✅ Готово (end-to-end). Phase 1 (MVP) SHIPPED iter 127 — calculator reuses `/api/v1/arbitrage/triangular` best 3-way rate. Phase 2 (trend chart) SHIPPED iter 132 — reuses `/api/v1/arbitrage/triangular/history` (TD-3 SQLite persistence). See `docs/design/P10-gold-map-roi-design.md`. |
| **P11** Megalomaniac / +3 Prism scanner | Нет | ❌ Требует GGG trade API (фильтрация по аффиксам). |
| **P12** Tablet resell | Нет | ❌ Требует item-level данных, которых POE2Scout не отдаёт. |
| **P13** Crafting Profit Discovery | Нет | ❌ Требует GGG trade API. |
| **P14** Meta gem mass listing | Нет | ❌ Требует GGG trade API. |
| **P15** Vendor gold strategy | Нет (out of scope) | ⏸️ Не относится к маркет-дашборду. |
| **P16** Reinvestment ranking | Частично: `storage_value.py` (какая валюта «дорожает к Mirror») | ⚠️ Есть метрика, нет ranking-виджета. |
| **P17** New Season Items | Частично: `events.py` (patch event tracking) | ⚠️ События есть, автодетект новых api_id — нет. |
| **P18** Market trend (volume spike + price move) | ✅ `content_pulse.py` (iter 95 — Overheat Index) | ✅ Готово. Можно расширить на specific item-уровень. |
| **P19** Meta gem demand divergence | Нет | ❌ Нужны данные по конкретным камням. |
| **P20** Skill gem quality crafting | Нет | ❌ Нужны данные по quality-модификаторам. |

**Резюме.** Из 20 паттернов:
- 10 полностью готовы (P1, P3, P4, P5, P7, P8, P9, P10, P18, частично P16/P17).
- 3 частично готовы (P2, P16, P17) — нужна доработка.
- 7 не реализованы. Из них:
  - **P6, P11, P12, P13, P14, P19, P20** — требуют GGG official trade API (не в scope без OAuth2).

---

## C. План реализации (что и как добавлять)

> **iter-by-iter detail records trimmed iter 142** — исторические записи реализации P3/P4/P5/P7/P8/P9/P10 (итеры 96–110, 127, 132) находятся в `git log` (коммиты с тегами `iter 96` … `iter 132`). Ниже — только канонический статус каждого паттерна, реализованного на текущих данных POE2Scout.

### Реализованные паттерны (canonical status)

| Паттерн | iter | Backend pure function | Route handler | UI tab/widget |
|---------|------|----------------------|---------------|---------------|
| **P8** Circuit Patterns | 96–97 | `backend/economy/circuit_patterns.py:compute_circuit_patterns(snapshot, config, *, days=30, limit=50, trajectory_filter="ALL", now=None)` — 7 архетипов (EXPONENTIAL_GROWTH / LINEAR_GROWTH / PEAK_THEN_DECLINE / MEAN_REVERTING / VOLATILE / DECLINING / STABLE) + recommended_action. 75 pytest. | `GET /api/v1/circuit-patterns?days=&limit=&trajectory=` | `circuit-patterns-tab.tsx` — filter chips (ALL + 7 архетипов) + days selector (7/14/30/90) + per-row trajectory badge + mini-sparkline. 20 jest. |
| **P4** Intraday Patterns | 98 | `backend/economy/intraday_patterns.py:compute_intraday_patterns(snapshot, config, *, days=14, limit=50, now=None)` — per-UTC-hour aggregation 0..23 + buy/sell window detection + intraday_range_pct (≥10% = significant). 89 pytest. | `GET /api/v1/intraday-patterns?days=&limit=` | `intraday-patterns-tab.tsx` — heatmap (currencies × UTC hours) + buy/sell window badges. 23 jest. |
| **P5** Weekly Patterns | 99 | `backend/economy/weekly_patterns.py:compute_weekly_patterns(snapshot, config, *, weeks=4, limit=50, now=None)` — per-ISO-weekday aggregation 1..7 + buy/sell day detection + weekday_delta_pct. 99 pytest. | `GET /api/v1/weekly-patterns?weeks=&limit=` | `weekly-patterns-tab.tsx` — heatmap (currencies × 7 weekdays) + buy/sell day badges. 25 jest. |
| **P3** Leveling Uniques | 100 | `backend/economy/leveling_uniques.py:compute_leveling_uniques_lifecycle(phase, days_since_reference, *, reference_currency="", league_name="", now=None, lang="en")` — static table of 10 leveling uniques + PRE_PEAK/AT_PEAK/POST_PEAK stage + BUY_OR_HOLD/SELL_NOW/AVOID_BUYING recommendation + heuristic est. price. Immune to KI-11 (uses PhaseDetector only). 86 pytest. | `GET /api/v1/leveling-uniques?lang=en\|ru` | `leveling-uniques-widget.tsx` (на Overview) — table with stage + recommendation badges. 28 jest. |
| **P7** Mirror/Divine Arb | 108–109 | `backend/economy/mirror_divine_arb.py:compute_mirror_divine_arb(snapshot, config, *, days=30, mirror_api_id="mirror", divine_api_id="divine", now=None)` — single-object response, z-score signal (SELL_MIRROR_BUY_DIVINE / SELL_DIVINE_BUY_MIRROR / NEUTRAL), profit_potential_per_mirror_div (≥100 Div = actionable). 70 pytest. | `GET /api/v1/mirror-divine-arb?days=` | `mirror-divine-arb-tab.tsx` — single-card render with rate / z / deviation / sparkline + 7/14/30/90-day selector. 42 i18n keys × 4. |
| **P9** Phase-aware Investment | 78 + 110 | `backend/economy/phase_hints.py:get_phase_hints(phase, days_since_reference, *, reference_currency="", league_name="", now=None, lang="en", snapshot=None)` — static table 4 hints/phase × 3 phases + optional live-price enrichment (current_price / change_pct_week / change_pct_month / momentum / recommendation) when snapshot provided. 3 of 12 hints tracked (exalted/divine). 109 pytest (61 original + 48 iter-110 enrichment). | `GET /api/v1/phase-hints` | `phase-hints-widget.tsx` (на Overview) — HintRow renders live-price section when trackedCurrency + currentPrice available. 13 jest. |
| **P10** Gold Map ROI | 127 + 132 | Reuses `backend/economy/triangular_cycles.py` (TD-3) for best 3-way rate. No new backend module. | `GET /api/v1/arbitrage/triangular` (live) + `GET /api/v1/arbitrage/triangular/history` (TD-3 SQLite persistence) | `gold-map-roi-tab.tsx` + `gold-map-roi-calculator.tsx` (Phase 1, iter 127) + `gold-map-roi-trend-chart.tsx` (Phase 2, iter 132 — dependency-free SVG line chart, reuses pattern from `storage-value-history-chart.tsx`). |

### Не реализованы (требуют GGG trade API)
- P6 Priority Listing Arb — нужен GGG trade API.
- P11 Megalomaniac scanner — нужен GGG trade API (affix-фильтры).
- P12 Tablet resell — нужен GGG trade API.
- P13 Crafting Profit Discovery — нужен GGG trade API.
- P14 Meta gem mass listing — нужен GGG trade API.
- P19 Meta gem demand divergence — нужен GGG trade API.
- P20 Skill gem quality crafting — нужен GGG trade API.

Эти паттерны **не** на roadmap, пока GGG trade API не интегрирован (отдельная задача — OAuth2 + rate-limit handling, см. KI-1 note в `PRODUCT_VISION.md`).

---

## D. Приоритеты и точки остановки

### D.1. Критерий приоритизации
1. **Реализуемость на текущих данных** (POE2Scout API).
2. **Новизна** (нет в scout/ninja).
3. **Actionability** (даёт конкретный сигнал игроку).
4. **Self-contained** (минимальный риск сломать прод).

### D.2. Реализованные паттерны (canonical status)
| Ранг | Паттерн | iter | Статус |
|------|---------|------|--------|
| 1 | P8 Trajectory classification | 96–97 | ✅ Done |
| 2 | P4 Time-of-day | 98 | ✅ Done |
| 3 | P5 Weekday/weekend | 99 | ✅ Done |
| 4 | P3 Leveling uniques | 100 | ✅ Done |
| 5 | P7 Mirror/Divine arb | 108–109 | ✅ Done |
| 6 | P9 Phase-aware investment | 78 + 110 | ✅ Done |
| 7 | P10 Gold Map ROI | 127 + 132 | ✅ Done |

### D.3. Что осталось
- **TD-3/4/5/9** — persistence gaps. TD-3/4/5 SHIPPED iter 128–131, runtime log verification pending (requires prod access).
- **P2** Rate lifecycle visualization — partial (speculation.py + phase_hints.py), нужна «миграция курсов» widget.
- **P16** Reinvestment ranking — partial (storage_value.py), нужен ranking-виджет.
- **P17** New Season Items autodetect — partial (events.py patch tracking), автодетект новых api_id не реализован.
- **P6, P11–P14, P19, P20** — требуют GGG official trade API (OAuth2).
- **F1** — 9 предметов без poe2db RU-страницы — re-run pipeline после патча / ежемесячно.

---

## E. Связанные документы
- `PRODUCT_VISION.md` — продуктовое видение (§3.7 — Circuit Patterns).
- `STATUS.md` — Known Issues + TD backlog.
- `AGENT_NAVIGATION.md` — навигация по коду.
- `PoE2_Flipper_Canonical_Formulas.md` — математика скоринга.
- `docs/ARCHITECTURE.md` — слои и инварианты.
- `docs/design/P10-gold-map-roi-design.md` — P10 Gold Map ROI design doc (Phases 1+2 SHIPPED).
- `docs/design/TD-3-4-5-9-persistence-gaps-design.md` — TD-3/4/5/9 unified persistence-layer analysis (ALL PHASES SHIPPED).
