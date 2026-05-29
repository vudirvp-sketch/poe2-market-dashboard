# PoE2 Market Dashboard — Fix Log (Iteration 1)

## Fixes Applied

### 1. React #310 Error — ROOT CAUSE FIXED
**File:** `src/hooks/use-websocket.ts`

**Root Cause:** `reconnectCount` state was in the `connect` useCallback dependency array. This created an infinite re-render cascade:
- WS disconnects → `setReconnectCount` → `connect` recreated (dep changed) → consumer re-renders → repeat

**Fix:** Replaced `reconnectCount` state dependency with `reconnectCountRef` (a ref). The ref is updated on reconnect but doesn't trigger callback recreation. State is still updated for display purposes, but it's no longer a dependency of `connect`.

### 2. React #310 Error — SECONDARY: Rules of Hooks Violation
**File:** `src/hooks/use-websocket.ts`

**Root Cause:** `useFlipperWebSocket` called `useWebSocket` conditionally based on `typeof channelOrCallbacks`. This violates React's Rules of Hooks (hooks must be called in the same order every render).

**Fix:** Always call both `useWebSocket` hooks (for /ws/flips and /ws/anomalies), but control connectivity with the `enabled` flag. Also used callback refs (`onFlipsUpdateRef`, `onAnomalyRef`) instead of direct callback dependencies in useEffect, preventing re-fire on every render.

### 3. React #310 Error — SECONDARY: useDashboardStore bare call
**File:** `src/components/dashboard/dashboard-page.tsx`

**Root Cause:** `const { comparisonIds, pairComparisonIds, alerts } = useDashboardStore()` subscribes to EVERY store property change. When StoreRehydrator loads data from localStorage on mount, or any component toggles a favorite, the entire Dashboard re-renders.

**Fix:** Changed to targeted selectors: `useDashboardStore((s) => s.comparisonIds)` etc.

### 4. WebSocket URL Resolution — Console Errors Fixed
**File:** `src/hooks/use-websocket.ts`

**Root Cause:** `resolveWsBaseUrl()` defaulted to `window.location.host` (port 3000) when no `NEXT_PUBLIC_FLIPPER_API_URL` env var was set. Next.js on port 3000 has NO WebSocket endpoints, causing:
- `WebSocket connection to 'ws://localhost:3000/ws/flips' failed`
- `WebSocket connection to 'ws://localhost:3000/ws/anomalies' failed`

**Fix:** When no `NEXT_PUBLIC_FLIPPER_WS_URL` or `NEXT_PUBLIC_FLIPPER_API_URL` is configured, default to `ws://localhost:8000` (the FastAPI backend port). Also added `NEXT_PUBLIC_FLIPPER_WS_URL=ws://localhost:8000` to the .env.local templates in both start.bat and start.sh.

### 5. MarketOverview — Crash Safety
**File:** `src/components/dashboard/market-overview.tsx`

**Fix:** Wrapped `heatmapScale` useMemo in try-catch. Added React.memo wrapper. These prevent the #310 error from crashing the Market Overview tab if data is malformed.

### 6. Flip Score = 0 — Client-Side Recomputation
**File:** `src/components/dashboard/flips-helpers.ts`, `src/components/dashboard/flips-tab.tsx`

**Root Cause:** The backend returns `score: 0` for all opportunities (likely a backend scoring bug or insufficient data for scoring). The frontend just displayed whatever the backend returned.

**Fix:** Added `recomputeAllFlipScores()` function that recomputes scores client-side using the exact formulas from `PoE2_Flipper_Canonical_Formulas.md §7`:
- `spread_after_fees = (ask - bid) / mid_price - gold_fee_fraction`
- `fill_probability = log1p(volume_24h) / log1p(max_volume)`
- `expected_profit = spread_after_fees * fill_probability`
- `momentum_penalty = filter: 0.5 / 0.8 / 1.0`
- `vol_penalty = 1 / (1 + (volatility / vol_ref)^2)`
- `score = clamp(expected_profit * momentum_penalty * vol_penalty * phase_mult, 0, 1)`

Only recomputes when backend score is 0 (preserves valid backend scores).

### 7. Batch File — .env.local Updated + .gitattributes Added
**Files:** `start.bat`, `start.sh`, `.gitattributes`

**Fixes:**
- Added `NEXT_PUBLIC_FLIPPER_WS_URL=ws://localhost:8000` to .env.local template
- Added auto-detection of missing `NEXT_PUBLIC_FLIPPER_WS_URL` in existing .env.local
- Created `.gitattributes` to enforce CRLF line endings for .bat files (prevents CMD parse crashes)

---

## NOT YET FIXED (Iteration 2 needed)

1. **ArbitrageTab** also has the same FlipOpportunity type defined locally (not from flips-helpers) — needs deduplication
2. **FlipperStickyBar** queries duplicate data already fetched by Dashboard-level queries (flipper-health, flipper-phase, etc.)
3. **use-price-alerts.ts** calls `fetchApi` outside of `useQuery`, bypassing React Query caching
4. **Backend scoring module** — the server-side score computation needs to be debugged/fixed (not in this repo)
5. **PoE2_Flipper_Canonical_Formulas.md** — formulas verified and correct; no changes needed
