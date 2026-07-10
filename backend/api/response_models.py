"""
Pydantic response models for all API endpoints (Phase 4.3).

These models serve two purposes:
1. Provide `response_model=` for FastAPI route decorators, enabling:
   - Automatic response validation (dev mode)
   - Complete OpenAPI schema generation
   - Automatic JSON serialization with correct types
2. Allow generation of TypeScript types from the OpenAPI schema
   via `openapi-typescript` or similar tools.

All models use snake_case field names. The flipper-proxy transformKeys()
converts snake_case to camelCase for the frontend.

NOTE: Models with Optional/None fields use `| None` syntax (Python 3.10+).
Models that can represent "no data available" states include a
`data_available: bool` field.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    """Response for GET /api/v1/health."""
    status: str = Field(description="Overall status: ok, degraded")
    snapshot_ready: bool = Field(description="Whether the data snapshot is populated")
    provider: str = Field(description="Upstream API status: reachable, unreachable")
    timestamp: str = Field(description="ISO 8601 timestamp of this check")
    league: str = Field(description="Configured league name")
    base_currency: str = Field(description="Configured base currency")
    active_events: int = Field(description="Number of active market events")
    cache_entries: int = Field(description="Number of pipeline cache entries")
    snapshot: dict[str, Any] = Field(default_factory=dict, description="Snapshot health info")
    daily_stats_cache: dict[str, Any] = Field(default_factory=dict, description="Daily stats cache info")


# ---------------------------------------------------------------------------
# Phase
# ---------------------------------------------------------------------------

class PhaseResponse(BaseModel):
    """Response for GET /api/v1/phase."""
    phase: str = Field(description="Current league phase: EARLY, MID, LATE, MATURE")
    days_since_reference: float = Field(description="Days since league start or major patch")
    reference_currency: str = Field(description="Reference currency for the phase")
    recommended_strategy: str = Field(description="Recommended trading strategy for this phase")
    min_spread_after_fees: float = Field(description="Minimum spread after fees for profitability")
    max_hold_time: str = Field(description="Maximum recommended hold time (human-readable, e.g. '2 hours')")


# ---------------------------------------------------------------------------
# Currencies
# ---------------------------------------------------------------------------

class CurrencyItem(BaseModel):
    """Single currency metadata item."""
    api_id: str = Field(description="Currency API identifier")
    text: str = Field(description="Human-readable currency name")
    category_api_id: str = Field(description="Parent category API identifier")
    icon_url: str | None = Field(default=None, description="Currency icon URL")


class CurrenciesResponse(BaseModel):
    """Response for GET /api/v1/currencies."""
    currencies: list[CurrencyItem] = Field(default_factory=list)
    stale: bool = Field(description="Whether data is from a stale snapshot")
    data_available: bool = Field(description="Whether any data is available")


# ---------------------------------------------------------------------------
# Prices
# ---------------------------------------------------------------------------

class PairData(BaseModel):
    """Single trading pair data with metrics."""
    pair: str = Field(description="Trading pair key, e.g. 'divine/exalted'")
    currency_from: str = Field(description="Source currency API ID")
    currency_to: str = Field(description="Target currency API ID")
    raw_rate: float = Field(description="Raw exchange rate")
    volume_traded: int = Field(description="24h traded volume")
    stock_value: float = Field(description="Stock/listed value")
    volatility: float = Field(description="Momentum-based volatility for currency_from")
    momentum: float = Field(description="Price momentum for currency_from")
    acceleration: float = Field(description="Price acceleration for currency_from")
    to_volatility: float = Field(description="Momentum-based volatility for currency_to")
    to_momentum: float = Field(description="Price momentum for currency_to")
    cluster_from: str = Field(description="Cluster label for currency_from")
    cluster_to: str = Field(description="Cluster label for currency_to")
    timestamp: str | None = Field(default=None, description="Rate timestamp (ISO 8601)")


class PricesResponse(BaseModel):
    """Response for GET /api/v1/prices."""
    league: str = Field(description="League name")
    phase: str = Field(description="Current league phase")
    rates: list[PairData] = Field(default_factory=list, description="All trading pair data")
    base_currency: str = Field(description="Base currency for rates")
    stale: bool = Field(description="Whether data is from a stale snapshot")
    data_available: bool = Field(description="Whether any data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


class HeatmapCurrencyData(BaseModel):
    """Heatmap data for a single currency."""
    api_id: str = Field(description="Currency API identifier")
    text: str = Field(description="Human-readable currency name")
    icon_url: str | None = Field(default=None, description="Currency icon URL")
    changes: list[float] = Field(default_factory=list, description="Percentage changes between consecutive price points")
    time_labels: list[str] = Field(default_factory=list, description="Time labels for each change point")


class HeatmapResponse(BaseModel):
    """Response for GET /api/v1/prices/heatmap."""
    currencies: list[HeatmapCurrencyData] = Field(default_factory=list)
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


class PriceForPairResponse(BaseModel):
    """Response for GET /api/v1/prices/{pair}."""
    pair: str = Field(description="Trading pair")
    bid: float = Field(description="Bid price")
    ask: float = Field(description="Ask price")
    mid_price: float = Field(description="Mid price")
    volume_24h: int = Field(description="24h volume")
    timestamp: str = Field(description="Price timestamp (ISO 8601)")
    stale: bool = Field(description="Whether data is from a stale snapshot")
    data_available: bool = Field(description="Whether data is available")


# ---------------------------------------------------------------------------
# Tiers
# ---------------------------------------------------------------------------

class TierItem(BaseModel):
    """Single currency tier classification."""
    api_id: str = Field(description="Currency API identifier")
    tier: int = Field(description="Tier number (0=highest value)")
    tier_label: str = Field(description="Human-readable tier label")
    relative_price: float = Field(description="Price relative to tier anchor")
    tier_anchor: str = Field(description="Anchor currency for this tier")


class TierBoundaries(BaseModel):
    """Tier boundary thresholds."""
    t0_min: float
    t1_min: float
    t2_min: float
    t3_min: float
    t4_min: float


class TiersResponse(BaseModel):
    """Response for GET /api/v1/tiers."""
    tiers: list[TierItem] = Field(default_factory=list)
    boundaries: TierBoundaries = Field(description="Tier boundary thresholds")
    data_available: bool = Field(description="Whether data is available")


# ---------------------------------------------------------------------------
# Benchmarks
# ---------------------------------------------------------------------------

class BenchmarkData(BaseModel):
    """Historical benchmark data for a currency."""
    low_30d: float = Field(description="30-day low price")
    high_30d: float = Field(description="30-day high price")
    range_position: float = Field(description="Current position in 30-day range (0-1)")
    percentile_30d: float = Field(description="30-day percentile (0-100)")
    current_vs_avg: float = Field(description="Current price vs 30-day average ratio")


class BenchmarksResponse(BaseModel):
    """Response for GET /api/v1/benchmarks/{currency}."""
    currency_api_id: str = Field(description="Currency API identifier")
    current_price: float = Field(description="Current price in base currency")
    benchmark: BenchmarkData | None = Field(default=None, description="Benchmark data (None if insufficient history)")
    days: int = Field(description="Lookback days used")
    data_available: bool = Field(description="Whether benchmark data is available")
    message: str | None = Field(default=None, description="Info message when data is unavailable")


# ---------------------------------------------------------------------------
# Arbitrage / Flips
# ---------------------------------------------------------------------------

class QuantizedSpreadData(BaseModel):
    """Quantized spread analysis for a specific lot size."""
    lot_size: int = Field(description="Lot size in units")
    actual_cost: float = Field(description="Actual cost for this lot")
    actual_revenue: float = Field(description="Actual revenue for this lot")
    net_profit: float = Field(description="Net profit after fees")
    gross_profit_pct: float = Field(description="Gross profit percentage")
    q_spread: float = Field(description="Quantized spread")


class QuantizedAnalysisData(BaseModel):
    """Full quantized analysis for a flip opportunity."""
    q_spreads: dict[str, QuantizedSpreadData] = Field(default_factory=dict)
    min_profitable_lot: int = Field(description="Minimum lot size for profitability")
    optimal_lot_profit_pct: float = Field(description="Profit % for optimal lot size")
    recommended_ratio: list[int] = Field(default_factory=list, description="Recommended buy/sell ratio")
    brick_resistance: float = Field(description="Brick resistance score")
    theoretical_spread: float = Field(description="Theoretical spread without quantization")


class FlipOpportunityData(BaseModel):
    """Single flip opportunity."""
    currency: str = Field(description="Currency API identifier / pair key")
    score: float = Field(description="Composite flip score (0-1)")
    spread: float = Field(description="Raw spread percentage")
    spread_after_fees: float = Field(description="Spread after exchange fees (DEPRECATED alias for spread)")
    volume_24h: int = Field(description="24h traded volume")
    momentum: float = Field(description="Price momentum")
    volatility: float = Field(description="Price volatility")
    cluster: str = Field(description="Cluster label: stable, moderate, volatile_illiquid")
    bid: float = Field(description="Bid price")
    ask: float = Field(description="Ask price")
    mid_price: float = Field(description="Mid price")
    quantized_analysis: QuantizedAnalysisData | None = Field(default=None)
    tier_distance: int = Field(default=0, description="Tier distance between pair")
    profit_per_unit_base: float = Field(default=0.0, description="Profit per 1 unit of currency_from in base currency")
    fair_rate: float = Field(default=0.0, description="Fair cross-rate based on prices_in_base")
    deviation_pct: float = Field(default=0.0, description="Deviation from fair rate %")
    price_from_in_base: float = Field(default=0.0, description="Price of currency_from in base currency")
    price_to_in_base: float = Field(default=0.0, description="Price of currency_to in base currency")


class FlipsResponse(BaseModel):
    """Response for GET /api/v1/arbitrage/flips."""
    league: str = Field(description="League name")
    opportunities: list[dict[str, Any]] = Field(default_factory=list, description="Flip opportunities (rich format with display names)")
    total: int = Field(description="Total number of flips found")
    event_status: dict[str, Any] = Field(default_factory=dict, description="Active event status")
    data_freshness: dict[str, Any] = Field(default_factory=dict, description="Data freshness metadata")
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")
    # P4-1 (iter 71): present when data_available=false (snapshot not yet
    # collected). Optional because the populated-state response omits it.
    message: str | None = Field(default=None, description="Human-readable note when data_available=false")


class TriangularPath(BaseModel):
    """Single triangular arbitrage path."""
    cycle: list[str] = Field(description="Ordered list of currency API IDs forming the cycle")
    net_profit_pct: float = Field(description="Net profit percentage after fees")
    step_rates: list[float] = Field(description="Exchange rates for each step")
    total_volume: float = Field(description="Minimum volume across all pairs (bottleneck)")
    confidence: float = Field(description="Confidence score based on data freshness and volume")
    min_starting_amount: int = Field(default=0, description="Minimum starting capital for profit")
    quantized_profit_pct: float = Field(default=0.0, description="Profit validated via integer simulation")
    continuous_profit_pct: float = Field(default=0.0, description="Original float profit (reference)")
    integer_simulation: list[int] | None = Field(default=None, description="Amounts at each step for min_start")


class TriangularResponse(BaseModel):
    """Response for GET /api/v1/arbitrage/triangular."""
    league: str = Field(description="League name")
    opportunities: list[dict[str, Any]] = Field(default_factory=list, description="Triangular arbitrage opportunities")
    total: int = Field(description="Total triangular cycles found")
    cross_rate_warning: dict[str, Any] | None = Field(default=None, description="Warning about suspicious cross-rate triples")
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


class OptimalPaymentOption(BaseModel):
    """Optimal payment option for a currency pair."""
    best_currency_id: str = Field(description="Cheapest payment currency API ID")
    best_currency_name: str = Field(default="", description="Cheapest payment currency display name")
    price_in_best_currency: float = Field(description="Price in the best payment currency")
    savings_pct_vs_base: float = Field(description="Savings % vs paying in base currency")
    relative_price: float = Field(description="Relative price of the best currency")


class CrossRateFlip(BaseModel):
    """Cross-rate flip opportunity."""
    pair: str = Field(description="Trading pair key")
    fair_rate: float = Field(description="Fair cross-rate implied by prices_in_base")
    market_rate: float = Field(description="Actual market rate")
    deviation_pct: float = Field(description="Deviation percentage from fair rate")
    direction: str = Field(description="Direction: overpriced or underpriced")
    estimated_profit_pct: float = Field(description="Estimated profit percentage")
    volume: int = Field(description="24h volume")


class OptimalCurrencyResponse(BaseModel):
    """Response for GET /api/v1/arbitrage/optimal-currency."""
    league: str = Field(description="League name")
    anchor_id: str = Field(description="Anchor currency used for price normalization")
    optimal_payment_by_pair: dict[str, Any] = Field(default_factory=dict, description="Optimal payment per pair key")
    cross_rate_flips: list[dict[str, Any]] = Field(default_factory=list, description="Cross-rate flip opportunities")
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

class EventData(BaseModel):
    """Single market event."""
    event_id: str = Field(description="Unique event identifier")
    event_type: str = Field(description="Event type: major_patch, minor_patch, league_start, economy_shift, streamer_hype, other")
    description: str = Field(description="Human-readable event description")
    affected_currencies: list[str] = Field(default_factory=list)
    timestamp: str = Field(description="Event timestamp (ISO 8601)")
    expires_at: str | None = Field(default=None, description="Expiry timestamp (ISO 8601)")
    is_active: bool = Field(description="Whether the event is still active")
    created_at: str | None = Field(default=None, description="Creation timestamp (ISO 8601)")


class EventCreateResponse(BaseModel):
    """Response for POST /api/v1/events."""
    message: str = Field(description="Success message")
    event: EventData = Field(description="Created event data")


class EventsListResponse(BaseModel):
    """Response for GET /api/v1/events."""
    total: int = Field(description="Total number of events")
    events: list[EventData] = Field(default_factory=list)
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


class EventSummaryResponse(BaseModel):
    """Response for GET /api/v1/events/summary."""
    any_event_active: bool = Field(description="Whether any event is currently active")
    event: dict[str, Any] | None = Field(default=None, description="Summary of highest-priority active event")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


class EventMessageResponse(BaseModel):
    """Generic event action response."""
    message: str = Field(description="Success message")


# ---------------------------------------------------------------------------
# Anomalies
# ---------------------------------------------------------------------------

class AnomalyAlertData(BaseModel):
    """Single anomaly alert."""
    currency: str = Field(description="Currency API identifier")
    alert_score: float = Field(description="Anomaly alert score (0-1)")
    triggered_indicators: list[str] = Field(description="List of triggered indicator names")
    direction: str = Field(description="Anomaly direction: spike_up, spike_down")
    is_confirmed: bool = Field(description="Whether the anomaly is confirmed by multiple indicators")
    timestamp: str = Field(description="Anomaly detection timestamp (ISO 8601)")


class AnomaliesResponse(BaseModel):
    """Response for GET /api/v1/anomalies."""
    anomalies: list[AnomalyAlertData] = Field(default_factory=list)
    count: int = Field(description="Number of anomalies found")
    currencies_checked: int = Field(description="Number of currencies checked")
    min_alert_score: float = Field(description="Minimum alert score filter applied")
    data_available: bool = Field(description="Whether data is available")


# ---------------------------------------------------------------------------
# Storage Value
# ---------------------------------------------------------------------------

class StorageValueInputs(BaseModel):
    """Inputs used for storage value computation."""
    momentum: float = Field(description="Price momentum")
    volatility: float = Field(description="Price volatility")
    acceleration: float = Field(description="Price acceleration")
    liquidity_score: float = Field(description="Liquidity score")
    horizon_hours: int = Field(description="Projection horizon in hours")
    significance_level: float = Field(description="Statistical significance level")


class StorageValueResponse(BaseModel):
    """Response for GET /api/v1/storage-value/{currency}."""
    currency: str = Field(description="Currency API identifier")
    quantity: float = Field(default=1.0, description="Number of units")
    current_price: float = Field(description="Current price in base currency")
    projected_price: float = Field(description="Projected price after horizon")
    risk_discount: float = Field(description="Risk discount factor (0-1)")
    adjusted_price: float = Field(description="Risk-adjusted projected price")
    net_value: float = Field(description="Net value (adjusted - current)")
    ratio: float = Field(description="Net value / current price ratio")
    decision: str = Field(description="Decision: BUY/HOLD, SELL/CONVERT, NEUTRAL")
    data_available: bool = Field(description="Whether data is available")
    total_current_value: float = Field(default=0.0, description="Total current value (quantity * current_price)")
    total_projected_value: float = Field(default=0.0, description="Total projected value")
    total_net_value: float = Field(default=0.0, description="Total net value")
    inputs: StorageValueInputs | dict = Field(default_factory=dict, description="Computation inputs")


# ---------------------------------------------------------------------------
# Storage Value History (F2 follow-up, iter 75)
# ---------------------------------------------------------------------------

class StorageValueHistoryPoint(BaseModel):
    """A single point in the storage-value history time-series."""
    timestamp: str = Field(description="ISO 8601 timestamp of the price observation")
    price: float = Field(description="Price of the currency at this timestamp (in base currency)")
    mirror_price: float | None = Field(default=None, description="Nearest mirror price within 24h tolerance. None if no mirror trade near this time.")
    hinekora_price: float | None = Field(default=None, description="Nearest Hinekora's Lock price within 24h tolerance. None if no hinekora trade near this time.")
    ratio_mirror: float | None = Field(default=None, description="price / mirror_price. None when mirror_price is None or zero.")
    ratio_hinekora: float | None = Field(default=None, description="price / hinekora_price. None when hinekora_price is None or zero.")


class StorageValueHistoryResponse(BaseModel):
    """Response for GET /api/v1/storage-value/{currency}/history."""
    currency: str = Field(description="Currency API identifier")
    mirror_currency: str = Field(description="Reference currency for store-of-value comparison (default: 'mirror')")
    hinekora_currency: str = Field(description="Second reference currency (default: 'hinekoras-lock')")
    points: list[StorageValueHistoryPoint] = Field(default_factory=list, description="Time-series of price + ratio_mirror + ratio_hinekora, sorted ascending by timestamp")
    data_available: bool = Field(description="Whether at least one point was returned")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


# ---------------------------------------------------------------------------
# Optimizer
# ---------------------------------------------------------------------------

class OptimizerPathResponse(BaseModel):
    """Response for GET /api/v1/optimizer/path."""
    from_currency: str = Field(description="Source currency API ID")
    to_currency: str = Field(description="Target currency API ID")
    amount: float = Field(description="Amount of source currency")
    path: list[str] = Field(default_factory=list, description="Optimal conversion path (currency API IDs)")
    step_rates: list[float] = Field(default_factory=list, description="Exchange rate for each step")
    effective_rate: float = Field(description="Effective rate along the path")
    output_amount: float = Field(description="Expected output amount")
    direct_rate: float | None = Field(default=None, description="Direct exchange rate (if available)")
    direct_output_amount: float | None = Field(default=None, description="Output amount via direct rate")
    path_advantage_pct: float | None = Field(default=None, description="Path advantage over direct rate (%)")
    hops: int = Field(description="Number of hops in the path")
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


class OptimizerMatrixResponse(BaseModel):
    """Response for GET /api/v1/optimizer/matrix."""
    currencies: list[str] = Field(default_factory=list, description="Currency API IDs (row/column labels)")
    matrix: list[list[float | None]] = Field(default_factory=list, description="N×N rate matrix")
    size: int = Field(description="Matrix dimension (number of currencies)")
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


# ---------------------------------------------------------------------------
# Analyst
# ---------------------------------------------------------------------------

class AnalystSummaryStats(BaseModel):
    """Summary statistics for the league."""
    total_currencies: int = Field(description="Total number of tracked currencies")
    total_pairs: int = Field(description="Total number of trading pairs")
    trending_up: int = Field(description="Currencies trending up (>2% change)")
    trending_down: int = Field(description="Currencies trending down (>2% change)")
    stable: int = Field(description="Currencies holding stable")
    anomaly_count: int = Field(description="Number of detected anomalies")


class TrendData(BaseModel):
    """Trend data for a single currency."""
    api_id: str = Field(description="Currency API identifier")
    current_price: float = Field(description="Current price")
    change_24h_pct: float | None = Field(default=None, description="24h price change percentage")
    direction: str = Field(description="Trend direction: up, down, stable, unknown")


class AnomalySimpleData(BaseModel):
    """Simple anomaly detection result."""
    api_id: str = Field(description="Currency API identifier")
    z_score: float = Field(description="Z-score of latest price change")
    direction: str = Field(description="Direction: spike_up, spike_down")
    current_price: float = Field(description="Current price")
    change_pct: float | None = Field(default=None, description="Percentage change")


class FactData(BaseModel):
    """Auto-generated fact about the league economy.

    iter 88: added optional `template_id` + `params` so the frontend can format
    the fact text via i18n keys (e.g. `t("analystFactBiggestGainer", {0: name, 1: pct})`).
    The English `text` field is still populated for backward compatibility —
    callers that don't recognize `template_id` fall back to `text`.
    """
    type: str = Field(description="Fact type: trend, anomaly, market")
    icon: str = Field(description="Fact icon: up, down, alert, chart, shield")
    text: str = Field(description="Human-readable fact text (English fallback)")
    severity: str = Field(description="Severity: info, warning")
    template_id: str | None = Field(default=None, description="iter 88: stable template identifier (e.g. 'biggest_gainer', 'biggest_loser', 'anomaly_activity', 'tracking', 'stable_count') — when present, frontend formats the fact via i18n key `analystFact<TemplateIdCamelCase>` with `params`.")
    params: dict[str, Any] = Field(default_factory=dict, description="iter 88: template parameters (apiId, pct, count, totalCurrencies, totalPairs, stableCount) consumed by the frontend i18n template.")


class AnalystSummaryResponse(BaseModel):
    """Response for GET /api/v1/analyst/summary."""
    league: str = Field(description="League name")
    summary: AnalystSummaryStats = Field(description="Summary statistics")
    trends: list[TrendData] = Field(default_factory=list, description="Top trends by volatility")
    anomalies: list[AnomalySimpleData] = Field(default_factory=list, description="Detected anomalies")
    facts: list[FactData] = Field(default_factory=list, description="Auto-generated facts")
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------

class CorrelationResponse(BaseModel):
    """Response for GET /api/v1/portfolio/correlation."""
    currencies: list[str] = Field(default_factory=list, description="Currency API IDs (row/column labels)")
    matrix: list[list[float | None]] = Field(default_factory=list, description="N×N Spearman correlation matrix")
    significant: list[list[bool]] = Field(default_factory=list, description="Significance matrix (p <= 0.05)")
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str | None = Field(default=None, description="ISO 8601 timestamp of data fetch")
    message: str | None = Field(default=None, description="Info message when data is unavailable")


# ---------------------------------------------------------------------------
# Liquid Chain
# ---------------------------------------------------------------------------

class LiquidChainStepData(BaseModel):
    """Single step in a liquid chain."""
    api_id: str = Field(description="Currency API identifier")
    name_en: str = Field(description="English name")
    name_ru: str | None = Field(default=None, description="Russian name")
    ratio: float = Field(description="Vendor reforge ratio")
    price: float = Field(description="Current price")
    input_cost: float = Field(description="Input cost for this step")
    output_value: float = Field(description="Output value for this step")
    profit: float = Field(description="Profit for this step")
    profit_pct: float = Field(description="Profit percentage for this step")


class LiquidChainCumulativePathData(BaseModel):
    """Cumulative path in a liquid chain."""
    from_index: int = Field(description="Start step index")
    to_index: int = Field(description="End step index")
    total_input_cost: float = Field(description="Total input cost")
    total_output_value: float = Field(description="Total output value")
    cumulative_ratio: float = Field(description="Cumulative ratio")
    profit: float = Field(description="Cumulative profit")
    profit_pct: float = Field(description="Cumulative profit percentage")


class LiquidChainData(BaseModel):
    """Full analysis for a single liquid chain."""
    chain_name: str = Field(description="Chain name")
    category: str = Field(description="Chain category")
    steps: list[LiquidChainStepData] = Field(default_factory=list)
    cumulative_paths: list[LiquidChainCumulativePathData] = Field(default_factory=list)
    best_step: int | None = Field(default=None, description="Index of best step")
    worst_step: int | None = Field(default=None, description="Index of worst step")
    data_available: bool = Field(description="Whether data is available")
    steps_with_data: int = Field(description="Number of steps with price data")
    total_steps: int = Field(description="Total number of steps in the chain")


class LiquidChainAnalysisResponse(BaseModel):
    """Response for GET /api/v1/liquid-chain/analysis."""
    chains: list[LiquidChainData] = Field(default_factory=list)
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")
    message: str | None = Field(default=None, description="Info message when data is unavailable")


class LiquidChainProfitableStepData(BaseModel):
    """Profitable step in a liquid chain."""
    api_id: str
    name_en: str
    name_ru: str | None = None
    ratio: float
    price: float
    input_cost: float
    output_value: float
    profit: float
    profit_pct: float


class LiquidChainProfitableChainData(BaseModel):
    """Chain with only profitable steps and paths."""
    chain_name: str
    category: str
    profitable_steps: list[LiquidChainProfitableStepData] = Field(default_factory=list)
    profitable_cumulative_paths: list[LiquidChainCumulativePathData] = Field(default_factory=list)
    best_step: int | None = None
    worst_step: int | None = None
    data_available: bool
    steps_with_data: int
    total_steps: int


class LiquidChainOpportunitiesResponse(BaseModel):
    """Response for GET /api/v1/liquid-chain/opportunities."""
    chains: list[LiquidChainProfitableChainData] = Field(default_factory=list)
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")
    message: str | None = Field(default=None, description="Info message when data is unavailable")


# ---------------------------------------------------------------------------
# Content Pulse (F3, iter 75)
# ---------------------------------------------------------------------------

class ContentPulseMoverData(BaseModel):
    """A single rising/falling item within a category."""
    api_id: str = Field(description="Item API identifier")
    text: str = Field(description="Display name (EN)")
    trend_pct: float = Field(description="Price % change over the available price_logs window")
    current_price: float = Field(description="Current price in base currency")


class ContentPulseCategoryData(BaseModel):
    """Per-category turnover snapshot + rolling deltas + top movers + overheat index."""
    category: str = Field(description="League mechanic category (e.g. 'ritual', 'breach')")
    today_volume: float = Field(description="Sum of 24h volume_traded across all items in the category (iter 95 TD-2 fix: was current_quantity)")
    rolling_7d: float = Field(description="Mean daily volume over the last 7 days")
    rolling_30d: float = Field(description="Mean daily volume over the last 30 days")
    delta_7d_pct: float | None = Field(default=None, description="(today / rolling_7d - 1) * 100. None when no historical data.")
    delta_30d_pct: float | None = Field(default=None, description="(today / rolling_30d - 1) * 100. None when no historical data.")
    signal: str = Field(description="Signal: 'rising' | 'falling' | 'stable' (based on delta_7d_pct ±10%)")
    item_count: int = Field(description="Number of items in this category")
    top_rising: list[ContentPulseMoverData] = Field(default_factory=list, description="Top-3 items with positive % price change")
    top_falling: list[ContentPulseMoverData] = Field(default_factory=list, description="Top-3 items with negative % price change")
    # iter 95 (Q13): Overheat Index — composite signal for the post-streamer
    # pattern (volume spike + price drop). All four fields are derived from
    # data the snapshot already collects; no new API calls.
    overheat_index: float = Field(default=0.0, description="0-100 composite score for the post-streamer pattern (volume spike + price drop). Higher = more overheated. 0 when insufficient data.")
    overheat_signal: str = Field(default="cool", description="Overheat classification: 'hot' (volume spiking AND prices dropping) | 'warm' (only one) | 'cool' (neither or insufficient data).")
    volume_spike_ratio: float | None = Field(default=None, description="today_volume / rolling_7d. None when rolling_7d is 0 or today_volume is 0.")
    price_change_pct: float | None = Field(default=None, description="Mean per-item % price change over price_logs. None when no items have ≥2 price points.")


class ContentPulseResponse(BaseModel):
    """Response for GET /api/v1/content-pulse."""
    league: str = Field(description="League name")
    categories: list[ContentPulseCategoryData] = Field(default_factory=list, description="Per-category pulse data, sorted by |delta_7d_pct| desc")
    data_available: bool = Field(description="Whether any category had items in the snapshot")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


# ---------------------------------------------------------------------------
# Speculation (F5, iter 77)
# ---------------------------------------------------------------------------

class SpeculationPriceHistoryPoint(BaseModel):
    """A single (date, price) point used for the mini-sparkline in the UI."""
    date: str = Field(description="ISO 8601 timestamp of the price observation")
    price: float = Field(description="Price in base currency at this timestamp")


class SpeculationSignalData(BaseModel):
    """A single BUY / SELL / HOLD signal for one currency."""
    api_id: str = Field(description="Item API identifier")
    text: str = Field(description="Display name (EN)")
    category: str = Field(description="League mechanic category (e.g. 'ritual', 'breach'). Empty if unknown.")
    current_price: float = Field(description="Current price in base currency")
    mean: float = Field(description="Mean of the historical prices in the lookback window")
    std: float = Field(description="Population std-dev of the historical prices in the lookback window")
    z_score: float = Field(description="Z-score of current_price relative to the historical distribution")
    percentile: float | None = Field(default=None, description="Percentile (0..100) of current_price within the historical range. None when not computable.")
    signal: str = Field(description="Signal: 'BUY' (z < -1.5) | 'SELL' (z > +1.5) | 'HOLD' (|z| <= 1.5)")
    horizon_hint: str = Field(description="Expected mean-reversion horizon code: 'short' (1-3d, |z|>=2.5) | 'medium' (3-7d, |z|>=1.5) | 'long' (>1w) | 'unknown'")
    sample_size: int = Field(description="Number of valid price points used to compute mean / std / z_score")
    price_history_short: list[SpeculationPriceHistoryPoint] = Field(
        default_factory=list,
        description="Up to 14 most-recent price points (oldest-first) for a mini-sparkline in the UI",
    )


class SpeculationResponse(BaseModel):
    """Response for GET /api/v1/speculation."""
    league: str = Field(description="League name")
    signals: list[SpeculationSignalData] = Field(default_factory=list, description="Per-item signals, sorted by |z_score| desc")
    data_available: bool = Field(description="Whether any item in the snapshot had enough price history to compute a signal")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")
    days: int = Field(description="Lookback window in days used for the z-score / percentile baseline")


# ---------------------------------------------------------------------------
# Circuit Patterns (F7 / P8, iter 97 — API + UI wire-up)
# Pure function: backend/economy/circuit_patterns.py (iter 96).
# ---------------------------------------------------------------------------

class CircuitPatternData(BaseModel):
    """A single currency's trajectory classification + recommended action."""
    api_id: str = Field(description="Item API identifier (e.g. 'chaos-orb', 'exalted')")
    text: str = Field(description="Display name (EN) — backend returns raw POE2Scout Text field")
    category: str = Field(description="League mechanic category slug (e.g. 'ritual', 'breach'). Empty if unknown.")
    trajectory: str = Field(description=(
        "Trajectory archetype: 'EXPONENTIAL_GROWTH' | 'LINEAR_GROWTH' | "
        "'PEAK_THEN_DECLINE' | 'MEAN_REVERTING' | 'VOLATILE' | 'DECLINING' | "
        "'STABLE'. See docs/MARKET_PLAYBOOK.md §P8 for the full rationale."
    ))
    total_change_pct: float = Field(description="% change from first to last price in the lookback window")
    recent_slope_pct_per_day: float = Field(description=(
        "Slope of the linear fit × 100, normalised by mean price — interpreted "
        "as percent-per-day change. Positive = rising, negative = falling."
    ))
    volatility_cv: float = Field(description="Coefficient of variation (std / mean) over the window")
    r_squared: float = Field(description="Goodness-of-fit of the linear regression (0..1). 0 = no linear trend.")
    days_since_peak: int | None = Field(default=None, description=(
        "For PEAK_THEN_DECLINE: days between the highest-price point and the "
        "last point. None for other archetypes. 0 means the peak IS the last point."
    ))
    recommended_action: str = Field(description=(
        "Actionable recommendation derived from the trajectory: "
        "'HOLD_FOR_GROWTH' (EXPONENTIAL_GROWTH / LINEAR_GROWTH) | "
        "'SELL_NOW' (PEAK_THEN_DECLINE) | "
        "'AVOID' (DECLINING) | "
        "'WATCH' (VOLATILE) | "
        "'NEUTRAL' (MEAN_REVERTING / STABLE)."
    ))
    sample_size: int = Field(description="Number of valid price points in the lookback window used for classification")
    current_price: float = Field(description="Most recent price in base currency")
    price_history_short: list[SpeculationPriceHistoryPoint] = Field(
        default_factory=list,
        description=(
            "Up to 14 most-recent price points (oldest-first) for the UI "
            "mini-sparkline. Empty when fewer than 2 points are in the window."
        ),
    )


class CircuitPatternsResponse(BaseModel):
    """Response for GET /api/v1/circuit-patterns."""
    league: str = Field(description="League name")
    patterns: list[CircuitPatternData] = Field(default_factory=list, description=(
        "Per-currency trajectory classifications, sorted by |total_change_pct| "
        "descending (most action first). Capped by `limit`."
    ))
    data_available: bool = Field(description="Whether any currency in the snapshot had enough price_logs (≥ MIN_SAMPLE_SIZE) to classify")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")
    days: int = Field(description="Lookback window in days used for the classification")


# ---------------------------------------------------------------------------
# Speculation backtest (F5 follow-up, iter 79)
# ---------------------------------------------------------------------------

class SpeculationBacktestTradeData(BaseModel):
    """A single realised trade from the backtest."""
    api_id: str = Field(description="Item API identifier")
    text: str = Field(description="Display name (EN)")
    category: str = Field(description="League mechanic category (e.g. 'ritual', 'breach'). Empty if unknown.")
    signal: str = Field(description="Signal at entry: 'BUY' (z<-1.5) | 'SELL' (z>+1.5). HOLD signals never produce trades.")
    entry_price: float = Field(description="Price at entry (nearest price log to t_eval within 24h tolerance)")
    entry_date: str = Field(description="ISO 8601 timestamp of the entry price log")
    exit_price: float = Field(description="Price at exit (nearest price log to t_eval+holding_days within 24h tolerance)")
    exit_date: str = Field(description="ISO 8601 timestamp of the exit price log")
    return_pct: float = Field(description="Realised return in %. BUY: (exit-entry)/entry*100. SELL: (entry-exit)/entry*100. Positive = profit.")
    z_score_at_entry: float | None = Field(default=None, description="Z-score of entry_price vs the lookback window. None when std=0.")
    sample_size_at_entry: int = Field(description="Number of price points in the lookback window used to compute the z-score")


class SpeculationBacktestStatsBlock(BaseModel):
    """Aggregate stats for a single signal type (BUY / SELL / overall)."""
    count: int = Field(description="Number of trades in this block")
    win_rate: float = Field(description="Win rate in % (returns > 0). 0.0 when count=0.")
    mean_return_pct: float = Field(description="Mean return_pct. 0.0 when count=0.")
    median_return_pct: float = Field(description="Median return_pct. 0.0 when count=0.")
    best_return_pct: float = Field(description="Max return_pct observed. 0.0 when count=0.")
    worst_return_pct: float = Field(description="Min return_pct observed. 0.0 when count=0.")


class SpeculationBacktestResponse(BaseModel):
    """Response for GET /api/v1/speculation/backtest."""
    league: str = Field(description="League name")
    trades: list[SpeculationBacktestTradeData] = Field(default_factory=list, description="Per-item realised trades, sorted by |return_pct| desc. Capped by `limit`.")
    signal_breakdown: dict[str, int] = Field(description="Counts per signal type: {'BUY': N, 'SELL': N, 'HOLD': N}. HOLD signals did not produce trades.")
    evaluated_count: int = Field(description="Items with both entry+exit prices AND an actionable signal (BUY or SELL)")
    unevaluated_count: int = Field(description="Items with an actionable signal but no exit price within tolerance (holding period extends past last price log)")
    buy_stats: SpeculationBacktestStatsBlock = Field(description="Aggregate stats for BUY trades only")
    sell_stats: SpeculationBacktestStatsBlock = Field(description="Aggregate stats for SELL trades only")
    overall_stats: SpeculationBacktestStatsBlock = Field(description="Aggregate stats across all BUY+SELL trades")
    data_available: bool = Field(description="Whether any item in the snapshot had price_logs to backtest against")
    fetched_at: str = Field(description="ISO 8601 timestamp of backtest run")
    eval_days_ago: int = Field(description="Days before `now` at which the signal was evaluated (entry timestamp = now - eval_days_ago)")
    holding_days: int = Field(description="Holding period in days (exit timestamp = entry + holding_days)")
    lookback_days: int = Field(description="Z-score baseline window in days (window = [entry-lookback_days, entry))")


# ---------------------------------------------------------------------------
# Phase-aware Hints (F6, iter 78)
# ---------------------------------------------------------------------------

class PhaseHintData(BaseModel):
    """A single phase-aware hint — advisory context, not a trade signal."""
    id: str = Field(description="Stable slug (e.g. 'mid-skill-gems-18-20') — for tests and future metric linkage")
    title: str = Field(description="Short label for the hint")
    detail: str = Field(description="One-sentence explanation of the pattern")
    action: str = Field(description="What the user should do (imperative)")
    category: str = Field(default="", description="Optional POE2Scout category slug for future cross-reference. Empty string if none.")


class PhaseHintsResponse(BaseModel):
    """Response for GET /api/v1/phase-hints."""
    league: str = Field(description="League name")
    phase: str = Field(description="Current league phase: 'early' | 'mid' | 'late'")
    phase_label: str = Field(description="Human-readable phase label, e.g. 'Early League'")
    days_since_reference: int = Field(description="Days since league start or last major patch")
    reference_currency: str = Field(description="Reference currency for the phase (e.g. 'exalted' for EARLY, 'divine' for MID/LATE). Empty if unknown.")
    phase_summary: str = Field(description="1-2 sentence overview of the current phase")
    hints: list[PhaseHintData] = Field(default_factory=list, description="Phase-relevant advisory hints (hardcoded table, no live metrics)")
    data_available: bool = Field(description="Always True — the hint table is hardcoded and always available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")
