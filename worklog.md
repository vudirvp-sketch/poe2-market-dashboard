# Worklog

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
