# PoE2 Market Dashboard

Аналитический инструмент для рынка Path of Exile 2 — систематизация цен,
спекулятивные подсказки, рекомендации «что фармить сейчас» и «куда
конвертировать лут». **Локальный инструмент для ПК** — не рассчитан на
серверное развёртывание.

## Ключевые возможности

- **Полная русская локализация** предметов и валюты (349 RU + 349 EN).
- **Storage Value** — ценность валюты относительно Mirror/Hinekora с
  историческим графиком.
- **Content Pulse** — что фармить сегодня (turnover по mechanical categories +
  Overheat Index для post-streamer паттерна).
- **Speculation** — BUY/SELL/HOLD сигналы на основе z-score + backtest.
- **Phase Hints** — контекстные подсказки по фазе лиги (EARLY/MID/LATE).
- **Circuit Patterns** — классификация траектории цены валюты в 7 архетипов.
- **Intraday / Weekly Patterns** — heatmaps активности по часам и дням недели.
- **Leveling Uniques Lifecycle** — виджет «какие уники сейчас актуальны».

## Запуск

### Windows
```cmd
start.bat
```

### Linux / macOS
```bash
chmod +x start.sh
./start.sh
```

Скрипт создаст `.venv`, установит Python-зависимости, соберёт Next.js и
запустит всё (Next.js на порту 3000, Python backend на порту 8000).
Откройте http://localhost:3000.

**Флаги:** `--dev` (hot reload), `--skip-build` (без пересборки), `--clean`
(полная переустановка), `--no-bridge` (Python backend отдельным процессом).

### Важно: API URL

API poe2scout.com переехало. Старый поддомен `api.poe2scout.com` **мёртв**
(возвращает 404 на любой endpoint). Рабочий URL — `https://poe2scout.com/api`.

Если `.env.local` уже существует локально — удалите его или отредактируйте:
```
POE2_API_BASE_URL=https://poe2scout.com/api
```
`start.bat` / `start.sh` теперь WARN'ут, если в `.env.local` остался мёртвый
`api.` поддомен. См. `STATUS.md` KI-15.

## Документация

| Файл | Назначение |
|------|------------|
| [`STATUS.md`](./STATUS.md) | Known Issues + Quick Reference (читай ПЕРВЫМ) |
| [`PRODUCT_VISION.md`](./PRODUCT_VISION.md) | Продуктовое видение — что делаем и не делаем |
| [`AGENT_NAVIGATION.md`](./AGENT_NAVIGATION.md) | Навигация по коду для агентов |
| [`docs/MARKET_PLAYBOOK.md`](./docs/MARKET_PLAYBOOK.md) | Паттерны рынка POE2 (P1–P20) + дорожная карта |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Архитектурные слои и инварианты |
| [`docs/DATA_FLOW.md`](./docs/DATA_FLOW.md) | Поток данных: upstream → cache → UI |
| [`docs/CORS_PROXY_GUIDE.md`](./docs/CORS_PROXY_GUIDE.md) | Настройка Cloudflare Worker прокси для заблокированных регионов |
| [`docs/BACKEND_GUIDE.md`](./docs/BACKEND_GUIDE.md) | Гид по Python backend |
| [`docs/DATA_CONTRACTS.md`](./docs/DATA_CONTRACTS.md) | Контракты между frontend и backend |
| [`PoE2_Flipper_Canonical_Formulas.md`](./PoE2_Flipper_Canonical_Formulas.md) | Математика скоринга |

## Стек

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui.
- **Backend:** Python 3.12, FastAPI, SQLite (historical.py), LightGBM (predictors/).
- **Data source:** POE2Scout API (`https://poe2scout.com/api`).
- **Tests:** pytest (backend) + Jest (frontend) + Playwright (e2e).

## Разработка

```bash
npm install && npm run dev          # Frontend на :3000
PYTHONPATH=. .venv/bin/python -m uvicorn backend.main:app --reload --port 8000  # Backend

pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py
npx jest
npx tsc --noEmit
```
