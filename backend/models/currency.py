"""
Core domain models for the PoE2 Flipper system.

These models represent the internal data structures used across all modules.
They are independent of any external API response format (which lives in data/schemas.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
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
    volume: int = 0


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
# Gold Fee
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class GoldCostEntry:
    """Per-unit gold cost for a specific currency item in PoE2."""
    api_id: str
    gold_cost_per_unit: int
    source: str = "wiki_verified"  # "wiki_verified", "fallback", "user_override"


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

@dataclass
class FlipOpportunity:
    """A single flip opportunity after scoring."""
    currency: str
    score: float                 # 0.0 to 1.0
    spread_after_fees: float
    volume_24h: float
    momentum: float
    volatility: float
    cluster: ClusterLabel = ClusterLabel.MODERATE
    bid: float = 0.0
    ask: float = 0.0
    mid_price: float = 0.0


@dataclass
class TriangularOpportunity:
    """A detected triangular (or multi-hop) arbitrage cycle."""
    cycle: list[str]              # e.g. ["chaos", "divine", "exalted", "chaos"]
    net_profit_pct: float         # after all fees
    step_rates: list[float]       # raw rate at each step
    total_volume: float           # min volume across edges (bottleneck)
    confidence: float             # based on data freshness and volume


@dataclass
class RecipeOpportunity:
    """A profitable vendor recipe."""
    name: str
    inputs: list[dict]            # [{"item": str, "quantity": int}]
    output: dict                  # {"item": str, "quantity": int}
    input_cost_chaos: float
    output_value_chaos: float
    profit_chaos: float
    profit_pct: float
    gold_fee_total: float         # total gold fee for the recipe


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

@dataclass
class StorageValueResult:
    """Projected value and hold/sell decision for a currency."""
    currency: str
    current_price: float
    projected_price: float
    risk_discount: float
    adjusted_price: float
    net_value_after_fees: float
    ratio: float
    decision: Decision
