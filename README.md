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
| **FastAPI Backend** | Python 3.12+ + FastAPI + uvicorn | 8000 | Flipper analytics engine (scoring, triangular arb, forecasting, portfolio, events) |

## Features

### Market Data (works without backend)
- **Overview** — Market volume trends, top movers
- **Currencies** — Browse and compare currency items
- **Uniques** — Search unique items with price history
- **Exchange** — Currency pair exchange rates
- **Watchlist** — Track favorite items with price alerts

### Flipper Analytics (requires FastAPI backend)
- **Arbitrage** — Client-side simple arbitrage + backend-powered flipper mode
- **Flips** — Detailed scored flip opportunities with cluster filtering, sorting, and storage value integration
- **Forecasts** — Price forecasts, anomaly detection, storage value decisions
- **Portfolio** — Risk parity / min-variance portfolio allocation with efficient frontier
- **Currency Graph** — Network visualization of currency trade pairs with cycle highlighting
- **Events** — Flag market events that affect scoring (sidebar)

### Cross-cutting
- i18n: English, Русский, 中文, 한국어
- Dark/light theme
- PWA with offline support
- Export to CSV/JSON

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

### Backend-only (without flipper features)
```bash
npm install
npm run dev
```
Market data tabs (Overview, Currencies, Uniques, Exchange, Watchlist) work without the backend. Flipper tabs show a graceful "backend offline" message.

## Project Structure

```
├── backend/                  # FastAPI flipper analytics engine
│   ├── main.py              # App entry point + router registration
│   ├── config.py            # Configuration (reads config.yaml)
│   ├── api/                 # Route handlers
│   ├── arbitrage/           # Scorer, triangular arb, recipes
│   ├── economy/             # Events, lifecycle, gold costs, momentum
│   ├── predictors/          # Time-series forecasting, anomaly detection
│   ├── data/                # Providers (POE2Scout, Official), cache, schemas
│   └── models/              # Data models
├── src/                     # Next.js application
│   ├── app/                 # Next.js App Router pages + API routes
│   │   ├── api/flipper/     # Proxy routes → FastAPI backend
│   │   └── api/poe2/        # Direct POE2Scout API routes
│   ├── components/          # React components
│   │   ├── dashboard/       # Tab components, dialogs, sidebar
│   │   └── ui/              # shadcn/ui primitives
│   ├── lib/                 # Shared utilities
│   │   ├── flipper-proxy.ts # Proxy helper for /api/flipper/*
│   │   ├── poe2api.ts       # Fetcher for POE2Scout API
│   │   ├── types.ts         # Shared types + fetchApi + formatters
│   │   ├── i18n/            # Internationalization (en, ru, zh, ko)
│   │   └── store.ts         # Zustand store
│   └── hooks/               # Custom React hooks
├── config.yaml              # Flipper backend configuration
├── start.bat                # Windows launcher (both servers)
└── requirements.txt         # Python dependencies (backend only)
```

## Configuration

Edit `config.yaml` to customize flipper behavior:
- League and realm selection
- Portfolio method (risk_parity / min_variance)
- Scoring weights and thresholds
- Scheduler intervals
- Correlation shock detection sensitivity

## API Endpoints (FastAPI Backend)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/phase` | GET | League phase info (EARLY/MID/LATE) |
| `/api/currencies` | GET | Currency metadata + icons |
| `/api/prices` | GET | All exchange rates with fee info |
| `/api/prices/heatmap` | GET | 24h price change heatmap |
| `/api/arbitrage/flips` | GET | Scored flip opportunities |
| `/api/arbitrage/triangular` | GET | Triangular arbitrage cycles |
| `/api/forecast/{currency}` | GET | Price forecast for a currency |
| `/api/anomalies` | GET | Anomaly detection results |
| `/api/storage-value/{currency}` | GET | Hold/sell decision |
| `/api/portfolio` | GET | Portfolio allocation + risk metrics |
| `/api/portfolio/frontier` | GET | Efficient frontier data |
| `/api/portfolio/rebalance` | POST | Rebalance portfolio |
| `/api/recipes` | GET | Vendor recipe arbitrage |
| `/api/events` | GET | List active events |
| `/api/events` | POST | Create a manual event flag |

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, TanStack React Query, Recharts, Zustand
- **Backend:** Python 3.12+, FastAPI, uvicorn, scikit-learn, LightGBM, statsmodels, scipy, pandas, SQLite

## Development

```bash
npm run dev       # Start Next.js dev server
npm run build     # Production build
npm run test      # Run tests
npm run lint      # Lint check
```
