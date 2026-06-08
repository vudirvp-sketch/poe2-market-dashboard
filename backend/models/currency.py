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
# Recipe
# ---------------------------------------------------------------------------

@dataclass
class RecipeOpportunity:
    """A vendor recipe evaluated for profitability."""
    name: str
    inputs: list[dict]          # [{"item": str, "quantity": int}, ...]
    output: dict                # {"item": str, "quantity": int}
    input_cost_chaos: float     # sum of input prices × quantities (no gold fee)
    output_value_chaos: float   # output price × quantity (no gold fee)
    profit_chaos: float         # output_value - input_cost
    profit_pct: float           # profit / input_cost × 100


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
