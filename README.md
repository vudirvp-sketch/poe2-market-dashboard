# PoE2 Market Dashboard

> **Аналитический помощник для рынка Path of Exile 2.** Не очередной poe2scout / poe2ninja —
> инструмент для систематизации рынка, спекулятивных подсказок (buy low / sell high),
> «инвестиционных» советов по сохранению ценности относительно Зеркала Каландры / Пряди Хинекоры,
> и аналитики популярности контента (что фармить сегодня и почему).
> Полная русская локализация предметов и валюты.

Подробное продуктовое направление — в [`PRODUCT_VISION.md`](./PRODUCT_VISION.md).
Технический статус и баги — в [`STATUS.md`](./STATUS.md).

---

## Что внутри

- **Backend** (`backend/`): FastAPI + SQLite + LightGBM. Прогнозы, аномалии,
  скоринг арбитража, детекция фазы лиги, storage-value относительно Mirror/Hinekora.
- **Frontend** (`src/`): Next.js 16 + React 19 + shadcn/ui + Tailwind 4.
  Табы: overview / flips / liquid-chain / optimizer / analyst / currency-graph / watchlist.
- **CORS proxy** (`cloudflare-worker/`): обход CORS при прямых запросах к POE2Scout API.
- **Localized names**: `backend/data/currency_names.json` (349 RU + 349 EN).
  Тонкий загрузчик — `backend/data/currency_names_ru.py`.

## Быстрый старт

```bash
# Backend (создаст .venv автоматически)
./start.sh
# → uvicorn backend.main:app --reload --port 8000

# Frontend (отдельный терминал)
npm install && npm run dev   # → http://localhost:3000

# Тесты
pytest tests/ -q --ignore=tests/e2e    # backend unit (496 pass на iter 73)
pytest tests/e2e/ -q -m "not flaky"    # backend e2e (30 pass)
npx jest                                # frontend unit (324 pass на iter 73)
npx tsc --noEmit                        # type check (0 errors)
npx playwright test                     # E2E (30 pass)
```

## Структура документации

| Файл | Назначение |
|------|-----------|
| `PRODUCT_VISION.md` | **Продуктовое направление** — читать перед предложением фич |
| `STATUS.md` | **Баги и технический рефакторинг** — читать перед фиксом |
| `AGENT_NAVIGATION.md` | Где что лежит в коде — для агентов |
| `docs/ARCHITECTURE.md` | Слои, инварианты, принципы |
| `docs/DATA_CONTRACTS.md` | Контракты API, TS-типы |
| `docs/DATA_FLOW.md` | Потоки данных, трансформации полей |
| `docs/BACKEND_GUIDE.md` | Внутренности FastAPI |
| `PoE2_Flipper_Canonical_Formulas.md` | Математика скоринга |

## Текущее состояние (iter 73)

- **P0 = 0** (закрыты в iter 54-58)
- **P1 = 0** (закрыты в iter 54-66)
- **P2 = 0** (P2-1 закрыт в iter 73 — `dashboard-page.tsx` 1685 → 1201 строк; вынесены 4 таба + `DashboardToolbar` + `DashboardDialogs`)
- **P3 = 0** (P3-7 закрыт в iter 73 — `REFACTOR_PLAN.md` и `worklog.md` удалены)
- Baseline: pytest 496 pass, jest 324 pass, tsc 0 errors, e2e 30 pass.

Следующая итерация (iter 74+): продуктовые фичи F1-F6 из `PRODUCT_VISION.md` (F1 — доперевод ~276 предметов, F2 — вкладка Storage Value).
