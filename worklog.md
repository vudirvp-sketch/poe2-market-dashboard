# Worklog

---
Task ID: 14
Agent: main
Task: Iteration 3 — Gold code removal, circuit breaker tuning, documentation cleanup

Work Log:
- Removed FeesConfig class from backend/config.py (gold_enabled, gold_to_chaos_rate_source, fixed_gold_to_chaos_rate, unknown_item_gold_cost)
- Removed fees: section from config.yaml, replaced with a comment noting gold fees are permanently excluded
- Deleted backend/economy/gold_costs.py and gold_cost_table.py
- Updated backend/economy/__init__.py to note deletion of gold modules
- Removed FeeWarning interface and feeWarning fields from FlipsResponse/TriangularResponse in src/lib/types.ts
- Removed gold fee warning UI blocks from arbitrage-tab.tsx and flips-tab.tsx
- Removed unused Coins icon imports from both components
- Reduced circuit breaker FLIPPER_CB_INITIAL_COOLDOWN from 60s to 15s for faster cold-start recovery
- Updated docs/ARCHITECTURE.md: I9 (gold permanently excluded), P8 (5 failures → 15s), circuit breaker descriptions
- Updated docs/BACKEND_GUIDE.md: §6.9 recipe gold note
- Updated docs/DATA_FLOW.md: §4.3 recipe gold note, §8.5 known discrepancies (FeesConfig removed)
- Updated PoE2_Flipper_Canonical_Formulas.md: DEPRECATED notice updated to reflect code removal
- Updated AGENT_NAVIGATION.md: version 1.18, frequent bugs #10, confirmed intentional #2, COMPLETED section

Stage Summary:
- All gold-related code fully removed from config, backend modules, and frontend types/components
- Circuit breaker initial cooldown reduced from 60s to 15s
- Documentation fully updated and consistent
- Remaining for next iteration: triangular.py gold_cost_per_unit parameter cleanup, E2E test updates, i18n key cleanup (flipsGoldFeesExcluded/Desc)

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
