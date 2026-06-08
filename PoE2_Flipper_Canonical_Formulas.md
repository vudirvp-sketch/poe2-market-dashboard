# PoE2 Flipper — Canonical Formulas & Algorithms Reference

> **PURPOSE:** This file is the single source of truth for all mathematical formulas, statistical procedures, and algorithms used in the PoE2 Flipper system. LLM agents implementing this system MUST copy formulas from this file verbatim. Do NOT derive, paraphrase, or "simplify" from memory.
>
> **VERIFICATION STATUS:** Each formula is either (a) a standard result from statistics/finance with a cited source, or (b) a direct consequence of domain logic (PoE2 trading mechanics). Where possible, a verification method is noted.
>
> **PoE2 vs PoE1 WARNING:** The gold fee model in §3 is specific to Path of Exile 2. Do NOT apply PoE1 fee assumptions. In PoE1, the exchange fee model is different. This entire document assumes PoE2 mechanics throughout.
>
> **⚠️ DEPRECATED SECTIONS NOTICE:** Sections marked `DEPRECATED` or `SIMPLIFIED` document formulas that are **no longer active in the codebase**. Gold fee calculations (§3) are disabled (`gold_enabled: false` in config); triangular arbitrage (§8) and recipe arbitrage (§9) use simplified no-fee formulas. The `gold_costs.py` and `gold_cost_table.py` modules still exist but are not wired into the active scoring/arbitrage pipeline. These sections are kept for reference only — do NOT implement the fee-aware versions unless `gold_enabled` is set to `true` AND the integration code is completed (currently a TODO stub).

---

## §1. League Phase Detection

### Formula

```
days_since_reference = floor((current_utc_timestamp - reference_timestamp) / 86400)

reference_timestamp = max(league_start_timestamp, last_major_patch_timestamp)

if days_since_reference ≤ phase_early_days:      → EARLY
elif days_since_reference ≤ phase_mid_days:       → MID
else:                                              → LATE
```

### Defaults (configurable via `config.yaml` → `league.phase_early_days`, `league.phase_mid_days`)

```
phase_early_days = 14
phase_mid_days = 42
```

### Verification

Set `league_start = 2025-01-15T00:00:00Z`, `current = 2025-01-20T12:00:00Z` → `days_since = 5` → EARLY.
Set `current = 2025-02-01T00:00:00Z` → `days_since = 17` → MID.
Set `current = 2025-03-10T00:00:00Z` → `days_since = 54` → LATE.

### Source

Domain-specific convention based on observed PoE2 league lifecycle.

---

## §2. Log-Returns, Momentum, Volatility, Acceleration

### 2.1 Log-Returns

Given a price series `P = [P_0, P_1, ..., P_n]`:

```
log_returns[i] = ln(P[i+1] / P[i])    for i = 0, 1, ..., n-1
```

**CRITICAL:** Use `numpy.log` (natural logarithm, base e). Do NOT use log base 10.

### 2.2 Momentum

```
momentum = mean(log_returns)
```

Where `mean` is the arithmetic mean over the rolling window.

### 2.3 Volatility

```
volatility = std(log_returns, ddof=1)
```

**CRITICAL:** Use `ddof=1` (Bessel's correction / sample standard deviation). This is the convention in finance. Using `ddof=0` (population std) would underestimate volatility for small windows.

### 2.4 Acceleration

Given `m` (acceleration lookback periods, default: `m = max(1, floor(len(log_returns) / 4))`):

```
acceleration = (log_returns[-1] - log_returns[-1-m]) / m
```

**IMPORTANT:** `log_returns[-1-m]` means "the element m positions before the last one". In Python indexing, with m=1, this is `log_returns[-2]` (second-to-last). The previous version used `log_returns[-m]` which with m=1 equals `log_returns[-1]`, making acceleration always zero — that was a bug.

### 2.5 Full Tracker Class Pseudocode

```python
import numpy as np

class PriceMomentumTracker:
    def __init__(self, window_size: int = 24):
        self.window_size = window_size
        self.prices: list[float] = []

    def update(self, new_price: float):
        self.prices.append(new_price)
        if len(self.prices) > self.window_size + 1:
            self.prices = self.prices[-(self.window_size + 1):]

    def compute(self) -> dict:
        if len(self.prices) < 2:
            return {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}

        log_returns = np.diff(np.log(self.prices))

        momentum = float(np.mean(log_returns))
        volatility = float(np.std(log_returns, ddof=1)) if len(log_returns) > 1 else 0.0

        m = max(1, len(log_returns) // 4)
        if len(log_returns) > m:
            acceleration = float((log_returns[-1] - log_returns[-1 - m]) / m)
        else:
            acceleration = 0.0

        return {
            "momentum": momentum,
            "volatility": volatility,
            "acceleration": acceleration,
        }
```

### Verification

Given `P = [100, 102, 101, 103, 105]`:
- `log_returns = [ln(102/100), ln(101/102), ln(103/101), ln(105/103)]`
- `= [0.01980, -0.00985, 0.01961, 0.01923]`
- `momentum = mean = 0.01220`
- `volatility = std(ddof=1) = 0.01429`
- `m = 1, acceleration = (0.01923 - 0.01961) / 1 = -0.00038`

### Source

Standard financial mathematics. Log-returns are the standard in quantitative finance (Hull, "Options, Futures, and Other Derivatives").

---

## §3. Gold Fee Model (PoE2-Specific)

> **⚠️ DEPRECATED — DISABLED IN CODEBASE:**
> Gold fee calculations are currently disabled (`gold_enabled: false` in `config.yaml`).
> The `gold_costs.py` and `gold_cost_table.py` modules still exist in `backend/economy/`
> but are **not imported or called** from any active route. The `FeesConfig` fields
> (`gold_to_chaos_rate_source`, `fixed_gold_to_chaos_rate`, `unknown_item_gold_cost`)
> remain in `config.yaml` for when gold fees are re-enabled. The `/api/prices` endpoint
> does not return `fee_fraction`, `gold_fee_actual`, or `gold_to_chaos_rate` while
> gold is disabled. **Important:** The `gold_enabled=true` code path in
> `routes_arbitrage.py` is a TODO stub — it does NOT actually compute gold fees
> but misleadingly tells users that fees are included. This section documents the
> game mechanics and the canonical formula for when gold fees are properly
> re-integrated.

### 3.1 Core Formula

The gold fee in PoE2's Currency Exchange is calculated as:

```
gold_fee = gold_cost_per_unit[currency_you_RECEIVE] × quantity_you_RECEIVE
```

**Key rules:**
1. Fee depends ONLY on what you RECEIVE (the "I want" / buy side), NOT what you give.
2. BOTH parties pay fees, each based on what THEY receive.
3. Fees are in gold coins (integer), paid by each party independently.
4. Fees are non-refundable. Canceling an order forfeits the gold.

### 3.2 Verified Per-Unit Gold Cost Table (PoE2, as of patch 0.3.0)

Source: [poe2wiki.net — Currency Exchange Market](https://www.poe2wiki.net/wiki/Currency_exchange_market) (last verified 2025-12-26)

```python
GOLD_COST_PER_UNIT = {
    # Basic currencies
    "scroll_of_wisdom": 1,
    "transmutation_shard": 4,
    "orb_of_transmutation": 50,
    "regal_shard": 12,
    "regal_orb": 120,
    "exalted_orb": 120,
    "chaos_orb": 160,
    "vaal_orb": 160,
    "orb_of_augmentation": 200,
    "orb_of_alchemy": 200,
    "lesser_jewellers_orb": 200,

    # Mid-tier currencies
    "greater_jewellers_orb": 600,
    "divine_orb": 800,
    "armourers_scrap": 250,
    "blacksmiths_whetstone": 500,
    "arcanists_etcher": 500,
    "glassblowers_bauble": 750,

    # High-tier currencies
    "orb_of_chance": 1000,
    "orb_of_annulment": 1000,
    "artificers_orb": 1000,
    "perfect_jewellers_orb": 1000,
    "gemcutters_prism": 1000,
    "mirror_of_kalandra": 25000,
}
```

**UNKNOWN items:** Omens, Soul Cores, Runes, Essences, Catalysts, Distilled Emotions, Expedition artifacts, Uncut Gems, and boss invitations have gold costs in the game's `.dat` files but their exact values have NOT been publicly documented. For these, use the configurable fallback (`config.fees.unknown_item_gold_cost`, default: 200) and log a warning.

**API ID mapping:** The keys in this table use a canonical snake_case form. The POE2Scout API uses `api_id` fields (e.g., "exalted", "divine", "chaos"). A mapping layer must exist between API IDs and this table. If an API ID is not found, try normalizing: lowercase, replace spaces/hyphens with underscores, remove apostrophes.

### 3.3 Fee Fraction for Arbitrage Calculations

To use gold fees in profit calculations, convert to a chaos-equivalent fraction of trade value:

```
gold_fee_total = gold_cost_per_unit[currency_received] × quantity_received

gold_fee_in_chaos = gold_fee_total × gold_to_chaos_rate

gold_fee_fraction = gold_fee_in_chaos / trade_value_in_chaos
```

Where:
- `gold_to_chaos_rate` = how many Chaos Orbs one gold coin is worth (observed from market data, or from config)
- `trade_value_in_chaos` = total value of the received items in Chaos Orbs

**CRITICAL: The fee fraction is direction-dependent and quantity-dependent.** Examples:

```
Trade: 1 Divine Orb → 220 Exalted Orbs
  Buyer receives 220 Exalted Orbs
  gold_fee = 120 × 220 = 26,400 gold
  If gold_to_chaos_rate = 0.001 (1 gold = 0.001 Chaos):
  gold_fee_in_chaos = 26,400 × 0.001 = 26.4 Chaos
  If 1 Exalted ≈ 0.5 Chaos:
  trade_value_in_chaos = 220 × 0.5 = 110 Chaos
  gold_fee_fraction = 26.4 / 110 = 0.24 (24% !)

Trade: 220 Exalted Orbs → 1 Divine Orb
  Buyer receives 1 Divine Orb
  gold_fee = 800 × 1 = 800 gold
  gold_fee_in_chaos = 800 × 0.001 = 0.8 Chaos
  If 1 Divine ≈ 110 Chaos:
  trade_value_in_chaos = 110 Chaos
  gold_fee_fraction = 0.8 / 110 = 0.0073 (0.73%)
```

**Same pair, opposite directions: 24% vs 0.73%. This asymmetry is the dominant factor in PoE2 arbitrage.**

### 3.4 Effective Exchange Rate (After Fee)

For a directed trade from currency A to currency B (you give A, receive B):

```
effective_rate(A→B) = raw_rate(A→B) × (1 - gold_fee_fraction(A→B))
```

Where:
- `raw_rate(A→B)` = how many units of B you get per 1 unit of A, as quoted by the exchange
- `gold_fee_fraction(A→B)` = fee fraction computed per §3.3 for receiving B

**Note:** `gold_fee_fraction(A→B) ≠ gold_fee_fraction(B→A)` in general.

### 3.5 Practical Significance of Gold Fees

Gold income from mapping: approximately 35,000-40,000 gold per juiced T16 map.

| Trade Type | Example | Gold Fee | Maps Needed to Recover |
|------------|---------|----------|----------------------|
| Buy 1 Divine | 220 Ex → 1 Div | 800 | ~0.02 maps |
| Buy 220 Exalted | 1 Div → 220 Ex | 26,400 | ~0.7 maps |
| Buy 1 Mirror | many Div → 1 Mirror | 25,000 | ~0.7 maps |
| Buy 1000 Orb of Chance | 50 Div → 1000 Chance | 1,000,000 | ~28 maps |

**Conclusion:** Gold fees are negligible for consolidation trades (many cheap → few expensive) but become significant for breakdown trades (few expensive → many cheap). The system MUST always display the gold fee alongside the profit figure so users can assess whether the trade is worth their gold budget.

### 3.6 Verification

From GGG forums (verified against multiple player reports):

```
Scenario: Convert 3 Divine Orbs to Exalted Orbs
  Rate: 1 Divine ≈ 220 Exalted
  You receive: 3 × 220 = 660 Exalted Orbs
  Gold fee: 660 × 120 = 79,200 gold
  Player report: "~80k gold"  ✓

Scenario: Convert 1 Divine Orb to Vaal Orbs
  Rate: 1 Divine ≈ 165 Vaal Orbs
  You receive: 165 Vaal Orbs
  Gold fee: 165 × 160 = 26,400 gold
  Player report: "~26,500 gold"  ✓
```

### Source

- PoE2 game mechanic: verified through [poe2wiki.net](https://www.poe2wiki.net/wiki/Currency_exchange_market), [Reddit](https://www.reddit.com/r/pathofexile/comments/1egqb30/), [GGG Forums](https://www.pathofexile.com/forum/view-thread/3542983), and [Maxroll](https://maxroll.gg/poe2/resources/flipping-with-the-currency-exchange).
- Per-unit gold costs extracted from game `.dat` files, published on the wiki.

---

## §4. Anomaly Detection Indicators

### 4.1 Z-Score with Bonferroni Correction

For currency `i` with price `P_i(t)`:

```
mean_i = mean of P_i over lookback window (default: 24 periods)
std_i  = std(P_i, ddof=1) over same window

z_score_i = (P_i(t) - mean_i) / std_i

bonferroni_alpha = 0.01 / N     # N = number of currencies being monitored
threshold = norm.ppf(1 - bonferroni_alpha / 2)   # two-tailed

triggered = (|z_score_i| > threshold)
```

**Typical threshold with N=30:** `bonferroni_alpha = 0.01/30 ≈ 0.000333`, `threshold ≈ 3.41`.

### 4.2 MACD (Moving Average Convergence Divergence)

```
EMA_fast  = exponential_moving_average(price_series, span=fast_period)    # default: 12
EMA_slow  = exponential_moving_average(price_series, span=slow_period)    # default: 26
MACD_line = EMA_fast - EMA_slow
Signal_line = exponential_moving_average(MACD_line, span=signal_period)   # default: 9

triggered = crossover(MACD_line, Signal_line)
```

Crossover: MACD_line crosses above Signal_line (bullish) or below (bearish) within the current period.

**EMA calculation:**
```
EMA[t] = alpha * price[t] + (1 - alpha) * EMA[t-1]
alpha = 2 / (span + 1)
```

**EMA initialization:** First value = first data point. NOT zero, NOT mean of series.

### 4.3 RSI (Relative Strength Index)

```
period = 14 (default)

gains = [max(0, price[i] - price[i-1]) for i in range(1, len(prices))]
losses = [max(0, price[i-1] - price[i]) for i in range(1, len(prices))]

avg_gain = mean(gains[-period:])
avg_loss = mean(losses[-period:])

if avg_loss == 0:
    RSI = 100
else:
    RS = avg_gain / avg_loss
    RSI = 100 - (100 / (1 + RS))

overbought = RSI > 70
oversold   = RSI < 30
triggered  = overbought or oversold
```

**Handle division by zero:** When `avg_loss == 0`, RSI = 100 (all periods were gains).

### 4.4 STL Residual Anomaly

```
from statsmodels.tsa.seasonal import STL

result = STL(price_series, period=seasonal_period).fit()
residuals = result.resid

MAD = median(|residuals - median(residuals)|)   # Median Absolute Deviation

triggered = (|residuals[-1]| > threshold_mad * MAD)   # default: threshold_mad = 2
```

**Note:** Use MAD instead of std because MAD is robust to outliers. This prevents a single extreme value from inflating the threshold and hiding itself.

### 4.5 Sustained Momentum Direction

```
m = config.momentum_sustained_periods   # default: 3

Check the last m values of log_returns:
all_positive = all(log_returns[-m:] > 0)
all_negative = all(log_returns[-m:] < 0)

triggered = all_positive or all_negative
direction = "up" if all_positive else "down" if all_negative else None
```

### 4.6 Ensemble Alert Scoring

```
Each triggered indicator contributes its weight to alert_score.
Default weights: all equal = 0.2

alert_score = sum(weight_i for i in triggered_indicators)

is_confirmed = (alert_score >= threshold)   # default: 0.4

direction is determined by majority vote of triggered indicators:
  - MACD crossover direction
  - RSI direction (overbought=up, oversold=down)
  - Z-score sign (positive=up, negative=down)
  - STL residual sign
  - Momentum direction
```

### Verification (Z-score)

N=30, `bonferroni_alpha = 0.01/30 = 0.000333`
`norm.ppf(1 - 0.000333/2) = norm.ppf(0.999833) ≈ 3.41`
So any z-score with `|z| > 3.41` triggers for N=30 currencies.

### Source

- Bonferroni correction: standard multiple testing correction (Bonferroni, 1936)
- MACD: Appel, "Technical Analysis: Power Tools for Active Investors"
- RSI: Wilder, "New Concepts in Technical Trading Systems" (1978)
- STL: Cleveland et al., "STL: A Seasonal-Trend Decomposition Procedure Based on Loess" (1990)
- MAD: standard robust statistics (Huber, "Robust Statistics", 1981)

---

## §5. Currency Clustering

### 5.1 Feature Computation

For each currency, compute three features over the last 24 hours:

```
volatility_24h = std(log_returns_24h, ddof=1)

price_change_rate_24h = (price_now - price_24h_ago) / price_24h_ago

liquidity_score_24h = log1p(volume_24h) / log1p(max_volume_across_all_currencies)
```

Where `log1p(x) = ln(1 + x)`. This handles zero volumes gracefully.

### 5.2 Normalization

Min-max scale each feature to [0, 1] across all currencies:

```
feature_normalized = (feature - feature_min) / (feature_max - feature_min)
```

If `feature_max == feature_min` (all currencies identical on this feature), set `feature_normalized = 0.5` for all.

### 5.3 KMeans

```python
from sklearn.cluster import KMeans

kmeans = KMeans(n_clusters=3, init='k-means++', n_init=10, random_state=42)
labels = kmeans.fit_predict(feature_matrix)  # shape: (N_currencies, 3)
```

### 5.4 Cluster Label Assignment

After fitting, inspect cluster centroids (shape: 3×3) and assign semantic labels:

```
For each cluster centroid:
  centroid = [volatility_norm, price_change_norm, liquidity_norm]

stable_cluster           = argmin(centroid[:, 0])  # lowest volatility
volatile_illiquid_cluster = argmax(centroid[:, 0])  # highest volatility
moderate_cluster          = remaining cluster
```

**If two clusters have nearly equal volatility centroids** (difference < 0.1 in normalized space), use liquidity as tiebreaker: the cluster with lower liquidity gets "volatile_illiquid".

### Verification

Given 5 currencies with features:
- A: vol=0.01, change=0.02, liq=0.9 → normalized ≈ [0.0, 0.5, 1.0] → "stable"
- B: vol=0.05, change=0.05, liq=0.7 → normalized ≈ [0.4, 0.6, 0.8] → "moderate"
- C: vol=0.10, change=-0.03, liq=0.3 → normalized ≈ [0.9, 0.3, 0.3] → "volatile_illiquid"

(Exact assignments depend on full dataset, but the principle holds.)

### Source

Standard unsupervised learning. KMeans: MacQueen, 1967. Min-max scaling: standard preprocessing.

---

## §6. Projected Value & Hold/Sell Decision

### 6.1 Price Projection

```
projected_price = current_price * exp(log_momentum * horizon_hours)
```

This assumes momentum continues at its current rate. `exp()` converts from log-space back to price-space.

### 6.2 Risk Discount

```
z = abs(norm.ppf(significance_level))    # e.g., 1.645 for significance_level=0.05

risk_discount = exp(-volatility * z * sqrt(horizon_hours))
```

**Where:**
- `significance_level` = 0.05 (alpha) means "5% chance the actual price is below projected × risk_discount" (one-sided VaR). The corresponding confidence level is 1 - alpha = 0.95 (95%).
- **Naming note:** This field was previously called `confidence_level` in `config.yaml` and `backend/config.py`. It has been renamed to `significance_level` to correctly reflect that the value 0.05 is alpha (significance), NOT the confidence level (which would be 0.95). See HIGH-7 in the implementation plan.
- `norm.ppf(0.05) ≈ -1.645`, so `abs(norm.ppf(0.05)) = 1.645`
- For volatility=0.02 and horizon=24h: `risk_discount = exp(-0.02 * 1.645 * sqrt(24)) ≈ 0.851`

This means: at 95% confidence, the price won't fall below 85.1% of the projected price due to volatility.

### 6.3 Liquidity Adjustment

```
liq_factor = min(liquidity_score / liquidity_normalization, 1.0)   # default normalization: 10.0

adjusted_price = projected_price * risk_discount * (0.9 + liq_factor * 0.1)
```

The `(0.9 + liq_factor * 0.1)` factor models that illiquid assets trade at a discount:
- Perfect liquidity (liq_factor=1.0): no discount → multiplier = 1.0
- Zero liquidity (liq_factor=0.0): 10% discount → multiplier = 0.9

The `liquidity_normalization` divisor (default 10.0) maps the liquidity_score to a 0-1 range. This is configurable in `config.yaml` under `storage_value.liquidity_normalization`.

### 6.4 After Fees

> **⚠️ DEPRECATED:** Gold fee deductions are no longer applied in the codebase.
> `net_value = adjusted_price` (no fee deduction). The `gold_fee_fraction`
> parameter has been removed from `project_value()`.

~~~
gold_fee_fraction_for_sell = compute_fee_fraction(currency, quantity, gold_to_chaos_rate, trade_value_chaos)
net_value = adjusted_price * (1 - gold_fee_fraction_for_sell)
~~~

**Current implementation:**
```
net_value = adjusted_price   # gold fees excluded
```

### 6.5 Decision Rule

```
ratio = net_value / current_price

if ratio > buy_threshold:       # default: 1.03 (3% expected profit)
    decision = "BUY/HOLD"
elif ratio < sell_threshold:    # default: 0.97 (3% expected loss)
    decision = "SELL/CONVERT"
else:
    decision = "NEUTRAL"
```

### 6.6 Full Function Pseudocode

```python
import numpy as np
from scipy.stats import norm

def project_value(current_price: float, log_momentum: float, volatility: float,
                  liquidity_score: float, horizon_hours: int,
                  significance_level: float,
                  liquidity_norm: float = 10.0,
                  buy_threshold: float = 1.03,
                  sell_threshold: float = 0.97) -> tuple[float, str]:
    # Step 1: Price projection
    projected = current_price * np.exp(log_momentum * horizon_hours)

    # Step 2: Risk discount (one-sided VaR-style)
    # significance_level (alpha) = 0.05 → 95% confidence
    z = abs(norm.ppf(significance_level))
    risk_discount = np.exp(-volatility * z * np.sqrt(horizon_hours))

    # Step 3: Liquidity adjustment
    liq_factor = min(liquidity_score / liquidity_norm, 1.0)
    adjusted = projected * risk_discount * (0.9 + liq_factor * 0.1)

    # Step 4: After fees (gold fees excluded — see §6.4 DEPRECATED note)
    net_value = adjusted   # gold_fee_fraction removed from codebase

    # Step 5: Decision
    ratio = net_value / current_price
    if ratio > buy_threshold:
        decision = "BUY/HOLD"
    elif ratio < sell_threshold:
        decision = "SELL/CONVERT"
    else:
        decision = "NEUTRAL"

    return net_value, decision
```

### Verification

```
current_price = 100
log_momentum = 0.001 (0.1% per hour)
volatility = 0.02
liquidity_score = 8.0
horizon_hours = 24
significance_level = 0.05    # alpha — confidence = 1 - 0.05 = 0.95

projected = 100 * exp(0.001 * 24) = 100 * exp(0.024) ≈ 102.43
z = abs(norm.ppf(0.05)) = 1.645
risk_discount = exp(-0.02 * 1.645 * sqrt(24)) = exp(-0.1612) ≈ 0.851
liq_factor = 8.0/10.0 = 0.8
adjusted = 102.43 * 0.851 * (0.9 + 0.8*0.1) = 102.43 * 0.851 * 0.98 ≈ 85.39
net_value = adjusted = 85.39    (gold fees excluded per §6.4)
ratio = 85.39 / 100 = 0.8539 < 0.97 → SELL/CONVERT
```

Note: With this volatility and horizon, the risk discount is severe, making the sell decision expected. Lower volatility or shorter horizon would change the outcome.

### Source

- Price projection via exponential of log-returns: standard finance (geometric Brownian motion assumption)
- Risk discount based on Value-at-Risk (VaR) concept: Jorion, "Value at Risk" (2001)
- `norm.ppf`: inverse CDF of standard normal distribution

---

## §7. Opportunity Scoring

### 7.1 Expected Profit (Raw Spread)

> **Design decision (Iteration 3):** Gold/commission fees have been intentionally excluded from the opportunity scorer to simplify the model and avoid the complexity of direction-dependent fee asymmetry (see §3.3 for the 24% vs 0.73% example). The raw spread is used instead of `spread_after_fees`. Gold fee information is still computed by the backend for display purposes but does NOT affect scoring.
>
> **Update (Iteration 4):** The `spread_after_fees` field has been renamed to `spread` in the API response (both fields are returned for backward compatibility). The `spread` value is the raw `(ask - bid) / mid_price` with no fees deducted.

```
spread = (ask - bid) / mid_price

if spread <= 0:
    score = 0.0    # no profit possible
```

### 7.1.1 Spread Estimation Model

> **Iteration 4 update:** The previous model used the forward/reverse rate gap from
> POE2Scout to estimate market spread. This was fundamentally broken because both
> rates are derived from the same `relative_price` data, making
> `1/reverse_rate === forward_rate` and thus `market_spread = 0` for all pairs.
> A 0.5% floor was a band-aid that produced unrealistically tight spreads.
>
> **New model:** Volume-based + volatility-based spread estimation that reflects
> real POE2 Currency Exchange market microstructure.

The POE2Scout API does not expose a real order book with bid/ask prices.
We estimate the bid-ask spread from available data:

```
# Step 1: Volume-based spread component
# Higher volume → tighter spread (more liquidity)
if volume_24h > 0:
    volume_spread = 0.05 / (1.0 + log1p(volume_24h) / 8.0)
else:
    volume_spread = 0.08  # 8% for zero-volume pairs

# Typical values:
#   volume=1000:  0.05 / (1 + 6.9/8) = 2.7%
#   volume=10000: 0.05 / (1 + 9.2/8) = 2.3%
#   volume=100:   0.05 / (1 + 4.6/8) = 3.2%

# Step 2: Volatility component
# Uncertain prices → wider spread
vol_spread = volatility * 0.5
# vol=0.01 → 0.5%, vol=0.05 → 2.5%, vol=0.10 → 5%

# Step 3: Base spread
market_spread = volume_spread + vol_spread
market_spread = max(0.01, min(0.15, market_spread))  # [1%, 15%]

# Step 4: Momentum amplification (capped at 50% wider)
momentum_24h_raw = |exp(momentum * 24) - 1|
momentum_factor = min(momentum_24h_raw, 0.5)
total_spread = market_spread * (1.0 + momentum_factor)
total_spread = min(total_spread, 0.20)  # hard cap at 20%

# Step 5: Derive bid/ask from mid_price and total_spread
bid = mid_price * (1 - total_spread / 2)
ask = mid_price * (1 + total_spread / 2)
```

**Rationale:** POE2 has no market makers. Spreads are set by the gap between
the best available buy and sell offers. Typical spreads are 2-5% for liquid
pairs (Divine/Exalted) and 5-15% for illiquid pairs. The old 0.5% floor was
far too tight, causing all scores to be near-zero and display as "0%".

### 7.2 Fill Probability

```
fill_probability = log1p(volume_24h) / log1p(max_volume_all_pairs)
fill_probability = min(fill_probability, 1.0)
```

### 7.3 Momentum Penalty (Filter, Not Additive)

```
if momentum < negative_threshold:       # default: -0.01
    momentum_penalty = 0.5
elif momentum < 0:
    momentum_penalty = 0.8
else:
    momentum_penalty = 1.0
```

This is a FILTER, not an additive component. It reduces the score when momentum is unfavorable but does not boost it when favorable.

### 7.4 Volatility Penalty

```
vol_penalty = 1.0 / (1.0 + (volatility / vol_reference)^2)
```

Where `vol_reference` = 0.05 by default (5% volatility as reference point). At `volatility = vol_reference`, penalty = 0.5.

### 7.5 Final Score

```
expected_profit = spread * fill_probability
score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
score = clamp(score, 0.0, 1.0)
```

### 7.6 Phase Multipliers

```
EARLY: 1.2
MID:   1.0
LATE:  0.9
```

### 7.7 Full Function Pseudocode

```python
import numpy as np

def compute_opportunity_score(bid: float, ask: float, mid_price: float,
                              volume_24h: float, max_volume: float,
                              volatility: float,
                              phase_multiplier: float, momentum: float,
                              momentum_neg_threshold: float = -0.01,
                              vol_reference: float = 0.05) -> float:
    # §7.1: Raw spread (gold fees excluded per project decision)
    if mid_price <= 0:
        return 0.0
    spread = (ask - bid) / mid_price
    if spread <= 0:
        return 0.0

    # §7.2: Fill probability
    fill_probability = np.log1p(volume_24h) / np.log1p(max_volume)
    fill_probability = min(fill_probability, 1.0)

    # §7.5: Expected profit
    expected_profit = spread * fill_probability

    # §7.3: Momentum penalty (filter-style)
    if momentum < momentum_neg_threshold:
        momentum_penalty = 0.5
    elif momentum < 0:
        momentum_penalty = 0.8
    else:
        momentum_penalty = 1.0

    # §7.4: Volatility penalty
    vol_penalty = 1.0 / (1.0 + (volatility / vol_reference) ** 2)

    # §7.5: Final score
    score = expected_profit * momentum_penalty * vol_penalty * phase_multiplier
    return min(max(score, 0.0), 1.0)
```

### Verification

```
bid = 95, ask = 105, mid_price = 100
volume_24h = 500, max_volume = 2000
volatility = 0.03
phase_multiplier = 1.0, momentum = 0.002

spread = (105-95)/100 = 0.10
fill_probability = log1p(500)/log1p(2000) = 6.216/7.601 ≈ 0.818
expected_profit = 0.10 * 0.818 = 0.0818
momentum_penalty = 1.0 (momentum > 0)
vol_penalty = 1/(1+(0.03/0.05)^2) = 1/(1+0.36) = 0.735
score = 0.0818 * 1.0 * 0.735 * 1.0 = 0.0601
```

### Source

Expected profit scoring is standard market-microstructure approach. The specific formula is adapted for PoE2's fee structure.

---

## §8. Triangular Arbitrage (Bellman-Ford)

> **⚠️ SIMPLIFIED IN CODEBASE:** The current implementation uses raw rates
> directly (no gold fee deduction on edges). The `gold_cost_per_unit` and
> `gold_to_chaos_rate` parameters have been removed from
> `find_triangular_arbitrage()`. The weight formula is simply
> `weight(u→v) = -ln(raw_rate(u→v))`. This section documents the original
> fee-aware formula for reference.

### 8.1 Graph Construction

- Nodes = currencies
- Directed edges = trade pairs with available rates
- Edge weight from node `u` to node `v`:

```
gold_fee_fraction(u→v) = (gold_cost_per_unit[v] × qty_v × gold_to_chaos_rate) / trade_value_chaos
effective_rate(u→v) = raw_rate(u→v) * (1 - gold_fee_fraction(u→v))
weight(u→v) = -ln(effective_rate(u→v))
```

**IMPORTANT:** 
- The negative sign and logarithm transform multiplication of rates into addition of weights. A negative-weight cycle in this graph corresponds to a profitable arbitrage cycle.
- The fee fraction is DIRECTION-DEPENDENT. `weight(A→B) ≠ weight(B→A)` even if `raw_rate(A→B) = 1/raw_rate(B→A)`, because the gold costs of A and B differ.
- To compute `qty_v` for the weight calculation: `qty_v = raw_rate(u→v) × qty_u`. Use `qty_u = 1` (unit trade) for the weight calculation. The actual profit scales linearly with trade size.

**Simplified weight for unit trade:**
```
qty_v = raw_rate(u→v)          # for 1 unit of u
trade_value_chaos = qty_v × price_v_in_chaos
gold_fee_gold = gold_cost_per_unit[v] × qty_v
gold_fee_chaos = gold_fee_gold × gold_to_chaos_rate
gold_fee_fraction = gold_fee_chaos / trade_value_chaos
effective_rate = raw_rate(u→v) × (1 - gold_fee_fraction)
weight = -ln(effective_rate)
```

### 8.2 Bellman-Ford Algorithm

```
Let V = number of currencies (nodes)
Let E = number of directed trade edges

Initialize:
  dist[source] = 0
  dist[v] = INF for all v ≠ source
  predecessor[v] = None for all v

Relax edges V-1 times:
  for i in 1 to V-1:
    for each edge (u, v) with weight w:
      if dist[u] + w < dist[v]:
        dist[v] = dist[u] + w
        predecessor[v] = u

Check for negative cycles:
  for each edge (u, v) with weight w:
    if dist[u] + w < dist[v]:
      → Negative cycle detected!

      # Extract the cycle
      # Start from v and walk back V steps via predecessor to ensure we're in the cycle
      node = v
      for _ in range(V):
        node = predecessor[node]
      cycle = []
      current = node
      while True:
        cycle.append(current)
        current = predecessor[current]
        if current == node:
          break
      cycle.append(node)  # close the cycle
      cycle.reverse()
```

### 8.3 Profit Calculation

After extracting a cycle `[A, B, C, ..., A]`:

```
cumulative_rate = 1.0
for each step (X → Y) in the cycle:
  cumulative_rate *= effective_rate(X → Y)    # uses direction-dependent fee

net_profit_pct = (cumulative_rate - 1.0) * 100
```

If `cumulative_rate > 1.0`, the cycle is profitable.

### 8.4 Validation (Anti-False-Positive)

After detecting a negative cycle, simulate the trade with raw (non-log) rates:

```
simulated_value = 1.0
for each step (X → Y) in the cycle:
  simulated_value *= effective_rate(X → Y)   # use exact rates, not log-approximations

if (simulated_value - 1.0) * 100 < 0.1%:
    discard this cycle   # numerical artifact
```

### 8.5 Multi-Source Detection

Run Bellman-Ford from every node as source. Deduplicate cycles (same cycle found from different sources). A cycle is identified by its sorted set of edges.

### 8.6 Full Function Pseudocode

```python
import numpy as np
from typing import Optional

def find_triangular_arbitrage(
    rates: dict[tuple[str, str], float],     # (from, to) -> raw_rate
    gold_cost_per_unit: dict[str, int],       # currency_api_id -> gold cost
    prices_in_chaos: dict[str, float],        # currency_api_id -> price in Chaos
    gold_to_chaos_rate: float,
    min_profit_pct: float = 0.1
) -> list[dict]:
    """
    rates: dict mapping (currency_from, currency_to) to the raw exchange rate
    gold_cost_per_unit: per-unit gold cost for each currency
    prices_in_chaos: current price of each currency in Chaos Orbs
    gold_to_chaos_rate: how many Chaos Orbs per 1 gold
    Returns list of arbitrage opportunities
    """
    # Build currency list
    currencies = set()
    for (u, v) in rates:
        currencies.add(u)
        currencies.add(v)
    currencies = sorted(currencies)
    n = len(currencies)
    curr_to_idx = {c: i for i, c in enumerate(currencies)}

    # Build edge list with weights (direction-dependent fees)
    edges = []
    for (u, v), raw_rate in rates.items():
        # Compute fee fraction for receiving currency v
        qty_v = raw_rate  # for 1 unit of u
        price_v = prices_in_chaos.get(v, 0)
        if price_v <= 0:
            continue
        trade_value = qty_v * price_v
        gold_fee = gold_cost_per_unit.get(v, 200) * qty_v
        fee_chaos = gold_fee * gold_to_chaos_rate
        fee_fraction = fee_chaos / trade_value if trade_value > 0 else 0

        eff_rate = raw_rate * (1 - fee_fraction)
        if eff_rate <= 0:
            continue
        weight = -np.log(eff_rate)
        edges.append((curr_to_idx[u], curr_to_idx[v], weight, eff_rate, fee_fraction))

    results = []
    seen_cycles = set()

    for source_idx in range(n):
        # Bellman-Ford
        INF = float('inf')
        dist = [INF] * n
        pred = [-1] * n
        dist[source_idx] = 0.0

        for _ in range(n - 1):
            updated = False
            for u, v, w, _, _ in edges:
                if dist[u] + w < dist[v]:
                    dist[v] = dist[u] + w
                    pred[v] = u
                    updated = True
            if not updated:
                break

        # Check for negative cycles
        for u, v, w, _, _ in edges:
            if dist[u] + w < dist[v]:
                # Extract cycle
                node = v
                for _ in range(n):
                    node = pred[node]

                cycle_idx = []
                current = node
                while True:
                    cycle_idx.append(current)
                    current = pred[current]
                    if current == node:
                        break
                cycle_idx.append(node)
                cycle_idx.reverse()

                # Convert to currency names
                cycle_names = [currencies[i] for i in cycle_idx]

                # Deduplicate
                cycle_key = tuple(sorted(set(cycle_names)))
                if cycle_key in seen_cycles:
                    continue
                seen_cycles.add(cycle_key)

                # Compute profit with raw rates and direction-dependent fees
                cum_rate = 1.0
                step_rates = []
                step_fees = []
                valid = True
                for i in range(len(cycle_names) - 1):
                    pair = (cycle_names[i], cycle_names[i + 1])
                    if pair not in rates:
                        valid = False
                        break
                    raw = rates[pair]
                    qty_v = raw
                    price_v = prices_in_chaos.get(cycle_names[i + 1], 0)
                    if price_v <= 0:
                        valid = False
                        break
                    trade_value = qty_v * price_v
                    gold_fee = gold_cost_per_unit.get(cycle_names[i + 1], 200) * qty_v
                    fee_chaos = gold_fee * gold_to_chaos_rate
                    fee_frac = fee_chaos / trade_value if trade_value > 0 else 0

                    eff = raw * (1 - fee_frac)
                    cum_rate *= eff
                    step_rates.append(raw)
                    step_fees.append(fee_frac)

                if not valid:
                    continue

                profit_pct = (cum_rate - 1.0) * 100

                if profit_pct >= min_profit_pct:
                    results.append({
                        "cycle": cycle_names,
                        "net_profit_pct": profit_pct,
                        "step_rates": step_rates,
                        "step_fees_fraction": step_fees,
                        "cumulative_rate": cum_rate,
                    })

    return results
```

### Verification

```
3 currencies: Chaos (C), Divine (D), Exalted (E)

Rates:
  C→D = 0.008  (1 Chaos gets you 0.008 Divine)
  D→E = 12     (1 Divine gets you 12 Exalted)
  E→C = 10.5   (1 Exalted gets you 10.5 Chaos)

Gold costs: C=160, D=800, E=120
Prices in Chaos: C=1, D=125, E=10.5
gold_to_chaos_rate = 0.001 (1 gold = 0.001 Chaos)

With gold_fee_fraction = 0 (for comparison):
  cumulative = 0.008 * 12 * 10.5 = 1.008
  profit = 0.8% → valid arbitrage

With direction-dependent fees:
  C→D: qty=0.008, trade_value=0.008×125=1.0, fee=800×0.008×0.001=0.0064, frac=0.0064/1.0=0.64%
    effective = 0.008 × (1-0.0064) = 0.007949
  D→E: qty=12, trade_value=12×10.5=126, fee=120×12×0.001=1.44, frac=1.44/126=1.14%
    effective = 12 × (1-0.0114) = 11.863
  E→C: qty=10.5, trade_value=10.5×1=10.5, fee=160×10.5×0.001=1.68, frac=1.68/10.5=16.0%
    effective = 10.5 × (1-0.16) = 8.82

  cumulative = 0.007949 × 11.863 × 8.82 = 0.8315
  profit = -16.85% → NOT profitable (fees eat the profit)
```

### Source

Bellman-Ford negative cycle detection for arbitrage is a well-known technique in computational finance. See: Ahuja, Magnanti, Orlin, "Network Flows" (1993). The log-weight transformation is standard.

---

## §9. Recipe Arbitrage

> **⚠️ SIMPLIFIED IN CODEBASE:** The current implementation excludes gold
> fees from recipe profit calculations. The `gold_to_chaos_rate` and
> `fallback_gold_cost` parameters have been removed from
> `compute_recipe_profit()`. The `gold_fee_total` field has been removed
> from `RecipeOpportunity`. This section documents the original fee-aware
> formula for reference.

### 9.1 Recipe Profit Calculation

For a vendor recipe with inputs `I_1, I_2, ..., I_k` and output `O`:

```
input_cost = sum(
    price(I_i) * quantity(I_i)    # raw cost in Chaos
    + gold_cost_per_unit[I_i] * quantity(I_i) * gold_to_chaos_rate   # fee for buying
    for i in 1..k
)

output_value = price(O) * quantity(O)    # raw value in Chaos
               - gold_cost_per_unit[O] * quantity(O) * gold_to_chaos_rate   # fee for selling

profit = output_value - input_cost
profit_pct = profit / input_cost * 100

if profit > 0:
    → Recipe is profitable
```

**Why fees on both sides:** Buying inputs requires paying gold fees (you receive the inputs). Selling the output also involves a gold fee (someone buys it from you, and in a competitive market the buyer's fee effectively reduces the price you can command).

### 9.2 Verification

```
Recipe: 3x Chaos Shard → 1x Chaos Orb
Chaos Shard price = 0.3 Chaos, gold_cost = unknown (use fallback 200)
Chaos Orb price = 1.0 Chaos, gold_cost = 160
gold_to_chaos_rate = 0.001

input_cost = 3 × (0.3 + 200 × 0.001) = 3 × (0.3 + 0.2) = 3 × 0.5 = 1.5
output_value = 1.0 - 160 × 0.001 = 1.0 - 0.16 = 0.84

profit = 0.84 - 1.5 = -0.66
→ NOT profitable (fees on Chaos Shards are too high relative to their value)
```

### Source

Pure arithmetic based on PoE2 vendor recipe mechanics and gold fee model from §3.

---

## §10. Portfolio Construction

### 10.1 Risk Parity

**Objective:** Each asset contributes equally to total portfolio risk.

```
risk_contribution_i = w_i * (Σ @ w)_i / sqrt(w^T @ Σ @ w)

For risk parity: risk_contribution_i = risk_contribution_j for all i, j
```

**Simplified implementation** (when assets are uncorrelated or correlations are low):

```
w_i = (1 / volatility_i) / sum(1 / volatility_j for j in all assets)
```

**Full implementation** (accounts for correlations):

```python
import numpy as np
from scipy.optimize import minimize

def risk_parity_weights(cov_matrix: np.ndarray) -> np.ndarray:
    """
    cov_matrix: N×N covariance matrix of log-returns
    Returns: N×1 weight vector
    """
    n = cov_matrix.shape[0]

    def risk_parity_objective(w):
        port_var = w @ cov_matrix @ w
        marginal_risk = cov_matrix @ w
        risk_contrib = w * marginal_risk
        # Target: all risk contributions equal = port_var / n
        target = port_var / n
        # Minimize sum of squared deviations from target
        return np.sum((risk_contrib - target) ** 2)

    # Initial guess: inverse volatility
    vols = np.sqrt(np.diag(cov_matrix))
    w0 = (1.0 / vols) / np.sum(1.0 / vols)

    # Constraints: weights sum to 1, all positive
    constraints = {'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0}
    bounds = [(0.01, 1.0)] * n  # minimum 1% per asset to avoid zero weights

    result = minimize(risk_parity_objective, w0, method='SLSQP',
                      bounds=bounds, constraints=constraints)

    return result.x
```

### 10.2 Minimum Variance Portfolio with Ledoit-Wolf Shrinkage

```python
from sklearn.covariance import LedoitWolf

def min_variance_weights(log_returns: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    log_returns: T×N matrix of log-returns (T periods, N assets)
    Returns: (weights, shrunk_cov_matrix)
    """
    # Ledoit-Wolf shrinkage for robust covariance estimation
    lw = LedoitWolf().fit(log_returns)
    cov_matrix = lw.covariance_

    n = cov_matrix.shape[0]

    def portfolio_variance(w):
        return w @ cov_matrix @ w

    w0 = np.ones(n) / n  # equal weight starting point

    constraints = {'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0}
    bounds = [(0.01, 1.0)] * n

    result = minimize(portfolio_variance, w0, method='SLSQP',
                      bounds=bounds, constraints=constraints)

    return result.x, cov_matrix
```

### 10.3 Correlation Shock Detection

```python
def detect_correlation_shock(current_corr: np.ndarray, previous_corr: np.ndarray,
                              threshold: float = 0.5) -> bool:
    """
    current_corr: N×N correlation matrix (current week)
    previous_corr: N×N correlation matrix (previous week)
    threshold: fractional increase that triggers warning (default: 50%)

    Returns: True if correlation shock detected
    """
    # Average off-diagonal correlation
    n = current_corr.shape[0]
    mask = ~np.eye(n, dtype=bool)  # exclude diagonal

    avg_current = np.mean(current_corr[mask])
    avg_previous = np.mean(previous_corr[mask])

    if avg_previous <= 0:
        return avg_current > 0.3  # arbitrary but reasonable

    increase = (avg_current - avg_previous) / abs(avg_previous)
    return increase > threshold
```

### 10.4 Annualized Portfolio Volatility

```
portfolio_vol_daily = sqrt(w^T @ Σ @ w)
portfolio_vol_annual = portfolio_vol_daily * sqrt(365)   # if daily returns
portfolio_vol_annual = portfolio_vol_daily * sqrt(365 * 24)  # if hourly returns
```

### 10.5 Verification (Risk Parity)

```
2 assets, volatilities: σ_A = 0.02, σ_B = 0.04, correlation = 0

Simple risk parity:
  w_A = (1/0.02) / (1/0.02 + 1/0.04) = 50 / (50 + 25) = 0.667
  w_B = (1/0.04) / (50 + 25) = 0.333

  risk_contrib_A = w_A^2 * σ_A^2 = 0.667^2 * 0.0004 = 0.000178
  risk_contrib_B = w_B^2 * σ_B^2 = 0.333^2 * 0.0016 = 0.000178

  Equal risk contributions ✓
```

### Source

- Risk Parity: Maillard, Roncalli, Teïletche, "The Properties of Equally Weighted Risk Contribution Portfolios" (2010)
- Ledoit-Wolf shrinkage: Ledoit, Wolf, "A well-conditioned estimator for large-dimensional covariance matrices" (2004)
- Minimum variance portfolio: standard Markowitz framework (without expected return estimation)

---

## §11. ADF Test for Stationarity

Used before fitting SARIMA.

```python
from statsmodels.tsa.stattools import adfuller

def check_stationarity(series, significance=0.05):
    """
    Returns: (is_stationary, p_value, recommended_d)
    """
    result = adfuller(series, autolag='AIC')
    p_value = result[1]

    if p_value <= significance:
        return True, p_value, 0
    else:
        # Difference once and test again
        diff1 = np.diff(series)
        result1 = adfuller(diff1, autolag='AIC')
        p1 = result1[1]
        if p1 <= significance:
            return False, p_value, 1
        else:
            # Difference twice
            diff2 = np.diff(diff1)
            result2 = adfuller(diff2, autolag='AIC')
            p2 = result2[1]
            if p2 <= significance:
                return False, p_value, 2
            else:
                # Warn: data may be unsuitable
                return False, p_value, 2  # still use d=2 as best effort
```

### Source

Dickey, Fuller, "Distribution of the Estimators for Autoregressive Time Series with a Unit Root" (1979). Standard procedure.

---

## §12. Liquidity Score

```
liquidity_score = volume_24h / price_volatility_24h
```

Where:
- `volume_24h` = total number of trades or total currency volume in 24 hours
- `price_volatility_24h` = std(log_returns) over 24 hours

**If `price_volatility_24h == 0`:** This means the price hasn't changed at all. Set `liquidity_score = volume_24h` (high liquidity with no volatility is actually the best case — stable and tradeable).

**Interpretation:** High volume with low volatility = high liquidity score. Low volume with high volatility = low liquidity score.

### Source

Standard market microstructure. Analogous to Amihud illiquidity ratio (inverted).

---

## §13. Gold-to-Chaos Rate Observation

The gold-to-chaos conversion rate is needed for all fee calculations. It must be observed from the market.

### 13.1 Observation Method

The gold-to-chaos rate is not directly quoted on the exchange. It must be inferred:

**Method 1: From known trades.** If a player observes the gold fee and the trade value for a specific trade:
```
gold_to_chaos_rate = (gold_fee_gold / trade_value_chaos) × (trade_value_chaos / gold_fee_chaos_equivalent)
```

But this is circular. In practice:

**Method 2: From game economy.** Gold drops from monsters at a known rate. The value of gold relative to Chaos is an emergent market property. The system should:

1. Maintain a `gold_chaos_rates` table in SQLite, updated whenever a user manually inputs a rate.
2. Provide a UI field: "Current gold-to-chaos rate: [input]" with a default estimate.
3. Optionally: scrape community sources (Reddit, forums) for reported rates — this is a low-priority enhancement.

### 13.2 Default and Bounds

- Default `gold_to_chaos_rate`: 0.001 (1 gold ≈ 0.001 Chaos, i.e., 1000 gold ≈ 1 Chaos)
- This is a VERY rough estimate. The actual rate varies by league phase and economy state.
- The system must warn if no rate has been observed in the last 24 hours.
- Bound: `gold_to_chaos_rate` must be > 0. If set to 0, fee calculations break.

### 13.3 Sensitivity Note

The `gold_to_chaos_rate` directly affects all fee fraction calculations. A 2x change in this rate doubles all fee fractions. The system should display a sensitivity analysis: "If gold rate changes by ±50%, your best flip's profit changes by ±X%."

---

## Appendix A: Common Pitfalls for LLM Agents

1. **Using `log` base 10 instead of natural log.** All formulas use `ln` (natural log, base e). In Python: `numpy.log()` or `math.log()`. NOT `math.log10()`.

2. **Forgetting `ddof=1` in std.** When computing sample standard deviation, always use `ddof=1`. `np.std(x, ddof=1)`. Default `np.std(x)` uses `ddof=0` which is the population formula.

3. **Computing spread before fees and calling it profit.** Every profit figure MUST subtract gold fees. No exceptions.

4. **Bellman-Ford edge direction.** The edge weight is `weight(u→v) = -ln(rate_u_to_v * (1-fee_fraction))`. The negative sign is critical. Without it, you're finding longest paths, not arbitrage.

5. **Assuming gold fee is a percentage.** IT IS NOT. PoE2 gold fee = `gold_cost_per_unit[currency] × quantity`. The fee fraction depends on the DIRECTION of trade and the QUANTITY received. `fee_fraction(A→B) ≠ fee_fraction(B→A)`.

6. **Covariance matrix without shrinkage.** When the number of observations is close to or less than the number of assets, the sample covariance matrix is ill-conditioned. Always use Ledoit-Wolf shrinkage.

7. **Rounding intermediate results.** Do not round intermediate calculations. Round only for display purposes.

8. **Using raw prices instead of log-prices for time series models.** SARIMA, Holt-Winters, and LightGBM features all operate on log-transformed prices. The inverse transform (`exp()`) is applied only at the final output step.

9. **EMA initialization.** The first EMA value should be set to the first data point (not zero, not the mean of the series). This is the standard convention.

10. **RSI division by zero.** When `avg_loss == 0`, RSI = 100 (all periods were gains). Handle this explicitly.

11. **Bonferroni correction uses the number of currencies, not the number of tests per currency.** N = number of currencies being monitored simultaneously. If you monitor 30 currencies, alpha = 0.01/30.

12. **Confusing PoE1 and PoE2.** PoE1 base currency = Chaos. PoE2 base currency = Exalted. PoE1 fee model ≠ PoE2 fee model. PoE1 leagues ≠ PoE2 leagues. Always verify against PoE2-specific sources.

13. **Ignoring fee asymmetry in triangular arbitrage.** The cycle A→B→C→A has a DIFFERENT total fee than A→C→B→A, even with the same currencies. You must compute fees per edge, not per currency.

14. **Using norm.ppf without abs().** In §6.2, `norm.ppf(0.05) ≈ -1.645` (negative). You MUST take `abs()` before using it in the risk discount formula. `risk_discount = exp(-volatility * abs(z) * sqrt(horizon))`.

---

## Appendix B: Gold Cost Table Update Procedure

The `GOLD_COST_PER_UNIT` table in §3.2 must be updated when:
1. A new PoE2 patch adds new currency items to the exchange.
2. A patch changes the gold cost of existing items (rare but possible).
3. Community datamining reveals costs for previously unknown items.

**Update source:** Check [poe2wiki.net/wiki/Currency_exchange_market](https://www.poe2wiki.net/wiki/Currency_exchange_market) after each patch.

**Validation:** After updating, run the verification in §3.6 against any newly reported player screenshots or forum posts.

**Code change:** Only `backend/economy/gold_cost_table.py` needs to be modified. No other files should reference specific gold cost values.

---

## §11. Cross-Currency Arbitrage & Optimal Payment Currency

> **WHY THIS SECTION EXISTS:** PoE2 items can be priced in multiple currencies
> (Exalted, Divine, Chaos, etc.) simultaneously on the Currency Exchange.
> Market inefficiency means `price_in_A / rate(A→anchor) ≠ price_in_B / rate(B→anchor)`
> — the same item has different "true cost" depending on which currency you pay with.
> This section formalizes the detection and exploitation of these discrepancies.

### 11.1 Anchor Currency Hierarchy

PoE2 has an implicit value hierarchy used for cross-currency comparison:

```
T0: Mirror of Kalandra  — "gold standard", highest-value currency
T1: Divine Orb          — "silver standard", used for mid/high-tier trades
T2: Exalted Orb         — "copper standard", base currency for most quotes
T3: Chaos Orb           — low-tier, rarely used as pricing anchor
```

**Rule:** When comparing prices across currencies, normalize everything to the
same anchor. The best anchors are Mirror of Kalandra or Divine Orb, because
they hold value most stably across the league lifecycle. Exalted Orb is the
POE2Scout base currency but fluctuates more relative to Mirror/Divine.

### 11.2 Effective Anchor Price

Given an item priced at `P_A` units of currency A, and the exchange rate
`rate(A→anchor)` = how many anchor units per 1 unit of A:

```
effective_anchor_price(A) = P_A * rate(A → anchor)
```

Where `rate(A → anchor) = relativePrice_A / relativePrice_anchor`.

**IMPORTANT:** `relativePrice` values come from POE2Scout and represent each
currency's price in the base currency (Exalted). To convert to any anchor:

```
rate(A → anchor) = relativePrice_A / relativePrice_anchor
```

This is the same cross-rate formula used throughout the codebase (see
`arbitrage-helpers.ts`).

### 11.3 Cross-Currency Premium

When an item is available in multiple payment currencies, the **cross-currency
premium** measures how much more expensive one option is relative to the other:

```
premium_pct = (effective_anchor_price(expensive) - effective_anchor_price(cheapest))
              / effective_anchor_price(cheapest) * 100
```

A positive premium means paying in the "expensive" currency costs more in
anchor terms. A premium > 2% is actionable: buy in the cheaper currency.

### 11.4 Optimal Payment Detection

For each item/currency-pair that is priced in multiple currencies:

```
best_currency = argmin(effective_anchor_price(C) for C in available_currencies)
savings_anchor = effective_anchor_price(worst) - effective_anchor_price(best)
savings_pct = savings_anchor / effective_anchor_price(worst) * 100
```

**Display:** Show a badge/tag on the exchange pair card indicating which
currency is cheapest and the savings percentage.

### 11.5 Cross-Rate Flip Detection

A **cross-rate flip** occurs when the market rate between two currencies
differs significantly from the "fair" rate implied by a common anchor:

```
fair_rate(A → B) = relativePrice_A / relativePrice_B   # via base currency
market_rate(A → B) = observed trading rate on exchange

deviation_pct = (market_rate - fair_rate) / fair_rate * 100

if |deviation_pct| > threshold:  # default: 5%
    → Cross-rate flip opportunity
    direction = "buy A with B" if deviation_pct < 0
              = "buy B with A" if deviation_pct > 0
```

**Practical example (from player data):**
- 1 Perfect Orb of Transmutation = 9.50 Exalted (relativePrice in base)
- 1 Great Orb of Enhancement = 1/9 Exalted ≈ 0.111 Exalted
- Player buys 25 Perfect Transmutation for 100 Great Enhancement
- Cost in Exalted: 100 × (1/9) = 11.11 Exalted
- Revenue in Exalted: 25 × 9.50 = 237.50 Exalted
- Profit: 237.50 − 11.11 = **226.39 Exalted** (~2,037%)

This works because the player's offered exchange rate (4 Great Enhancement per
1 Perfect Transmutation) is far from the market-implied fair rate:

```
fair_rate(GreatEnh → PerfTransm) = relativePrice_GE / relativePrice_PT
  = (1/9) / 9.50 = 0.01169 PerfTransm per GreatEnh

player_rate = 25/100 = 0.25 PerfTransm per GreatEnh

deviation = (0.25 - 0.01169) / 0.01169 = 2,037%
```

### 11.6 Multi-Currency Flip with Mixed Payment

A **mixed-currency flip** uses two or more currencies to purchase an item
that is cheaper when paid for in a specific combination:

```
Given:
  item_price_in_A = P_A  (e.g., 1 Orb of Cancellation = 30 Exalted)
  item_price_in_B = P_B  (e.g., 1 Orb of Cancellation = ? Great Transmutation)

fair_price_in_B = P_A * rate(Exalted → GreatTransm)
  = 30 * (1/5.5) = 5.45 Great Transmutation

If market price in B is higher than fair_price_in_B:
  → Buy with A (Exalted) is cheaper
If market price in B is lower:
  → Buy with B (Great Transmutation) is cheaper
```

**Player example:**
- Orb of Cancellation = 30 Exalted
- Player buys with Great Transmutation at rate 1:10
- Cost in Exalted: 10 × (1/5.5) = 1.82 Exalted per Cancellation Orb
- Savings per orb: 30 − 1.82 = 28.18 Exalted (~94% discount!)

### 11.7 Verification

```
Item: Omen of Refining (Предзнаменование оттачивания)
  Price in Exalted: 306
  Price in Divine: 3.75
  Rate Divine → Exalted: 85 (1 Divine = 85 Exalted)

  effective_anchor_price(Exalted) = 306 / 85 = 3.60 Divine-equivalent
  effective_anchor_price(Divine) = 3.75 Divine-equivalent

  premium_pct = (3.75 - 3.60) / 3.60 * 100 = 4.17%
  → Buying in Exalted saves 4.17% (= 0.15 Divine = 12.75 Exalted)

  Cross-check: 3.75 × 85 = 318.75 Exalted vs 306 Exalted
  Savings = 318.75 - 306 = 12.75 Exalted ✓
```

### 11.8 Observed Market Pattern: Divine Pricing Premium

Empirical observation from player data: items priced in Divine Orbs tend to cost
approximately 10% more than the same item priced in Exalted Orbs when converted
at the market Divine/Exalted rate. This is a **systematic market inefficiency**,
not a random fluctuation:

```
Item priced at 306 Exalted vs 3.75 Divine (rate: 1 Div = 85 Exa)
  3.75 × 85 = 318.75 Exalted → 4.17% premium for paying in Divine

This pattern repeats across many items, averaging ~10% premium.
```

**Possible causes:**
- Convenience premium: players with Divine Orbs are less price-sensitive
- Market segmentation: high-wealth traders don't bother optimizing currency choice
- Information asymmetry: most players don't compare cross-currency effective prices

**Dashboard implication:** The `BestPaymentBadge` and `CrossCurrencyPremiumCell`
components make this inefficiency visible, enabling informed currency choice.

### 11.9 Why This Is Hard for LLMs

1. **Rate direction confusion:** "1 to 9.50" can mean 1 item costs 9.50 or
   9.50 items cost 1. Always normalize to `rate(X→Y) = relativePrice_X / relativePrice_Y`.
2. **Anchor relativity:** Prices only make sense relative to an anchor. Raw
   numbers like "306" or "3.75" are meaningless without knowing 1 Divine = 85 Exalted.
3. **Market inefficiency assumption:** `price_in_A × rate(A→anchor) ≠ price_in_B × rate(B→anchor)`
   is the WHOLE POINT — if markets were efficient, there would be no flip opportunity.
4. **Multiple hops:** Converting from A→B→C→item may be cheaper than A→item directly.
   The optimizer must consider all paths, not just direct pairs.
5. **Liquidity vs profit:** A 2000% profit opportunity with zero liquidity is worthless.
   Always pair profit estimates with volume/liquidity data.

### Source

Cross-currency arbitrage is a well-known concept in foreign exchange markets
(covered interest parity violations). The PoE2-specific application derives from
the game's Currency Exchange mechanics where multiple pricing currencies coexist
and market makers (automatic order matching) don't enforce cross-rate consistency.
