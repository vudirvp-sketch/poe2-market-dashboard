"""
Core domain models for the PoE2 Flipper system.

These models represent the internal data structures used across all modules.
They are independent of any external API response format (which lives in data/schemas.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from fractions import Fraction
from typing import Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class LeaguePhase(str, Enum):
    """League lifecycle phase. PoE2-specific: phases affect strategy & fee sensitivity."""
    EARLY = "early"  # 0-7 days since league start or last major patch
    MID = "mid"      # 8-35 days
    LATE = "late"    # 36+ days


class EventType(str, Enum):
    """Manual event types that can affect market behaviour."""
    MAJOR_PATCH = "major_patch"
    MINOR_PATCH = "minor_patch"
    LEAGUE_START = "league_start"
    ECONOMY_SHIFT = "economy_shift"
    STREAMER_HYPE = "streamer_hype"
    OTHER = "other"


class LeagueType(str, Enum):
    """League type — affects phase multiplier for scoring.

    FIX: Added to distinguish standard, flashback, and event leagues.
    The Data Flow Reference (§5.2.4) describes PHASE_MULTIPLIERS for
    standard/flashback/event, but the old code only knew EARLY/MID/LATE.
    """
    STANDARD = "standard"
    FLASHBACK = "flashback"
    EVENT = "event"


class ClusterLabel(str, Enum):
    """Currency clustering labels assigned post-hoc by inspecting centroids."""
    STABLE = "stable"
    MODERATE = "moderate"
    VOLATILE_ILLIQUID = "volatile_illiquid"


class Decision(str, Enum):
    """Hold/sell decision from projected value analysis."""
    BUY_HOLD = "BUY/HOLD"
    SELL_CONVERT = "SELL/CONVERT"
    NEUTRAL = "NEUTRAL"


# ---------------------------------------------------------------------------
# Price & Market Data
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PricePoint:
    """A single price observation at a point in time."""
    timestamp: datetime
    price: float           # price in base currency (Exalted)
    volume: float = 0.0


@dataclass(frozen=True)
class PriceQuote:
    """Current best bid/ask for a currency pair."""
    pair: str              # e.g. "divine/exalted"
    bid: float             # best bid price
    ask: float             # best ask price
    mid_price: float       # (bid + ask) / 2
    volume_24h: float = 0.0
    timestamp: Optional[datetime] = None


@dataclass(frozen=True)
class ExchangeRate:
    """An exchange rate between two currencies with volume metadata."""
    currency_from: str     # api_id of source currency
    currency_to: str       # api_id of target currency
    raw_rate: float        # how many units of `to` per 1 unit of `from`
    volume_traded: int = 0
    stock_value: float = 0.0
    highest_stock: int = 0
    timestamp: Optional[datetime] = None


@dataclass(frozen=True)
class CurrencyInfo:
    """Static metadata about a currency item."""
    api_id: str
    text: str              # display name, e.g. "Divine Orb"
    category_api_id: str
    icon_url: Optional[str] = None
    item_id: int = 0
    currency_item_id: int = 0


# ---------------------------------------------------------------------------
# Economy
# ---------------------------------------------------------------------------

@dataclass
class MomentumResult:
    """Output of PriceMomentumTracker.compute()."""
    momentum: float = 0.0     # mean of log-returns over window
    volatility: float = 0.0   # std of log-returns (ddof=1)
    acceleration: float = 0.0 # change in momentum over last m periods


@dataclass
class PhaseInfo:
    """Current league phase with recommended strategy."""
    phase: LeaguePhase
    days_since_reference: int
    reference_currency: str    # "exalted" for EARLY, "divine" for MID/LATE
    recommended_strategy: str
    min_spread_after_fees: float
    max_hold_time: str


# ---------------------------------------------------------------------------
# Arbitrage
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class QuantizedSpreadResult:
    """Spread calculation accounting for integer rounding at a specific lot size."""
    lot_size: int                    # N — the lot size tested
    actual_cost: int                 # ceil(N * R_buy)  — integer B you pay
    actual_revenue: int              # floor(N * R_sell) — integer B you receive
    net_profit: int                  # actual_revenue - actual_cost
    gross_profit_pct: float          # net_profit / actual_cost * 100  (negative = loss)
    q_spread: float                  # (actual_revenue/N - actual_cost/N) / mid_price


@dataclass
class QuantizedAnalysis:
    """Complete quantized analysis for a currency pair."""
    q_spreads: dict[int, QuantizedSpreadResult]  # keyed by lot_size
    min_profitable_lot: int         # smallest N where profit > 0
    optimal_lot_profit_pct: float   # gross_profit_pct at min_profitable_lot
    recommended_ratio: tuple[int, int]  # (p, q) from Fraction.limit_denominator(1000)
    brick_resistance: float         # 1.0 / max(p, q)  — higher = more reliable
    theoretical_spread: float       # continuous spread (for reference only)


@dataclass
class FlipOpportunity:
    """A single flip opportunity after scoring."""
    currency: str
    score: float                 # 0.0 to 1.0
    spread: float               # raw (ask - bid) / mid_price — no fees deducted
    spread_after_fees: float    # DEPRECATED alias for spread (kept for backward compat)
    volume_24h: float
    momentum: float
    volatility: float
    cluster: ClusterLabel = ClusterLabel.MODERATE
    bid: float = 0.0
    ask: float = 0.0
    mid_price: float = 0.0
    # NEW quantized fields
    quantized_analysis: QuantizedAnalysis | None = None
    tier_distance: int = 0  # Will be populated after P1-3 is done
    # Absolute profit in base currency (exalted)
    profit_per_unit_base: float = 0.0  # profit per 1 unit of currency_from in base currency
    fair_rate: float = 0.0             # fair cross-rate based on prices_in_base
    deviation_pct: float = 0.0          # |market_rate - fair_rate| / fair_rate * 100
    price_from_in_base: float = 0.0     # price of currency_from in base currency
    price_to_in_base: float = 0.0       # price of currency_to in base currency
    # TD-9 (iter 127): up to 14 most-recent (timestamp, price) points for the
    # currency_from side, oldest-first. Used by the FlipsTable Trend sparkline
    # so it renders REAL price history instead of the synthetic
    # `deriveTrendSparklineData(momentum, volatility)` shape. Empty list when
    # no price history is available (the frontend falls back to the synthetic
    # shape — see flips-helpers.ts:getTrendSparklineData).
    price_history_short: list[dict] = field(default_factory=list)


@dataclass
class TriangularOpportunity:
    """A detected triangular (or multi-hop) arbitrage cycle."""
    cycle: list[str]              # e.g. ["chaos", "divine", "exalted", "chaos"]
    net_profit_pct: float         # after all fees
    step_rates: list[float]       # raw rate at each step
    total_volume: float           # min volume across edges (bottleneck)
    confidence: float             # based on data freshness and volume
    # NEW quantized fields
    min_starting_amount: int = 0                 # minimum starting capital for profit
    quantized_profit_pct: float = 0.0            # profit validated via integer simulation
    continuous_profit_pct: float = 0.0           # original float profit (for reference)
    integer_simulation: list[int] | None = None  # amounts at each step for min_start


# ---------------------------------------------------------------------------
# Anomaly
# ---------------------------------------------------------------------------

@dataclass
class AnomalyAlert:
    """Anomaly detection output per currency per timestamp."""
    currency: str
    timestamp: datetime
    alert_score: float                # 0.0 to 1.0
    triggered_indicators: list[str]   # which ones fired
    direction: str                    # "up" or "down"
    is_confirmed: bool                # alert_score >= threshold


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------

@dataclass
class PortfolioAllocation:
    """Portfolio allocation result."""
    weights: dict[str, float]       # currency -> weight (0 to 1)
    expected_risk: float            # portfolio volatility (annualized)
    method: str                     # "risk_parity" or "min_variance"
    correlation_warning: bool
    last_rebalance: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@dataclass
class MarketEvent:
    """A manually-flagged market event."""
    event_type: EventType
    description: str
    affected_currencies: list[str] = field(default_factory=list)
    timestamp: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    is_active: bool = True


# ---------------------------------------------------------------------------
# Forecast
# ---------------------------------------------------------------------------

@dataclass
class ForecastResult:
    """Price forecast from a single model."""
    currency: str
    model_name: str               # "sarima", "holt_winters", "lightgbm"
    point_forecast: list[float]   # predicted prices
    ci_lower: list[float]         # 95% CI lower bound
    ci_upper: list[float]         # 95% CI upper bound
    timestamps: list[datetime]
    low_confidence: bool = False  # True when event flag is active
    disagreement: bool = False    # True when models diverge >20%
    mape: Optional[float] = None  # recent MAPE for LightGBM


# ---------------------------------------------------------------------------
# Storage Value
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CurrencyTier:
    """Currency tier classification based on RelativePrice."""
    api_id: str
    tier: int               # 0-5
    tier_label: str         # "Ultra", "High", "Core", "Mid", "Low", "Micro"
    relative_price: float
    tier_anchor: str        # api_id of tier anchor


@dataclass
class StorageValueResult:
    """Projected value and hold/sell decision for a currency."""
    currency: str
    current_price: float
    projected_price: float
    risk_discount: float
    adjusted_price: float
    net_value: float         # Renamed from net_value_after_fees (gold fees disabled)
    ratio: float
    decision: Decision


# ---------------------------------------------------------------------------
# Liquid Chain
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LiquidChainStep:
    """One step in a vendor reforge conversion chain (e.g. 3 Diluted Liquid Ire → 1 Diluted Liquid Guilt).

    Fields:
        api_id: POE2Scout ApiId for the INPUT item of this step.
        name_en: English display name.
        name_ru: Russian display name.
        ratio: How many input items needed to produce 1 output (e.g. 3).
        price: Current price of the INPUT item in base currency (Exalted).
        input_cost: Total cost to buy `ratio` units of input item = ratio × price.
        output_value: Price of the OUTPUT item (next step's item) in base currency.
        profit: output_value − input_cost.
        profit_pct: profit / input_cost × 100.
    """
    api_id: str
    name_en: str
    name_ru: str
    ratio: int
    price: float
    input_cost: float
    output_value: float
    profit: float
    profit_pct: float


@dataclass(frozen=True)
class LiquidChainCumulativePath:
    """Cumulative profit/loss from reforging from step `from_index` to step `to_index`.

    Example: from_index=0, to_index=3 means starting with diluted-liquid-ire
    and reforging all the way to liquid-paranoia.

    Fields:
        from_index: Starting step index (0-based).
        to_index: Ending step index (0-based, inclusive).
        total_input_cost: Cost to buy enough of the starting item and reforge through.
        total_output_value: Value of the final output item in base currency.
        cumulative_ratio: Total multiplier from all reforge steps (ratio^(to_index-from_index)).
        profit: total_output_value − total_input_cost.
        profit_pct: profit / total_input_cost × 100.
    """
    from_index: int
    to_index: int
    total_input_cost: float
    total_output_value: float
    cumulative_ratio: int
    profit: float
    profit_pct: float


@dataclass
class LiquidChainResult:
    """Complete analysis result for a single liquid chain.

    Fields:
        chain_name: Identifier from config (e.g. "delirium_liquids").
        category: POE2Scout category for price fetching (e.g. "delirium").
        steps: Per-step analysis, one for each item in the chain.
        cumulative_paths: Profitable cumulative reforge paths (from position j to k).
        best_step: Index of the most profitable single step (or None if no data).
        worst_step: Index of the least profitable single step (or None if no data).
        data_available: Whether price data was available for all items.
        steps_with_data: Number of steps that had price data.
        total_steps: Total number of steps in the chain.
    """
    chain_name: str
    category: str
    steps: list[LiquidChainStep]
    cumulative_paths: list[LiquidChainCumulativePath]
    best_step: int | None
    worst_step: int | None
    data_available: bool
    steps_with_data: int
    total_steps: int
