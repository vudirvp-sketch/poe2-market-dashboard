# PoE2 Market Dashboard

A unified Path of Exile 2 market intelligence dashboard combining real-time market data browsing with advanced flipper analytics — all in a single Next.js application.

> **For developers & AI agents:** See [`AGENT_NAVIGATION.md`](./AGENT_NAVIGATION.md) — the single entry point for codebase navigation, build commands, invariants, and known issues.

## Architecture

```
Browser → Next.js (port 3000)
            ├── /api/poe2/*     → POE2Scout API (api.poe2scout.com)
            └── /api/flipper/*  → FastAPI Backend (port 8000) → POE2Scout API + SQLite
```

| Process | Technology | Port | Purpose |
|---------|-----------|------|---------|
| **Next.js Frontend** | React 19 + Next.js 16 + TypeScript | 3000 | Unified dashboard — all market browsing and flipper analytics |
| **FastAPI Backend** | Python 3.12+ + FastAPI + uvicorn | 8000 | Flipper analytics engine (scoring, triangular arb, optimizer, analyst, events, recipes) |

**Data flow:** The Next.js app acts as a proxy layer. Market data requests (`/api/poe2/*`) are forwarded directly to the POE2Scout API, while flipper analytics requests (`/api/flipper/*`) are proxied to the FastAPI backend which enriches data with ML models, scoring, and historical analysis stored in SQLite.

## Features

### Market Data (works without backend)
- **Overview** — Market volume trends, 24h price heatmap, top movers
- **Currencies** — Browse and compare currency items with virtual scrolling
- **Uniques** — Search unique items with price history and candlestick charts
- **Exchange** — Currency pair exchange rates with relative price comparisons
- **Watchlist** — Track favorite items with price alerts and browser notifications

### Flipper Analytics (requires FastAPI backend)
- **Arbitrage** — Client-side simple arbitrage + backend-powered flipper mode
- **Flips** — Detailed scored flip opportunities with cluster filtering, sorting, and storage value integration
- **Optimizer** — Optimal currency conversion path (Dijkstra-based) and effective rate matrix
- **Analyst** — League analysis summary: trends, anomalies, phase, tier distribution (fallback mode works without backend)
- **Liquid Chain** — Vendor reforge chain profitability: per-step profit/loss and cumulative reforge paths for delirium liquids
- **Currency Graph** — Force-directed network visualization of currency trade pairs with cycle highlighting and real-time cluster classification
- **Events** — Flag market events (patches, league starts, economy shifts) that affect scoring, with auto-expiry and persistence in SQLite

### Cross-cutting
- **i18n**: English, Русский, 中文, 한국어
- **Dark/light theme** with system preference detection
- **PWA** with offline support and service worker
- **Export** to CSV/JSON
- **Accessibility**: WCAG 2.1 AA
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
Market data tabs (Overview, Currencies, Uniques, Exchange, Watchlist) work without the backend. Flipper tabs show a graceful "backend offline" message.

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix), TanStack React Query 5, TanStack React Table 8, TanStack React Virtual 3, Recharts 2, Zustand 5, next-themes, Sonner
- **Backend:** Python 3.12+, FastAPI, uvicorn, scikit-learn, LightGBM, statsmodels, pmdarima, scipy, pandas, numpy, networkx, SQLite (aiosqlite), APScheduler, Pydantic 2

## Development

```bash
npm run dev       # Start Next.js dev server (port 3000)
npm run build     # Production build
npm run test      # Run Jest unit tests
npm run test:e2e  # Run Playwright E2E tests
pytest tests/ -v  # Run backend tests
```

## Bypassing Regional IP Blocking

The POE2Scout API is blocked from Russian IPs. See [`docs/CORS_PROXY_GUIDE.md`](./docs/CORS_PROXY_GUIDE.md) for setup instructions for the Cloudflare Worker CORS proxy (5-minute deployment, free tier).

Quick setup:
```bash
cd cloudflare-worker && wrangler deploy
# Then add to .env.local:
# POE2_CORS_PROXY_URL=https://poe2scout-proxy.your-account.workers.dev/api
```

## Documentation

| File | Content |
|------|---------|
| [`AGENT_NAVIGATION.md`](./AGENT_NAVIGATION.md) | Agent/developer entry point — structure, commands, invariants, known issues |
| [`worklog.md`](./worklog.md) | Current state + frequent bugs + commands |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Layers, data flow, invariants, principles |
| [`docs/DATA_CONTRACTS.md`](./docs/DATA_CONTRACTS.md) | TypeScript types, API contracts, response shapes |
| [`docs/DATA_FLOW.md`](./docs/DATA_FLOW.md) | Data flow traces, field transforms, API path reference |
| [`docs/BACKEND_GUIDE.md`](./docs/BACKEND_GUIDE.md) | FastAPI backend: providers, stores, scheduler, analytics |
| [`docs/CORS_PROXY_GUIDE.md`](./docs/CORS_PROXY_GUIDE.md) | CORS proxy setup + fallback mechanisms |
| [`PoE2_Flipper_Canonical_Formulas.md`](./PoE2_Flipper_Canonical_Formulas.md) | All mathematical formulas and algorithms |
