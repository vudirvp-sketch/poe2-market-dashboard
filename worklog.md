# Worklog

---
Task ID: 27
Agent: main
Task: Iteration 27 — Add absolute profit in exalted to flip opportunities + cross-rate deviation analysis

Work Log:
- Identified core problem: flips tab showed dimensionless spread percentages, NOT absolute profit in any currency
- Added 5 new fields to FlipOpportunity model (backend/models/currency.py):
  - profit_per_unit_base: absolute profit per 1 unit of currency_from in base currency (exalted)
  - fair_rate: fair cross-rate based on prices_in_base
  - deviation_pct: |market_rate - fair_rate| / fair_rate * 100
  - price_from_in_base: price of currency_from in base currency
  - price_to_in_base: price of currency_to in base currency
- Updated _build_flip_opportunities_sync in routes_arbitrage.py:
  - Replaced chaos-normalized prices dict with original prices_in_base for profit calculation
  - Added cross-rate profit: abs(price_from_in_base - mid_price * price_to_in_base)
  - Added fair_rate = price_from_in_base / price_to_in_base
  - Added deviation_pct = abs(mid_price - fair_rate) / fair_rate * 100
- Added all 5 new fields to /api/arbitrage/flips JSON response
- Updated frontend FlipOpportunity type (src/lib/types.ts) with 5 new optional fields
- Updated flips-table.tsx: added "Profit (Exa)" column between Score and Spread
- Updated flips-detail-dialog.tsx: added profit in exalted panel, cross-rate deviation panel, fair vs market rate breakdown
- Added i18n keys to all 4 locales (en, ru, zh, ko): flipperProfitExa, profitExaTooltip, profitPerUnitExa, crossRateDeviation, crossRateBreakdown, marketRate, fairRate, priceFromInBase, priceToInBase
- Updated AGENT_NAVIGATION.md to v1.42

Stage Summary:
- Flips tab now shows absolute profit in exalted orbs (the number traders actually care about)
- Cross-rate deviation reveals WHY each opportunity exists (market rate ≠ fair rate)
- Detail dialog shows full breakdown: market rate vs fair rate + prices of both currencies in exalted
- Python syntax verified OK
- Stopping point: Code changes complete. Pending: npm run build verification, E2E testing with live backend, Windows verification, gold fee re-integration, Russian item name translation

---
Task ID: 26
Agent: main
Task: Iteration 26 — Fix event loop blocking, circuit breaker cascade, executor timeouts, case consistency

Work Log:
- Moved anomaly detection from synchronous event loop to ProcessPoolExecutor (routes_anomalies.py)
  - Created `_detect_anomalies_sync()` that receives pre-extracted numpy price arrays
  - Added `asyncio.wait_for(timeout=45s)` to prevent indefinite blocking
  - Added PipelineCache for anomaly results (key: `anomalies_{currency}_{min_alert_score}`)
- Moved portfolio correlation from synchronous event loop to ProcessPoolExecutor (routes_portfolio.py)
  - Created `_compute_correlation_matrix_sync()` that receives pre-extracted log-returns dicts
  - Added `asyncio.wait_for(timeout=60s)` to prevent indefinite blocking
  - Added PipelineCache for correlation results (key: `portfolio_correlation`)
- Added `asyncio.wait_for(timeout=...)` to ALL existing `run_in_executor` calls:
  - routes_arbitrage.py: flips computation → 60s timeout
  - backend/arbitrage/triangular.py: Bellman-Ford → 90s timeout
  - routes_prices.py: clustering → 30s timeout
- Fixed pre-camelized keys in `/api/arbitrage/optimal-currency` endpoint:
  - `anchorId` → `anchor_id`, `optimalPaymentByPair` → `optimal_payment_by_pair`
  - `crossRateFlips` → `cross_rate_flips`, `dataAvailable` → `data_available`
  - `fetchedAt` → `fetched_at`
  - `currencyId` → `currency_id`, `currencyName` → `currency_name`
  - `priceInCurrency` → `price_in_currency`, `effectiveAnchorPrice` → `effective_anchor_price`
  - `premiumPct` → `premium_pct`, `buyCurrencyId` → `buy_currency_id`
  - `sellCurrencyId` → `sell_currency_id`, `fairRate` → `fair_rate`
  - `marketRate` → `market_rate`, `deviationPct` → `deviation_pct`
  - `estimatedProfitPct` → `estimated_profit_pct`
  - flipper-proxy.ts transformKeys() now converts these to camelCase for frontend
- Added ProcessPoolExecutor warm-up at startup (main.py):
  - `_executor_warmup_task()` trivial function submitted to all workers
  - Avoids ~5s cold-start on first real request (sklearn/scipy import in spawn process)
  - Non-blocking: fires as asyncio.create_task during lifespan startup
- Added ProcessPoolExecutor shutdown on exit (main.py):
  - `process_pool.shutdown(wait=False, cancel_futures=True)` in lifespan cleanup
  - Prevents worker process leaks on exit
- Increased proxy timeouts for heavy endpoints:
  - Anomalies: default 15s → 45s (STL decomposition for 600+ currencies)
  - Correlation: default 15s → 60s (O(n^2) Spearman for 600+ currencies)
- Fixed fallback data in anomalies route to use camelCase (proxyWithFallback returns directly)
- Updated AGENT_NAVIGATION.md to v1.41 with all new rules and fixes

Stage Summary:
- ROOT CAUSE FIXED: All CPU-bound endpoints now run in ProcessPoolExecutor with timeouts
  - This prevents the event loop blocking that caused health check timeouts →
    bridge killing backend → circuit breaker cascade → ALL endpoints failing
- All executor calls now have timeout protection (30-90s depending on expected duration)
- ProcessPoolExecutor warm-up eliminates ~5s cold-start on first request
- ProcessPoolExecutor shutdown prevents worker process leaks
- Optimal-currency endpoint now uses consistent snake_case (transformKeys converts to camelCase)
- PipelineCache added for anomalies and correlation results (avoids recomputation)
- Stopping point: Code changes complete. Pending: E2E against live backend, Windows verification
