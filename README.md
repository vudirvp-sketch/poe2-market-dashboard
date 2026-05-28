# PoE2 Market Dashboard

A unified Path of Exile 2 market intelligence dashboard combining real-time market data browsing with advanced flipper analytics — all in a single Next.js application.

## Architecture

```
Browser → Next.js (port 3000)
            ├── /api/poe2/*     → POE2Scout API (api.poe2scout.com)
            └── /api/flipper/*  → FastAPI Backend (port 8000) → POE2Scout API + SQLite
```

| Process | Technology | Port | Purpose |
|---------|-----------|------|---------|
| **Next.js Frontend** | React 19 + Next.js 16 + TypeScript | 3000 | Unified dashboard — all market browsing and flipper analytics |
| **FastAPI Backend** | Python 3.12+ + FastAPI + uvicorn | 8000 | Flipper analytics engine (scoring, triangular arb, forecasting, portfolio, events, recipes) |

**Data flow:** The Next.js app acts as a proxy layer. Market data requests (`/api/poe2/*`) are forwarded directly to the POE2Scout API, while flipper analytics requests (`/api/flipper/*`) are proxied to the FastAPI backend which enriches data with ML models, scoring, and historical analysis stored in SQLite.

## Features

### Market Data (works without backend)
- **Overview** — Market volume trends, 24h price heatmap, top movers
- **Currencies** — Browse and compare currency items with virtual scrolling
- **Uniques** — Search unique items with price history and candlestick charts
- **Exchange** — Currency pair exchange rates with relative price comparisons
- **Watchlist** — Track favorite items with price alerts and browser notifications

### Flipper Analytics (requires FastAPI backend)
- **Arbitrage** — Client-side simple arbitrage + backend-powered flipper mode with gold fee modeling
- **Flips** — Detailed scored flip opportunities with cluster filtering, sorting, and storage value integration
- **Recipes** — Vendor recipe arbitrage: check profitability of vendor orb recipes against live market prices
- **Forecasts** — SARIMA + LightGBM price forecasts, anomaly detection (RSI, MACD, Bonferroni), storage value decisions
- **Portfolio** — Risk parity / min-variance portfolio allocation with Ledoit-Wolf shrinkage, correlation matrix, efficient frontier, and correlation shock detection
- **Currency Graph** — Force-directed network visualization of currency trade pairs with cycle highlighting and real-time cluster classification
- **Events** — Flag market events (patches, league starts, economy shifts) that affect scoring, with auto-expiry and persistence in SQLite

### Sticky Bar (when backend is online)
- Best flip opportunity with score
- 24h momentum trend indicator
- Best triangular arbitrage cycle with profit %
- Flip opportunity count badge
- Market sentiment indicator (aggregated momentum)
- Correlation shock alert
- League phase badge (EARLY / MID / LATE)

### Cross-cutting
- **i18n**: English, Русский, 中文, 한국어
- **Dark/light theme** with system preference detection
- **PWA** with offline support and service worker
- **Export** to CSV/JSON
- **Accessibility**: WCAG 2.1 AA — skip-to-content link, ARIA roles, keyboard navigation
- **Graceful degradation**: all flipper tabs show clear offline messages when backend is down

## Quick Start

### Windows
```batch
start.bat
```

### Manual
```bash
# Terminal 1: Start FastAPI backend
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# Terminal 2: Start Next.js frontend
npm install
npm run dev
```

Open http://localhost:3000

### Frontend-only (without flipper backend)
```bash
npm install
npm run dev
```
Market data tabs (Overview, Currencies, Uniques, Exchange, Watchlist) work without the backend. Flipper tabs show a graceful "backend offline" message with the command to start the backend (`uvicorn backend.main:app --reload --port 8000`).

## Tab Order

```
Overview | Currencies | Uniques | Exchange | Arbitrage | Flips | Recipes | Forecast | Portfolio | Graph | Watchlist
```

## Project Structure

```
├── backend/                  # FastAPI flipper analytics engine
│   ├── main.py              # App entry point + router registration + CORS
│   ├── config.py            # Configuration (reads config.yaml via Pydantic Settings)
│   ├── api/                 # Route handlers (prices, arbitrage, forecast, portfolio, events, anomalies, storage_value, recipes)
│   ├── arbitrage/           # Scorer, triangular arb, portfolio optimizer, recipe arb
│   ├── economy/             # Events, lifecycle/phase detection, gold costs, momentum
│   ├── predictors/          # Time-series forecasting (SARIMA, LightGBM), anomaly detection, clustering
│   ├── data/                # Providers (POE2Scout, Official), cache, schemas, historical store (SQLite)
│   └── models/              # Data models
├── src/                     # Next.js application
│   ├── app/                 # Next.js App Router pages + API routes
│   │   ├── api/flipper/     # Proxy routes → FastAPI backend
│   │   └── api/poe2/        # Direct POE2Scout API routes
│   ├── components/          # React components
│   │   ├── dashboard/       # Tab components, dialogs, sidebar, sticky bar, error boundaries
│   │   └── ui/              # shadcn/ui primitives (Badge, Button, Card, Dialog, Input, Select, Sheet, Skeleton, Tabs, Sonner)
│   ├── lib/                 # Shared utilities
│   │   ├── flipper-proxy.ts # Proxy helper for /api/flipper/* (timeout, error type detection)
│   │   ├── poe2api.ts       # Server-side fetcher for POE2Scout API (caching, retries, PascalCase→camelCase)
│   │   ├── types.ts         # Shared types + fetchApi + formatters + export utilities
│   │   ├── i18n/            # Internationalization (en, ru, zh, ko — ~460 keys each)
│   │   └── store.ts         # Zustand store (comparison, favorites, alerts)
│   └── hooks/               # Custom React hooks (use-api-with-retry, use-debounce, use-online-status, use-price-alerts, use-reduced-motion)
├── e2e/                     # Playwright E2E tests (smoke, navigation, accessibility, i18n)
├── src/__tests__/           # Jest unit tests
├── tests/                   # Python pytest backend tests
├── config.yaml              # Flipper backend configuration
├── start.bat                # Windows launcher (both servers)
└── requirements.txt         # Python dependencies (backend only)
```

## Configuration

Edit `config.yaml` to customize flipper behavior:
- League and realm selection
- Portfolio method (risk_parity / min_variance)
- Scoring weights and thresholds (momentum, phase multipliers)
- Scheduler intervals (price snapshots, reclustering, model retraining)
- Correlation shock detection sensitivity (threshold, position reduction factor)
- Vendor recipes (Chaos/Regal/Exalted shard → orb conversions)
- Forecasting parameters (SARIMA auto-detect, LightGBM retrain interval, 24h horizon, 95% CI)
- Anomaly detection (Bonferroni alpha, RSI periods, MACD parameters)
- Event defaults (expiry, scoring penalty)

## API Endpoints (FastAPI Backend)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check with event count |
| `/api/phase` | GET | League phase info (EARLY/MID/LATE) |
| `/api/currencies` | GET | Currency metadata + icons |
| `/api/prices` | GET | All exchange rates with fee info + cluster labels |
| `/api/prices/heatmap` | GET | 24h price change heatmap |
| `/api/arbitrage/flips` | GET | Scored flip opportunities |
| `/api/arbitrage/triangular` | GET | Triangular arbitrage cycles |
| `/api/forecast/{currency}` | GET | Price forecast for a currency |
| `/api/anomalies` | GET | Anomaly detection results |
| `/api/storage-value/{currency}` | GET | Hold/sell decision |
| `/api/portfolio` | GET | Portfolio allocation + risk metrics + correlation matrix |
| `/api/portfolio/frontier` | GET | Efficient frontier data |
| `/api/portfolio/rebalance` | POST | Rebalance portfolio (supports method override) |
| `/api/recipes` | GET | Vendor recipe arbitrage (profitable + all recipes) |
| `/api/recipes/definitions` | GET | All defined vendor recipes from config |
| `/api/events` | GET | List active events |
| `/api/events` | POST | Create a manual event flag |
| `/api/events/{id}` | GET | Get event by ID |
| `/api/events/{id}/deactivate` | POST | Deactivate an event |

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix), TanStack React Query 5, TanStack React Table 8, TanStack React Virtual 3, Recharts 2, Zustand 5, next-themes, Sonner
- **Backend:** Python 3.12+, FastAPI, uvicorn, scikit-learn, LightGBM, statsmodels, pmdarima, scipy, pandas, numpy, networkx, SQLite (aiosqlite), APScheduler, Pydantic 2

## Development

```bash
npm run dev       # Start Next.js dev server (port 3000)
npm run build     # Production build
npm run start     # Start production server (port 3000)
npm run test      # Run Jest unit tests
npm run test:e2e  # Run Playwright E2E tests
npm run lint      # Lint check
```

## Testing

- **Unit tests** (Jest): `src/__tests__/` — API helpers, i18n, store, utils
- **E2E tests** (Playwright): `e2e/` — smoke, navigation, accessibility, i18n
- **Backend tests** (pytest): `tests/` — scorer, triangular, forecast, portfolio, events, anomaly, recipe, scheduler

## Graceful Degradation

All flipper-dependent tabs (Arbitrage flipper mode, Flips, Recipes, Forecast, Portfolio, Currency Graph) check the backend health endpoint on mount via `useQuery` with 30s refetch. When the FastAPI backend is offline:
- A clear "Flipper Backend Offline" message is displayed with the command: `uvicorn backend.main:app --reload --port 8000`
- Non-flipper tabs (Overview, Currencies, Uniques, Exchange, Watchlist) continue to work normally
- Each tab is wrapped in an `ErrorBoundary` to prevent cascading failures
- The shared `FlipperBackendStatusCard` component handles the offline/insufficient-data UI consistently across all flipper tabs
