# MARKET_PLAYBOOK.md — паттерны рынка POE2 и дорожная карта дашборда

> **Last updated:** 2026-07-10 (iter 97 — Circuit Patterns API + UI wire-up)
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
| **P3** Leveling uniques lifecycle | Нет | ❌ Не реализовано. |
| **P4** Time-of-day pattern | Нет | ❌ Не реализовано. Самый сильный пробел. |
| **P5** Weekday/weekend pattern | Нет | ❌ Не реализовано. |
| **P6** Priority Listing Arb | Нет | ❌ Требует данных trade-site, которых у нас нет (POE2Scout не отдаёт listings по alt-orbs отдельно). Доступно только через GGG official trade API. |
| **P7** Mirror ↔ Divine arb | Частично: `storage_value.py` (currency/mirror ratio) | ⚠️ Есть метрика, нет детектора arb-окна для chase-уников. |
| **P8** Trajectory classification | `backend/economy/circuit_patterns.py` (iter 96) + `routes_circuit_patterns.py` + UI tab `circuit-patterns-tab.tsx` (iter 97) | ✅ Готово. Pure function (75 unit-тестов) + API route `/api/v1/circuit-patterns` + Next.js proxy + UI tab с бейджами траекторий и mini-sparkline + i18n × 4 locales (47 ключей × 4) + 20 jest-тестов + 4 pytest route smoke-теста. |
| **P9** Phase-aware investment | `phase_hints.py` (4 hints на фазу) | ⚠️ Статичная таблица. Нет привязки к live-ценам. |
| **P10** Gold Map ROI | Нет | ❌ Нужен калькулятор. Зависит от P1 (3-way flips). |
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
- 4 полностью готовы (P1, P8, P18, частично P9/P16/P17).
- 5 частично готовы (P2, P7, P9, P16, P17) — нужна доработка.
- 11 не реализованы. Из них:
  - **P3, P4, P5** — реализуемы на текущих данных POE2Scout (без GGG trade API). На roadmap iter 98-100.
  - **P6, P11, P12, P13, P14, P19, P20** — требуют GGG official trade API (не в scope без OAuth2).

---

## C. План реализации (что и как добавлять)

### C.1. iter 96 — Circuit Patterns (P8) — foundation
**Что.** Pure function `compute_circuit_patterns(snapshot, config, days=30) -> dict`. Классифицирует траекторию каждой валюты в один из 7 архетипов.

**Архетипы:**
- `EXPONENTIAL_GROWTH` — лог-линейная регрессия цены от времени, R² ≥ 0.7, slope > 0, total growth > 50% за окно. Пример: Chaos Orbs на Week 1+.
- `LINEAR_GROWTH` — линейная регрессия, R² ≥ 0.7, slope > 0, total growth 10–50%.
- `PEAK_THEN_DECLINE` — есть явный пик внутри окна, после пика спад ≥ 20%. Пример: leveling uniques.
- `MEAN_REVERTING` — коэффициент вариации < 0.15, нет тренда.
- `VOLATILE` — коэффициент вариации > 0.5, нет явного тренда. Пример: Annulment Orbs.
- `DECLINING` — линейная регрессия, R² ≥ 0.7, slope < 0, total decline > 10%.
- `STABLE` — коэффициент вариации 0.15–0.5, нет тренда.

**Возвращаемые поля на валюту:**
- `api_id`, `text`, `category`
- `trajectory` (один из 7 типов)
- `total_change_pct` (first → last за окно)
- `recent_slope_pct_per_day` (slope × 100)
- `volatility_cv` (std / mean)
- `r_squared` (качество фиттинга)
- `days_since_peak` (для PEAK_THEN_DECLINE; None иначе)
- `recommended_action` (`HOLD_FOR_GROWTH` / `SELL_NOW` / `AVOID` / `WATCH` / `NEUTRAL`)
- `sample_size` (число price_logs в окне)

**Действие по архетипу:**
| Архетип | recommended_action | Логика |
|---------|--------------------|--------|
| EXPONENTIAL_GROWTH | HOLD_FOR_GROWTH | Цена растёт экспоненциально — не продавать |
| LINEAR_GROWTH | HOLD_FOR_GROWTH | Растёт, но медленнее |
| PEAK_THEN_DECLINE | SELL_NOW | Пик пройден, начинается спад |
| MEAN_REVERTING | NEUTRAL | Нет тренда |
| VOLATILE | WATCH | Высокая волатильность — возможен arb, но рискованно |
| DECLINING | AVOID | Падает — не хранить |
| STABLE | NEUTRAL | Стабильно |

**Где живёт.** `backend/economy/circuit_patterns.py` — pure function. `tests/test_circuit_patterns.py` — полный coverage.

**Что НЕ входит в iter 96.** API route, UI, i18n — чтобы не сломать прод. Это iter 97.

### C.2. iter 97 — Circuit Patterns: API route + UI ✅ DONE
**Что было сделано.**
- Backend: `backend/api/routes_circuit_patterns.py` (thin wrapper по образцу `routes_speculation.py`). Поддерживает query-params `days` (1..90, default 30), `limit` (1..500, default 50), `trajectory` (ALL | один из 7 архетипов). При ошибке или отсутствии snapshot возвращает `data_available=false` с пустым patterns list.
- Backend: Pydantic-модели `CircuitPatternData` + `CircuitPatternsResponse` в `backend/api/response_models.py`. Включая поле `price_history_short` (до 14 последних price points для mini-sparkline в UI).
- Backend: pure function `compute_circuit_patterns()` в `backend/economy/circuit_patterns.py` расширена — теперь возвращает `price_history_short` на каждой валюте (additive change, существующие 75 тестов остались зелёными).
- Backend: router зарегистрирован в `backend/main.py` (через `try/except ImportError` обёртку, как все остальные).
- Next.js proxy: `src/app/api/flipper/circuit-patterns/route.ts` (по образцу `speculation/route.ts`).
- TypeScript-типы: `CircuitPattern`, `CircuitPatternsResponse`, `CircuitTrajectory`, `CircuitRecommendedAction` в `src/lib/types.ts`.
- UI: новая вкладка `src/components/dashboard/circuit-patterns-tab.tsx` (по образцу `speculation-tab.tsx`, но проще — без backtest panel). Filter chips (ALL + 7 архетипов), days selector (7/14/30/90), per-row trajectory badge + recommended_action badge + total_change_pct + mini-sparkline + статы (sampleSize / slope / vol / R² / current / daysSincePeak).
- UI: вкладка встроена в `dashboard-page.tsx` (dynamic import, `TAB_MAP` entry на idx 9, `TabsContent` после speculation), в `dashboard-toolbar.tsx` (TabsTrigger с иконкой `Activity`), в `shortcuts-dialog.tsx` (shortcut "0" → Circuits, Liquid Chain + Watchlist теперь click-only).
- i18n: 47 новых ключей × 4 locales (en/ru/zh/ko) — все локали имеют parity.
- Tests: 20 jest-тестов в `src/__tests__/circuit-patterns-tab.test.tsx` (offline / loading / error / no-data / patterns rendering / filter chips / days selector / sparkline / filter click / daysSincePeak / etc.) + 4 pytest route smoke-теста в `tests/test_circuit_patterns.py::TestRouteHandler`.

**Проверка.** Все 452 jest-тестов зелёные. Все 79 pytest-тестов в `test_circuit_patterns.py` зелёные (75 оригинальных + 4 новых route smoke). tsc --noEmit зелёный (на момент создания UI tab; последующие правки были тривиальными JSX-изменениями, валидированы через ts-jest).

### C.3. iter 98 — Time-of-Day Pattern Detector (P4)
**Что.** Pure function `compute_intraday_patterns(snapshot, config, days=14) -> dict`. Для каждой валюты: hourly mean price (UTC), buy/sell windows. Heatmap UI: час × валюта.

**Логика.** Аггрегировать price_logs по часу UTC за последние N дней. Для каждого часа: mean, std, count. «Buy window» = час с min mean price. «Sell window» = час с max mean price. Сигнализировать, если `|max - min| / overall_mean > 10%`.

### C.4. iter 99 — Weekday/Weekend Pattern Detector (P5)
**Что.** Pure function `compute_weekly_patterns(snapshot, config, weeks=4) -> dict`. Аналогично C.3, но группировка по дню недели.

### C.5. iter 100 — Leveling Uniques Lifecycle (P3)
**Что.** Виджет на Overview: «сейчас Day N лиги → окна продаж leveling уников». Использует PhaseDetector + статичная таблица известных leveling уников с их типичным паттерном. Без GGG trade API — только метрика цены.

### C.6. iter 101 — Mirror/Divine Arb Detector (P7)
**Что.** Расширить `storage_value.py`: для предметов ≥ 1 Mirror показывать arbitrage opportunity между Mirror и Divine способами оплаты. Использует существующий `currency/mirror` ratio history.

### C.7. iter 102 — Phase-aware Investment Advisor (P9)
**Что.** Расширить `phase_hints.py`: динамические подсказки на основе текущего дня лиги + live цен. Например: «Сейчас Day 7 — исторически Perfect Jewelers Orb растёт 200% к Day 14. Текущая цена: X. Рекомендация: BUY».

### C.8. iter 103+ — Gold Map ROI (P10)
**Что.** Калькулятор. Ввод: gold amount, map cost. Вывод: expected Div через best 3-way flip. Использует `triangular.py` для нахождения best rate.

### C.9. Backlog (требуют GGG trade API)
- P6 Priority Listing Arb — нужен GGG trade API.
- P11 Megalomaniac scanner — нужен GGG trade API (affix-фильтры).
- P12 Tablet resell — нужен GGG trade API.
- P13 Crafting Profit Discovery — нужен GGG trade API.
- P14 Meta gem mass listing — нужен GGG trade API.
- P19 Meta gem demand divergence — нужен GGG trade API.
- P20 Skill gem quality crafting — нужен GGG trade API.

Эти паттерны **не** на roadmap, пока GGG trade API не интегрирован (отдельная задача — OAuth2 + rate-limit handling, см. KI-1 note в PRODUCT_VISION.md).

---

## D. Приоритеты и точки остановки

### D.1. Критерий приоритизации
1. **Реализуемость на текущих данных** (POE2Scout API).
2. **Новизна** (нет в scout/ninja).
3. **Actionability** (даёт конкретный сигнал игроку).
4. **Self-contained** (минимальный риск сломать прод).

### D.2. Топ-5 паттернов для следующих итераций
| Ранг | Паттерн | iter | Риск | Статус |
|------|---------|------|------|--------|
| 1 | P8 Trajectory classification | 96–97 | Низкий (pure function + thin UI) | ✅ Done |
| 2 | P4 Time-of-day | 98 | Низкий (новая колонка в existing price_logs) | ⏳ Next |
| 3 | P5 Weekday/weekend | 99 | Низкий (аналогично P4) | ⏳ Roadmap |
| 4 | P3 Leveling uniques | 100 | Средний (статичная таблица) | ⏳ Roadmap |
| 5 | P7 Mirror/Divine arb | 101 | Средний (расширяет existing модуль) | ⏳ Roadmap |

### D.3. Точка остановки iter 97
**Сделано:**
- Backend: API route `GET /api/v1/circuit-patterns` (thin wrapper), Pydantic response models, router registration. Pure function расширена полем `price_history_short`.
- Frontend: Next.js proxy route, TypeScript types, новая UI-вкладка `circuit-patterns-tab.tsx`, wiring в `dashboard-page.tsx` + `dashboard-toolbar.tsx` + `shortcuts-dialog.tsx`.
- i18n: 47 новых ключей × 4 locales (en/ru/zh/ko).
- Tests: 20 jest + 4 pytest route smoke — все зелёные. Regression-чек: все 452 jest + 79 pytest (circuit-related) зелёные.
- Документация: `STATUS.md`, `docs/MARKET_PLAYBOOK.md` актуализированы (без мусора, только актуальная информация).

**НЕ сделано (на iter 98):**
- P4 Time-of-day pattern detector — pure function + UI heatmap (час × валюта).
- P5 Weekday/weekend — аналогично, но группировка по дню недели.

**Проверка.** Все изменения backend — новые файлы + 1 additive field в pure function (existing 75 тестов не сломаны). Все изменения frontend — новые файлы + минимальные правки в 3 existing файлах (dashboard-page.tsx TAB_MAP + TabsContent + dynamic import; dashboard-toolbar.tsx TabsTrigger + 1 icon import; shortcuts-dialog.tsx shortcut mapping text). i18n изменения — additive (47 новых ключей в конце каждого файла, existing keys не тронуты). Regression-риска нет — все 452 jest + 79 pytest (circuit-related) зелёные.

---

## E. Связанные документы
- `PRODUCT_VISION.md` — продуктовое видение (§3.7 — Circuit Patterns).
- `STATUS.md` — Known Issues + TD backlog (iter 97: TD-10 закрыт, F7 = Done).
- `AGENT_NAVIGATION.md` — навигация по коду (entry для `circuit_patterns.py` + `routes_circuit_patterns.py` + `circuit-patterns-tab.tsx`).
- `PoE2_Flipper_Canonical_Formulas.md` — математика скоринга.
- `docs/ARCHITECTURE.md` — слои и инварианты.
