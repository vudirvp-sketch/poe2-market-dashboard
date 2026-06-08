# Worklog

---
Task ID: 13
Agent: main
Task: Iteration 2 — Fix CRITICAL + HIGH code bugs

Work Log:
- Fixed poe2api.ts: NaN guard for parseInt(Retry-After) — now uses Number.isFinite() check
- Fixed dashboard-page.tsx: Added `tab` to useEffect dependency array to prevent stale closure
- Fixed flipper-proxy.ts: Response body race condition — dedup map now stores BufferedProxyResult (data+status) instead of raw Response, each consumer gets a fresh NextResponse
- Fixed flipper-proxy.ts: Circuit breaker now only resets on res.ok (2xx), not on 503/5xx
- Fixed backend/main.py: Added asyncio.Lock (_health_check_lock) to prevent race condition on _provider_healthy/_last_health_check globals
- Fixed routes_optimizer.py: Replaced Dijkstra with Bellman-Ford algorithm — correctly handles negative -log(rate) weights when rate > 1
- Fixed routes_arbitrage.py: Removed gold_enabled stub completely — deleted fee_warning from flips/triangular responses, removed gold_fees_enabled variable and dead code
- Fixed analyst-fallback/route.ts: Z-score now computed on log-returns instead of absolute price changes, making it scale-invariant across currencies
- Fixed arbitrage-tab first-load bug: Added backendChecking state (from health query isPending), new "backend_checking" error kind shows "Checking…" instead of "Offline" while health check is in progress
- Added i18n keys for backend_checking in all 4 locales (en, ru, zh, ko)
- Build verified: npm run build passes successfully

Stage Summary:
- All 8 CRITICAL/HIGH bugs fixed
- Arbitrage tab first-load UX bug fixed (backend_checking state)
- Gold fee stub completely removed from routes_arbitrage.py (fee_warning, gold_fees_enabled, dead code)
- Documentation updated (worklog, AGENT_NAVIGATION.md)
