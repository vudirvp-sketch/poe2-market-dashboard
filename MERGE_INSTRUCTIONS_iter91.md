# MERGE INSTRUCTIONS — iter 91

> **Iteration type:** Pure recon & planning (NO source code changes). Documentation only.
> **Files changed:** 3 (all documentation)
> **Tests:** No tests run — no code changes.
> **Git commits:** See `git_commands.txt` in this archive.

---

## What's in this archive

```
iter91/
├── MERGE_INSTRUCTIONS_iter91.md   ← you are here
├── git_commands.txt               ← copy/paste to commit + push
├── STATUS.md                      ← replace existing
├── AGENT_NAVIGATION.md            ← replace existing
└── worklog.md                     ← replace existing
```

## Merge procedure

1. Extract this archive into the root of your local `poe2-market-dashboard` clone.
2. The 3 `.md` files will overwrite the existing ones. No source code is touched.
3. Run the git commands from `git_commands.txt` to commit + push.

## What iter 91 did

Pure recon refinement. No source code changes — only documentation updates.

### iter 90 critique (in chat, not in repo)

Confirmed 6 of iter 90's findings. Found **5 errors in iter 90**:
- E1: `relative_price` is per-currency vs BASE (Exalted), NOT per-pair
- E2: `current_quantity` (listings) ≠ `volume_traded` (24h trades) — iter 90 mixed them
- E3: `find_price_24h_ago` already exists — adding 24h volume delta is trivial
- E4: Triangular `executable_estimate` impossible without persistence first
- E5: `CURRENCY_DISPLAY_NAMES` hardcode is intentional fallback, not duplication

### POE2Scout API capability map (in chat, summarized in invariant #42)

- **12 endpoints** catalogued
- **8 free-data fields** already collected by DataSnapshot (every 5 min, ~16 API calls)
- **5 not-available data points** (real trades, order book depth, etc)

### 5 new Proposals F-J (in chat + documented in invariant #42(i))

All leverage data already collected — no new API calls needed:
- F: Wall detection (`highest_stock / current_quantity > 0.3`)
- G: OHLCV from `DailyStatsHistory` (endpoint exists, project doesn't use)
- H: Cross-pair volume correlation (from existing `price_logs`)
- I: Spread persistence (add `market_spread` to HistoricalStore)
- J: Liquidity-tier UI (`tiers.py` already computes T1-T5)

### 3 new Known Issues (in STATUS.md)

- **KI-7:** `TAB_MAP` has 2 dead slots (`"arbitrage"` idx 4, `"graph"` idx 11). Shortcut "5" does nothing.
- **KI-8:** `watchlist-tab.tsx:148-150` `pnl` column sorts identically to `change` column.
- **KI-9:** Cross-rate inconsistency uses 2 thresholds (10% backend / 5% frontend) + `affectedCurrencies` not truncated.

### 8 new Tech Debt items (in STATUS.md)

- **TD-1:** FlipsTable hides 5 backend-computed fields (`volume24h, bid, ask, fairRate, deviationPct`)
- **TD-2:** `content_pulse._category_today_volume` uses `current_quantity` instead of `volume_traded`
- **TD-3:** Triangular arbitrage has no persistence — cannot backtest executable_estimate
- **TD-4:** `market_spread` not persisted in HistoricalStore
- **TD-5:** `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used
- **TD-6:** `highest_stock` + `current_quantity` not used for Wall detection
- **TD-7:** `PriceMomentumTracker` momentum + volatility computed but not shown
- **TD-8:** Tier classification (T1-T5) not shown anywhere

### Refined iter 92-97 plan (in chat + STATUS.md iter 91 row)

- **iter 92:** cleanup (TAB_MAP + validTabs + FlipsTable columns + Watchlist pnl + cross-rate threshold)
- **iter 93:** Best Payment primary view (Hinakora's Hair example)
- **iter 94:** Spread Capture view (buy 80 / sell 100 example)
- **iter 95:** Overheat Index (using `volume_traded`, NOT `current_quantity`) + Wall Detection
- **iter 96:** Spread persistence + triangular persistence (prerequisite for executable_estimate)
- **iter 97+:** Proposal F-J exposition

## What was NOT done in iter 91 (intentionally)

- No source code changes (per user instruction "не генерируй докс и пдф, просто текстом в чат")
- No tests run (no code to test)
- No implementation of KI-7/8/9 or TD-1 — those are for iter 92

## Stop point — what to do next

**Awaiting user's answers to iter 90 Q1-Q14** (in iter 90 chat output). These determine exact iter 92-95 scope.

Once user answers, start **iter 92** with these priorities:
1. Remove dead `TAB_MAP` slots (`"arbitrage"`, `"graph"`) + clean up `store.ts:validTabs`
2. Add 5 columns to `FlipsTable` (volume24h, bid, ask, deviationPct, fairRate)
3. Fix `watchlist-tab.tsx:148-150` pnl duplicate (either remove column or implement entry-price tracking)
4. Truncate `cross_rate_warning.affectedCurrencies` to top-5 + "and N more"
5. Unify cross-rate threshold to 7% (backend `routes_arbitrage.py:824` + frontend `use-cross-rates.ts:91`)

## Files to read in new chat for iter 92

1. This `MERGE_INSTRUCTIONS_iter91.md` — context
2. `STATUS.md` — KI-7/8/9 + TD-1 (iter 92 scope)
3. `AGENT_NAVIGATION.md` invariant #42 — POE2Scout API capability map + iter 90 errors
4. `worklog.md` iter 91 entry — full work log
5. iter 90 chat output — Q1-Q14 to ask user about
