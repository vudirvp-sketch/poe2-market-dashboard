# PoE2 Market Dashboard

**Не очередной poe2scout / poe2ninja.** Аналитический инструмент для рынка
Path of Exile 2 — систематизация цен, спекулятивные подсказки, рекомендации
«что фармить сейчас» и «куда конвертировать лут».

## Ключевые возможности

- **Полная русская локализация** предметов и валюты (349 RU + 349 EN).
- **Storage Value** — ценность валюты относительно Mirror/Hinekora с
  историческим графиком.
- **Content Pulse** — что фармить сегодня (turnover по mechanical categories +
  Overheat Index для post-streamer паттерна).
- **Speculation** — BUY/SELL/HOLD сигналы на основе z-score + backtest.
- **Phase Hints** — контекстные подсказки по фазе лиги (EARLY/MID/LATE).
- **Circuit Patterns** (iter 96, в разработке) — классификация траектории цены
  валюты в 7 архетипов (Chaos-orb-like growth, peak-then-decline, volatile и т.д.).

## Документация

| Файл | Назначение |
|------|------------|
| [`PRODUCT_VISION.md`](./PRODUCT_VISION.md) | Продуктовое видение — что делаем и не делаем |
| [`STATUS.md`](./STATUS.md) | Known Issues + TD backlog |
| [`docs/MARKET_PLAYBOOK.md`](./docs/MARKET_PLAYBOOK.md) | **Паттерны рынка POE2 (P1–P20) + дорожная карта** |
| [`AGENT_NAVIGATION.md`](./AGENT_NAVIGATION.md) | Навигация по коду для агентов |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Архитектурные слои и инварианты |
| [`PoE2_Flipper_Canonical_Formulas.md`](./PoE2_Flipper_Canonical_Formulas.md) | Математика скоринга |

## Запуск

```bash
# Frontend (port 3000)
npm install && npm run dev

# Backend (port 8000) — start.sh создаёт .venv автоматически
PYTHONPATH=. .venv/bin/python -m uvicorn backend.main:app --reload --port 8000

# Тесты
pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py
npx jest
npx tsc --noEmit
```

## Стек

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui.
- **Backend:** Python 3.12, FastAPI, SQLite (historical.py), LightGBM (predictors/).
- **Data sources:** POE2Scout API (primary), GGG official API (realms/leagues only).
- **Tests:** pytest (backend, ~870 tests) + Jest (frontend, ~430 tests) + Playwright (e2e).
