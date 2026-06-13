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
    """Auto-generated fact about the league economy."""
    type: str = Field(description="Fact type: trend, anomaly, market")
    icon: str = Field(description="Fact icon: up, down, alert, chart, shield")
    text: str = Field(description="Human-readable fact text")
    severity: str = Field(description="Severity: info, warning")


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
# Scanner
# ---------------------------------------------------------------------------

class ScannerOpportunityData(BaseModel):
    """Single scanner result with detailed metrics."""
    currency: str = Field(description="Currency API identifier")
    score: float = Field(description="Composite flip score (0-1)")
    spread: float = Field(description="Raw spread percentage")
    spread_after_fees: float = Field(description="Spread after exchange fees")
    volume_24h: int = Field(description="24h traded volume")
    momentum: float = Field(description="Price momentum")
    volatility: float = Field(description="Price volatility")
    cluster: str = Field(description="Cluster label")
    bid: float = Field(description="Bid price")
    ask: float = Field(description="Ask price")
    mid_price: float = Field(description="Mid price")
    quantized_analysis: QuantizedAnalysisData | None = Field(default=None)
    tier_distance: int = Field(default=0)


class ScannerParams(BaseModel):
    """Parameters used for the scan."""
    min_score: float
    max_score: float
    min_volume: int
    max_spread: float
    min_spread: float
    cluster: str | None
    currency: str | None
    sort_by: str
    sort_dir: str
    limit: int


class ScannerResponse(BaseModel):
    """Response for GET /api/v1/scanner/scan."""
    league: str = Field(description="League name")
    total: int = Field(description="Total results after filtering")
    opportunities: list[ScannerOpportunityData] = Field(default_factory=list)
    scan_params: ScannerParams = Field(description="Parameters used for the scan")
    data_available: bool = Field(description="Whether data is available")
    fetched_at: str = Field(description="ISO 8601 timestamp of data fetch")


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
