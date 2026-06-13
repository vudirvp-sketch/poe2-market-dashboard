# PoE2 Market Dashboard — Рефакторинг

> Версия: 11.0 | Дата: 2026-06-12

## Фаза 1–4: DONE ✅

## Hotfix: Response Model Mismatches (iter 44)

6 interconnected bugs causing 503/500 cascade:

| # | Bug | Root Cause | Fix |
|---|-----|-----------|-----|
| 1 | 500 /api/v1/phase | PhaseResponse.max_hold_time: int, but lifecycle returns str | Changed type to str |
| 2 | 500 /api/v1/arbitrage/optimal-currency | OptimalCurrencyResponse schema completely wrong | Rewrote to match route return |
| 3 | 404 /api/health/ping (bridge) | Bridge missed /v1/ prefix from Phase 4.2 | Updated to /api/v1/health/ping |
| 4 | 503 /api/flipper/batch | Cascade: bridge kills backend → circuit breaker opens | Fixed via #3 |
| 5 | ERR_INCOMPLETE_CHUNKED_ENCODING /prices/stream | routes_sse.py didn't exist | Created SSE module |
| 6 | 500 /api/v1/arbitrage/flips | FlipsResponse/TriangularResponse didn't match route returns | Updated models |

Additional fixes:
- AnomaliesResponse: missing min_alert_score in error path
- AnalystSummaryResponse: camelCase keys + missing league field in early return
- PairData.stock_value: int→float (ExchangeRate uses float)
- SSE proxy: returns 200 + error event instead of 503 (prevents console spam)

## Ключевые принципы

1. **response_model= MUST match route return dict** — mismatch = 500
2. **All paths use /api/v1/ prefix** — bridge, proxy, routes, tests
3. **Bridge health = /api/v1/health/ping** — not /api/health/ping
4. **SSE — дополнение к polling, не замена**
5. **SSE proxy: 200 + error event** — not 503 (prevents retry storms)
