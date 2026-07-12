# Design Doc — P10 Gold Map ROI (Castaway runs)

> **Status:** DESIGN COMPLETE. **Phase 1 (MVP) SHIPPED iter 127. Phase 2 (trend chart) SHIPPED iter 132.** Phase 3 (SQLite promotion) optional.
> **Owner:** main agent. **Reviewed:** iter 127 implementation agent (Phase 1), iter 132 implementation agent (Phase 2).
> **Scope:** placement, input contract, ROI formula alignment, data dependencies.
> **Out of scope (Phase 1):** trend chart (Phase 2 — SHIPPED iter 132), SQLite persistence (Phase 3), reference-currency selector (deferred — MVP shows Div only).

---

## 1. Problem statement (from `docs/MARKET_PLAYBOOK.md` §C.8 + P10)

> Castaway map = 500k gold за пробег. Стоимость 1–2 Div в первую неделю.
> Автор считает: «если 500k gold через 3-way flips дают 5 Div, минус 2 Div
> за map = 3 Div чистой прибыли».
>
> Калькулятор: `expected_div = (gold × best_3way_rate) − map_cost`.
> Флаг, когда ROI > порог → рекомендовать фарм.

Today the dashboard exposes the 3-way flips engine (`/api/v1/arbitrage/triangular`,
shipped iter 65 P2-13) but never connects it to the gold economy. The user
must mentally compute "if I run a Castaway map for 500k gold, what's the
Div-equivalent of that gold via the best 3-way chain?"

This design-doc defines the UX, input contract, ROI formula alignment, and
data dependencies for a **Gold Map ROI** tab. Implementation deferred to
iter 127+.

---

## 2. Dependency check — P1 3-way flips

`STATUS.md` and `docs/MARKET_PLAYBOOK.md` both note that P10 depends on
**P1 3-way flips**. P1 is **shipped** (iter 65 P2-13 + iter 67 P2-4 + iter
68 P2-4 cleanup). Specifically:

- `backend/arbitrage/triangular.py:find_triangular_arbitrage(rates, min_profit_pct, ...)`
  — Bellman-Ford negative-cycle detector with integer validation
  (`simulate_cycle_integers`, `find_min_profitable_start`).
- `backend/api/routes_arbitrage.py` `/api/v1/arbitrage/triangular` — REST
  endpoint, returns `opportunities` with `cycle`, `raw_profit_pct`,
  `executable_estimate`, `executable_profit`, `confidence`.
- `src/app/api/flipper/triangular/route.ts` — Next.js proxy.
- `src/components/dashboard/arbitrage-flipper-triangular.tsx` — existing
  triangular arb tab UI.

**Conclusion:** the "best_3way_rate" half of the P10 formula is already
available. P10 needs only: (a) gold input UI, (b) the `gold → Div`
conversion rate source, (c) ROI computation, (d) result presentation.

---

## 3. Critical unknown — `gold → Div` rate source

### 3.1 Why gold is special

Gold is NOT one of the ~46 currencies in `DataSnapshot.exchange_rates`
(those are all tradeable currencies on the POE2 exchange). Gold drops from
monsters and is spent on vendor fees — it has no direct exchange listing.

### 3.2 What `PoE2_Flipper_Canonical_Formulas.md` §13 says

> **§13.1 Method 2 (recommended):** Maintain a `gold_chaos_rates` table
> in SQLite, updated whenever a user manually inputs a rate. Provide a UI
> field: "Current gold-to-chaos rate: [input]" with a default estimate.

> **§13.2 Default:** `gold_to_chaos_rate` = 0.001 (1000 gold ≈ 1 Chaos).
> **§13.2 Bounds:** must be > 0. The system must warn if no rate has been
> observed in the last 24 hours.

Note: the historical `gold_chaos_rates` table was **removed** from the
schema (see `historical.py:_drop_obsolete_tables()` — drops the table if it
exists). The recipe-arbitrage module that used it was deleted. So P10
cannot rely on the old table — it needs a new persistence approach.

### 3.3 Three options for the gold rate

| Option                                     | Source                                                       | Pros                                          | Cons                                                                                  |
|--------------------------------------------|--------------------------------------------------------------|-----------------------------------------------|---------------------------------------------------------------------------------------|
| **A. Manual input only** (recommended MVP) | User types "gold per Div" or "Div per 1M gold" in the UI     | Zero new persistence; matches §13.2 default   | Rate is gone on reload unless persisted; user must keep it fresh                      |
| **B. localStorage persistence**            | Same input, but persisted to `localStorage` on the client    | Survives reloads; per-user customization       | Not shared across devices; rate drifts silently if user forgets to update             |
| **C. New `gold_rates` SQLite table**       | Manual input via API + 24h staleness warning (per §13.2)     | Shared across clients; staleness flag         | Adds persistence layer (couples to TD-3/4/5/9 design-doc); scope creep for an MVP     |

**Recommendation: Option B for MVP, Option C as a follow-up.** localStorage
keeps the feature self-contained and avoids entangling with the
persistence-layer design in `docs/design/TD-3-4-5-9-persistence-gaps-design.md`.
If the feature gets adoption, promote to SQLite in a later iter.

### 3.4 Default rate & bounds

- Default: **`gold_per_divine = 100_000`** (i.e., 100k gold ≈ 1 Divine).
  This is a conservative mid-league estimate based on the playbook's
  "500k gold → 5 Div" example.
- Bounds: `gold_per_divine` must be in `[1_000, 10_000_000]`. Values
  outside this range are obvious unit errors (user typed "100" meaning
  100k, or "100M" meaning 100).
- **Staleness warning:** show a soft warning when the stored rate is older
  than 7 days (localStorage stores a timestamp alongside the value).

---

## 4. ROI formula — alignment with §C.8 and §13

### 4.1 The §C.8 formula (from `docs/MARKET_PLAYBOOK.md`)

```
expected_div = (gold × best_3way_rate) − map_cost
```

Where:
- `gold` — total gold expected from one Castaway run (user input, default 500k).
- `best_3way_rate` — best conversion rate `gold → ... → Div` via 3-way flips.
- `map_cost` — cost of the map in Div (user input, default 2 Div per §C.8).

### 4.2 The §13 formula (gold-to-Chaos, then Chaos-to-Div)

§13 talks about `gold_to_chaos_rate` (gold → Chaos). The 3-way flips
engine works on tradeable currencies. So there are **two different
"rates"** at play:

1. **`gold → tradeable_currency`** — NOT in the 3-way flips engine. This
   is the manual gold-per-Divine rate (Section 3.3 above).
2. **`tradeable_currency → Div`** — IN the 3-way flips engine. Pick the
   best chain that ends in Div.

### 4.3 Reconciled P10 formula

The §C.8 formula `gold × best_3way_rate` collapses both rates into one.
For implementation, we split them:

```
# Step 1: gold → Div via the manual gold-per-Divine rate
gold_in_div = gold_amount / gold_per_divine

# Step 2: best 3-way chain that ENDS in Div (already computed by /api/v1/arbitrage/triangular)
# Returns cycle: A → B → Div, with executable_estimate (min profitable start) + executable_profit
best_3way_cycle = pick_best_cycle_ending_in_div(opportunities)

# Step 3: simulate the chain with `gold_in_div` as start amount
final_div = simulate_cycle_integers(
    cycle=best_3way_cycle.currencies,
    rates=snapshot.exchange_rates,
    start_amount=int(gold_in_div * 100),  # scale to integer cents-of-Div if needed
) / 100  # scale back

# Step 4: ROI
expected_div = final_div - map_cost
roi_pct = (expected_div / map_cost) * 100 if map_cost > 0 else float('inf')
```

**Alignment with §C.8:** `expected_div` matches `(gold × best_3way_rate) − map_cost`
when `best_3way_rate = (gold_in_div / gold) × (final_div / gold_in_div) = final_div / gold`.
The §C.8 formula treats this as a single multiplier; the implementation
splits it into the manual gold→Div step + the 3-way chain step. The result
is identical; the split is necessary because the 3-way engine doesn't know
about gold.

### 4.4 Edge cases

| Case                                          | Behavior                                                                                          |
|-----------------------------------------------|---------------------------------------------------------------------------------------------------|
| No 3-way cycle ends in Div in current snapshot | Show "no profitable 3-way chain available right now" + fall back to `expected_div = gold_in_div − map_cost` (skip 3-way multiplier, treat gold-to-Div as direct conversion). |
| `map_cost = 0` (free map)                     | `roi_pct = inf`. Display "∞" instead of a number.                                                  |
| `gold_amount = 0`                             | Show "enter gold amount" placeholder; no computation.                                              |
| `gold_per_divine` not set (first visit)        | Pre-fill the default (100k) + show a "this is a default estimate — update with your in-game observation" hint. |
| 3-way chain's `executable_estimate` > `gold_in_div` | The user's gold amount is below the minimum profitable start for the best cycle. Show "your gold amount is below the minimum profitable cycle (`executable_estimate` = X Div) — try a larger amount or wait for a better cycle." |
| Stale gold rate (>7 days)                     | Show amber warning "Your gold rate is X days old — verify it's still accurate."                    |
| Stale snapshot (>5 min)                       | Show existing "data freshness" warning (already implemented in `data-freshness-badge.tsx`).        |

---

## 5. Tab placement in `TAB_MAP`

### 5.1 Current state

`dashboard-page.tsx:TAB_MAP` (module-level, line 197) has **14 entries**:

```ts
const TAB_MAP = [
  "overview",           // shortcut 1
  "currencies",         // shortcut 2
  "uniques",            // shortcut 3
  "exchange",           // shortcut 4
  "flips",              // shortcut 5
  "optimizer",          // shortcut 6
  "analyst",            // shortcut 7
  "storage-value",      // shortcut 8
  "speculation",        // shortcut 9
  "circuit-patterns",   // shortcut 0
  "intraday-patterns",  // click-only
  "weekly-patterns",    // click-only
  "mirror-divine-arb",  // click-only
  "liquid-chain",       // click-only
  "watchlist",          // click-only
];
```

The header comment says "15 in iter 109" but the actual count is 14
(iter-109 comment is stale — `arbitrage` was removed in KI-7 and `graph`
was removed in iter 87, both before iter 109 added `mirror-divine-arb`).

### 5.2 Keyboard shortcut constraint

Shortcuts 1–9 + 0 cover only the first 10 tabs. Tabs 11–14 are click-only.
This is by design (KI-7 in iter 92): the 10-slot limit is a UI constraint
(ten single-digit keys), not a bug.

### 5.3 Placement options for Gold Map ROI

| Option                              | Position in `TAB_MAP`             | Shortcut?    | Pros                                                                 | Cons                                                                                |
|-------------------------------------|-----------------------------------|--------------|----------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| **A. After `mirror-divine-arb`** (recommended) | index 13 (before `liquid-chain`) | Click-only   | Groups with the analytics cluster (speculation → circuits → intraday → weekly → mirror-divine → gold-map); natural "what should I farm" flow | Pushes `liquid-chain` and `watchlist` down — they're already click-only, no UX loss |
| **B. After `analyst`**              | index 7 (before `storage-value`)  | Shortcut 8 (pushes storage-value to 9, speculation to click-only) | High visibility — Gold Map ROI is a "killer feature" per §C.8        | Steals shortcut 8 from `storage-value` (a frequently-used tab); breaks user muscle memory |
| **C. As a sub-tab of `flips`**       | Inside `flips-tab.tsx`            | N/A          | Reuses existing tab; "flips" already shows 3-way arb                 | Conflates two different mental models (flips = "what to trade now" vs gold-map = "what to farm"); hides the feature |
| **D. As a widget on `overview`**     | Inside `overview-tab-content.tsx` | N/A          | Maximum visibility — first thing user sees                           | Overview is already 3 widgets (ContentPulse + PhaseHints + MarketOverview); adding a 4th clutters |

**Recommendation: Option A** — append after `mirror-divine-arb` as a
click-only tab. The 5 tabs from `storage-value` through `mirror-divine-arb`
form a coherent "what's the optimal money strategy" cluster; Gold Map ROI
fits naturally as the "what to farm" bookend. No shortcut reallocation,
no muscle-memory breakage, no overview clutter.

### 5.4 Updated `TAB_MAP` (iter 127+ implementation)

```ts
const TAB_MAP = [
  "overview",
  "currencies",
  "uniques",
  "exchange",
  "flips",
  "optimizer",
  "analyst",
  "storage-value",
  "speculation",
  "circuit-patterns",
  "intraday-patterns",
  "weekly-patterns",
  "mirror-divine-arb",
  "gold-map-roi",        // NEW — iter 127+ (P10, click-only)
  "liquid-chain",
  "watchlist",
];
```

The `keyboardActions` useMemo (line 732) and the shortcuts-dialog
(`shortcuts-dialog.tsx`) need no changes — the shortcut 1–0 mapping is
unchanged. Only `dashboard-toolbar.tsx` (renders the TabsList) and
`dashboard-page.tsx` (renders the active tab content) need a new branch.

---

## 6. Input contract

### 6.1 User-visible inputs

| Field                     | Type      | Default           | Bounds                          | Persistence         |
|---------------------------|-----------|-------------------|---------------------------------|---------------------|
| **Gold amount** per run   | number    | 500_000           | `[1, 10_000_000]`               | localStorage        |
| **Map cost (Div)**        | number    | 2.0               | `[0, 100]` (allows 0 = free map) | localStorage        |
| **Gold per Divine rate**  | number    | 100_000           | `[1_000, 10_000_000]`           | localStorage + timestamp (Section 3.4) |
| **Days** (for trend)      | select    | 7                 | `[1, 7, 14, 30]`                | URL query param     |
| **Reference currency**    | select    | league base (Exa) | All currencies in snapshot      | URL query param     |

### 6.2 Why "Days" and "Reference currency" inputs?

- **Days** — for the optional trend chart "ROI over the last N days" (uses
  TD-3 historical cycles once that persistence exists; until then, this
  input is hidden behind a feature flag or greyed out with a tooltip
  "requires TD-3 persistence — coming soon").
- **Reference currency** — allows the user to see the ROI in their
  preferred currency (Div, Exa, Mirror). The computation is always in Div
  (matches §C.8), then converted for display.

### 6.3 Defaults rationale

- **Gold amount = 500k**: matches §C.8's "Castaway map = 500k gold за
  пробег".
- **Map cost = 2 Div**: matches §C.8's "Стоимость 1–2 Div в первую неделю"
  (upper bound for early-league conservatism).
- **Gold per Divine = 100k**: derived from §C.8's "500k gold → 5 Div"
  example (500k / 5 = 100k). This is a mid-league estimate; early league
  is closer to 50k gold/Div (gold is scarcer, Div is cheaper); late league
  can be 200k+ gold/Div (gold inflates, Div gets expensive).
- **Days = 7**: matches the `mirror-divine-arb-tab.tsx` default (consistency
  across analytics tabs).
- **Reference currency = league base (Exalted)**: matches the existing
  convention in `useDisplayPrice` (`_adaptive` mode auto-selects
  Div/Exa/Chaos per row, but for a single-number ROI display, a fixed
  currency is clearer).

### 6.4 URL contract

The tab is bookmarkable via query params:

```
/?tab=gold-map-roi&gold=500000&mapCost=2&goldPerDiv=100000&days=7&ref=divine
```

All inputs are optional — defaults apply when missing. This matches the
existing pattern in `mirror-divine-arb-tab.tsx` (uses
`useSearchParams` for the `days` selector).

---

## 7. UI layout (text mockup)

```
┌─ Gold Map ROI (Castaway) ─────────────────────────────────────────────┐
│                                                                       │
│  Inputs                                                               │
│  ┌─ Gold per run ─────┐  ┌─ Map cost (Div) ─┐  ┌─ Gold/Div rate ────┐ │
│  │ 500,000            │  │ 2.0              │  │ 100,000  ⚠ 3d old │ │
│  └────────────────────┘  └──────────────────┘  └────────────────────┘ │
│  ┌─ Days ──┐  ┌─ Reference currency ─┐                                  │
│  │ 7 ▼     │  │ Divine ▼             │                                  │
│  └─────────┘  └──────────────────────┘                                  │
│                                                                       │
├─ Result ──────────────────────────────────────────────────────────────┤
│                                                                       │
│   Expected ROI:  +3.0 Div   (+150% ROI)         🟢 FARM RECOMMENDED   │
│                                                                       │
│   Breakdown:                                                          │
│     Gold → Div (manual rate):  500,000 gold ÷ 100,000 gold/Div = 5.0  │
│     Best 3-way chain:          Divine → Exalted → Mirror → Divine     │
│       Raw profit:              +0.8% (continuous)                     │
│       Executable estimate:     4 Div minimum start                    │
│       Final after integer sim: 5.4 Div (your 5.0 start)               │
│     Map cost:                  −2.0 Div                               │
│     ─────────────────────────────────────                             │
│     Expected net:              3.4 Div                                │
│                                                                       │
│   ⚠ Your gold amount (5.0 Div) is above the minimum profitable        │
│     start (4 Div) for this cycle — full profit captured.              │
│                                                                       │
├─ ROI trend (last 7 days) ─────────────────────────────────────────────┤
│   [chart: y = expected_div per day, x = day]                          │
│   ℹ Requires TD-3 persistence — coming iter 127+                      │
│                                                                       │
├─ 3-way cycle detail ──────────────────────────────────────────────────┤
│   [reuse arbitrage-flipper-triangular.tsx with cycle filter preset]   │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### 7.1 Components to build

| Component (new)                       | Purpose                                                      | Reuses                                                                              |
|---------------------------------------|--------------------------------------------------------------|-------------------------------------------------------------------------------------|
| `gold-map-roi-tab.tsx`                | Top-level tab content + state + URL params                   | Pattern from `mirror-divine-arb-tab.tsx`                                            |
| `gold-map-roi-calculator.tsx`         | The inputs + result card                                     | `useDashboardStore` for league/base currency, `useFlipperBackend` for online status |
| `gold-rate-input.tsx`                 | Specialized input for the gold/Div rate + staleness warning  | Pattern from `data-freshness-badge.tsx`                                             |
| `gold-map-roi-trend-chart.tsx`        | The trend chart (greyed out until TD-3 ships)                | Pattern from `storage-value-history-chart.tsx` (SVG, no deps)                       |
| (existing) `arbitrage-flipper-triangular.tsx` | Already-built 3-way arb detail — reused with a preset cycle filter | N/A |

### 7.2 Recommendation flag logic

```
if expected_div <= 0:        "🔴 AVOID — negative ROI"
elif roi_pct < 50:           "🟡 MARGINAL — consider if map supply is free"
elif roi_pct < 150:          "🟢 FARM RECOMMENDED"
else:                        "🟢🟢 STRONG FARM — high ROI window"
```

Thresholds (50%, 150%) are tunable constants at the top of
`gold-map-roi-calculator.tsx`, mirroring the `MOMENTUM_UP_THRESHOLD_PCT`
pattern in `phase_hints.py`.

---

## 8. API surface (no new endpoints)

The Gold Map ROI tab uses **only existing endpoints**:

| Endpoint                                       | Purpose                                                  |
|------------------------------------------------|----------------------------------------------------------|
| `GET /api/v1/arbitrage/triangular` (existing)  | Fetch current 3-way cycles; filter for cycles ending in Div |
| `GET /api/flipper/health` (existing)           | Online status — disable inputs when offline              |
| `useDashboardStore` (existing Zustand store)   | League + base currency state                             |

**No new backend endpoint.** The "best_3way_rate" computation is a
client-side filter+sort on the existing `/triangular` response. This
keeps the feature self-contained and avoids coupling with the TD-3
persistence design.

### 8.1 Why no backend endpoint?

A backend `/api/v1/gold-map-roi` endpoint would make sense if:
- The gold rate were persisted server-side (Option C in Section 3.3).
- The computation were expensive enough to warrant server caching.

Neither is true for the MVP: the computation is one filter+sort+integer
simulate, all on data the client already has. Pushing it server-side
would add a route, a response model, a TS type, and a proxy — all for a
<1ms client-side computation.

**Follow-up:** if the feature gets adoption and the gold rate is promoted
to SQLite (Option C), then a `/api/v1/gold-rates` endpoint makes sense.
Defer until then.

---

## 9. i18n

### 9.1 New keys (×4 locales)

Approximate count: **~25 keys × 4 locales** (en/ru/ko/zh), matching the
existing parity invariant (1191 keys × 4 locales in iter 110).

Key prefix: `goldMap*` (e.g. `goldMapTitle`, `goldMapGoldPerRun`,
`goldMapMapCost`, `goldMapGoldPerDiv`, `goldMapRateStaleWarning`,
`goldMapResultExpectedDiv`, `goldMapResultRoiPct`,
`goldMapRecommendationAvoid`, `goldMapRecommendationMarginal`,
`goldMapRecommendationFarm`, `goldMapRecommendationStrongFarm`,
`goldMapBreakdownTitle`, `goldMapBreakdownManualConversion`,
`goldMapBreakdownBestCycle`, `goldMapBreakdownMapCost`,
`goldMapBreakdownExpectedNet`, `goldMapMinStartWarning`,
`goldMapNoCycleAvailable`, `goldMapNoCycleFallback`,
`goldMapTrendTitle`, `goldMapTrendRequiresTd3`,
`goldMapInputsTitle`, `goldMapResultTitle`, `goldMapDays`,
`goldMapReferenceCurrency`).

### 9.2 Russian-first copy

Per `PRODUCT_VISION.md` §3.1, the primary audience is Russian-speaking.
The `ru.ts` file is the source of truth; `en/ko/zh` are translations.

Sample copy (Russian):
- `goldMapTitle`: "ROI Gold Map (Castaway)"
- `goldMapGoldPerRun`: "Голд за пробег"
- `goldMapMapCost`: "Стоимость карты (Div)"
- `goldMapGoldPerDiv`: "Голд за 1 Div"
- `goldMapResultExpectedDiv`: "Ожидаемая прибыль"
- `goldMapRecommendationFarm`: "ФАРМИТЬ"
- `goldMapRecommendationAvoid`: "ИЗБЕГАТЬ — отрицательный ROI"

### 9.3 Cleanup script integration

The `scripts/cleanup_dead_i18n_keys.py` script (iter 89 pattern) needs
no changes — it auto-detects dead keys by grepping for `t('goldMap*')`
references in `*.tsx` files. If the feature is ever removed, the script
will catch all 25 keys.

---

## 10. Test plan

### 10.1 Unit tests (jest)

| Test file (new)                                | Cases                                                                                  |
|------------------------------------------------|----------------------------------------------------------------------------------------|
| `src/__tests__/gold-map-roi-calculator.test.tsx` | Renders default inputs; verifies default ROI computation with mocked `/triangular` response; verifies edge cases (map_cost=0, gold=0, no cycles); verifies staleness warning render; verifies recommendation thresholds (49% → MARGINAL, 50% → FARM, 149% → FARM, 150% → STRONG) |
| `src/__tests__/gold-map-roi-tab.test.tsx`       | Tab renders when `tab=gold-map-roi`; URL params read/write; offline state disables inputs |

Target: ~15 jest tests, following the pattern of
`speculation-backtest-panel.test.tsx`.

### 10.2 E2E (Playwright) — optional

A single smoke test in `e2e/smoke.spec.ts`:
- Navigate to `/?tab=gold-map-roi`
- Verify the inputs panel renders
- Verify the result card renders with non-empty text

### 10.3 Backend tests

**None required.** The feature uses only existing endpoints, which
already have their own test coverage (`tests/test_triangular.py`,
`tests/test_flips_integration.py`).

---

## 11. Risks & open questions

### 11.1 Risks

| Risk                                                              | Mitigation                                                                                                  |
|-------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| Default `gold_per_divine = 100k` is wildly wrong for some leagues | Show a prominent "default estimate — update with your in-game observation" hint on first visit             |
| User enters `gold_per_divine` in wrong units (e.g., "100" meaning 100k) | Bounds check (Section 3.4) rejects values < 1000 with a clear error message                                 |
| 3-way cycle data is stale (snapshot >5min old)                    | Existing `data-freshness-badge.tsx` already shows staleness; reuse it                                       |
| Feature creep: requests for "gold per Breach", "gold per Ritual"  | Out of scope for MVP. Document in `docs/MARKET_PLAYBOOK.md` §C.8 as a future extension.                     |
| `arbitrage-flipper-triangular.tsx` doesn't accept a preset filter | Will need a small prop addition (`initialCycleFilter`) — minor change, not a rewrite                        |

### 11.2 Open questions (defer to iter 127 implementation agent)

1. **Should the trend chart ship disabled in MVP, or be hidden entirely
   until TD-3 lands?**
   *Resolved iter 127:* shipped **neither** — the MVP simply did not include
   the trend chart at all (no placeholder, no disabled card). The chart was
   added in iter 132 (Phase 2) once TD-3 Phase 3 landed. This avoided the
   "disabled UI lying around" trap — the chart only renders once it has real
   data to show.

2. **Should the gold rate be per-league or global?**
   *Default: per-league. Different leagues have different gold economies
   (early vs mid vs late). Store `goldPerDiv[league]` in localStorage.*

3. **Should the "Reference currency" selector include all 46 snapshot
   currencies, or just the top 5 (Div, Exa, Mirror, Chaos, Hinekora)?**
   *Default: top 5 — keeps the dropdown usable. Power users can switch to
   the `flips` tab for the full currency matrix.*

4. **Should the recommendation flag persist across snapshot refreshes,
   or recompute on every refresh?**
   *Default: recompute on every refresh — the cycle data changes
   minute-to-minute, so a stale flag is misleading.*

5. **Should we add a "save as preset" feature for the inputs (e.g., "my
   usual Castaway config")?**
   *Default: no — localStorage already persists the last-used values. A
   preset manager adds UI complexity for marginal value.*

---

## 12. Implementation phasing (suggested for iter 127+)

### Phase 1 (MVP, no trend chart) — SHIPPED iter 127
- Build `gold-map-roi-tab.tsx` + `gold-map-roi-calculator.tsx`.
- Wire to existing `/api/v1/arbitrage/triangular` endpoint.
- localStorage persistence for inputs.
- i18n × 4 locales (~25 keys).
- ~15 jest tests.
- Add to `TAB_MAP` at index 13 (Option A placement).

### Phase 2 (trend chart) — SHIPPED iter 132
- Added `gold-map-roi-trend-chart.tsx` (SVG, dependency-free — same pattern as `storage-value-history-chart.tsx`).
- Wired to the new `/api/flipper/triangular/history` proxy route (proxies to FastAPI `GET /api/v1/arbitrage/triangular/history` from TD-3 Phase 3, iter 129).
- **Chart signal decision:** the chart plots the **best-cycle `raw_profit_pct`** per timestamp (deduped to highest non-null profit per 5-min snapshot bucket), NOT the computed `expected_div`. Rationale: `expected_div` depends on user inputs (`goldAmount`, `mapCost`, `goldPerDiv`) that have no historical persistence — those are localStorage values for "now", not a time-series. The historical signal we DO have is `raw_profit_pct`, which is exactly the multiplier the live calculator consumes. The user can mentally map "higher line = better ROI window" without us pretending to know their historical gold_per_div rate.
- Added Days selector (1/7/14/30/90, default 7) + dashed zero-line + point-count footer + available-cycle-keys count.
- New TS types `TriangularCycleHistoryPoint` + `TriangularCyclesHistoryResponse` (camelCase, mirrored from backend pydantic).
- Pure helper `pickBestPerTimestamp(points)` exported for unit tests.
- 13 new jest tests (5 pure-helper + 8 component), 698 total green, 0 regressions. `tsc --noEmit` clean. ESLint clean.
- 13 new i18n keys × 4 locales (1243 total per locale — parity preserved).

### Phase 3 (gold rate SQLite promotion) — optional, only if adoption is high
- Add `gold_rates` table to `historical.py` (couples to TD-* design-doc).
- Add `/api/v1/gold-rates` POST + GET endpoints.
- Migrate localStorage → SQLite with a one-time import.
- Add 24h staleness flag per §13.2.

---

## 13. References

- `docs/MARKET_PLAYBOOK.md` §C.8 — the canonical P10 spec.
- `docs/MARKET_PLAYBOOK.md` P10 entry — "Castaway map = 500k gold за пробег".
- `PoE2_Flipper_Canonical_Formulas.md` §13 — `gold_to_chaos_rate` method + default (0.001) + bounds + staleness.
- `backend/arbitrage/triangular.py` — `find_triangular_arbitrage`, `simulate_cycle_integers`, `find_min_profitable_start` (the engine P10 reuses).
- `src/components/dashboard/arbitrage-flipper-triangular.tsx` — existing 3-way arb UI (component to reuse for cycle detail).
- `src/components/dashboard/mirror-divine-arb-tab.tsx` — single-card pattern + days selector + URL params (template for the new tab).
- `src/components/dashboard/dashboard-page.tsx:TAB_MAP` (line 197) — tab placement target.
- `docs/design/TD-3-4-5-9-persistence-gaps-design.md` — Phase 3 of that doc defines the `/api/v1/arbitrage/triangular/history` endpoint this feature's trend chart will consume.
- `PRODUCT_VISION.md` §3.6 — "killer feature" framing (the dashboard's job is actionable "what to farm" recommendations, not raw tables).
