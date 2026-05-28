"""
PoE2 Flipper — Streamlit Dashboard (Milestone 4: Basic Dashboard)

This is the main entry point for the frontend. Run with:
    streamlit run frontend/app.py

Tabs:
    - Overview: heatmap + scatter + phase badge + top-5 flips
    - Flips: sortable/filterable flip opportunities table with detail panel

The app communicates with the FastAPI backend (backend/main.py) for live data.
If the backend is unavailable, it shows an error message with retry instructions.
"""

from __future__ import annotations

import sys
import os
import logging
from pathlib import Path
from datetime import datetime, timezone

import httpx
import streamlit as st

# Ensure the project root is on sys.path so `backend.*` imports work
# when running from the project root directory
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from frontend.components.sticky_bar import render_sticky_bar
from frontend.components.overview_tab import render_overview_tab
from frontend.components.flips_tab import render_flips_tab
from frontend.components.graph_tab import render_graph_tab
from frontend.components.forecast_tab import render_forecast_tab
from frontend.utils.formatters import fmt_number

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Page Configuration
# ---------------------------------------------------------------------------

st.set_page_config(
    page_title="PoE2 Flipper",
    page_icon="💰",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Dark theme styling
st.markdown(
    """
    <style>
    /* Main background */
    .stApp { background-color: #0f172a; color: #e2e8f0; }

    /* Sidebar */
    [data-testid="stSidebar"] { background-color: #1e293b; }

    /* Cards and containers */
    .stMarkdown, .stContainer { color: #e2e8f0; }

    /* Dataframe */
    .stDataFrame { background-color: #1e293b; }

    /* Metric */
    [data-testid="stMetricValue"] { color: #e2e8f0; }
    [data-testid="stMetricLabel"] { color: #94a3b8; }

    /* Expander */
    .streamlit-expanderHeader { background-color: #1e293b; color: #e2e8f0; }

    /* Selectbox / Input */
    .stSelectbox label, .stNumberInput label, .stSlider label {
        color: #94a3b8;
    }

    /* Tabs */
    .stTabs [data-baseweb="tab-list"] { gap: 2px; }
    .stTabs [data-baseweb="tab"] {
        background-color: #1e293b;
        color: #94a3b8;
        border-radius: 4px 4px 0 0;
        padding: 8px 16px;
    }
    .stTabs [aria-selected="true"] {
        background-color: #334155;
        color: #f8fafc;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# ---------------------------------------------------------------------------
# Backend API Configuration
# ---------------------------------------------------------------------------

API_BASE_URL = os.environ.get("POE2_FLIPPER_API_URL", "http://localhost:8000")


# ---------------------------------------------------------------------------
# API Client
# ---------------------------------------------------------------------------

@st.cache_data(ttl=60, show_spinner=False)
def fetch_api(endpoint: str, params: dict | None = None, _ttl_key: str = "") -> dict | None:
    """Fetch data from the FastAPI backend.

    Uses Streamlit's cache with a 60-second TTL. The _ttl_key parameter
    allows forced refresh by changing the key.
    """
    url = f"{API_BASE_URL}{endpoint}"
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        logger.warning("Cannot connect to backend at %s", API_BASE_URL)
        return None
    except httpx.HTTPStatusError as e:
        logger.error("HTTP error from %s: %d", url, e.response.status_code)
        return None
    except httpx.TimeoutException:
        logger.error("Timeout fetching from %s", url)
        return None
    except Exception as e:
        logger.error("Error fetching from %s: %s", url, e)
        return None


# ---------------------------------------------------------------------------
# Direct Backend Import Fallback
# ---------------------------------------------------------------------------

def _load_data_directly() -> dict:
    """Load data by importing backend modules directly.

    This is a fallback for when the FastAPI backend is not running.
    It uses asyncio to run the async provider methods synchronously.
    """
    import asyncio
    from backend.config import get_settings
    from backend.data.providers.poe2scout import Poe2ScoutProvider
    from backend.data.cache import get_cache
    from backend.economy.lifecycle import PhaseDetector
    from backend.economy.momentum import PriceMomentumTracker
    from backend.economy.gold_costs import compute_gold_fee_fraction, compute_gold_fee
    from backend.economy.gold_cost_table import get_gold_cost_per_unit, get_api_id_to_gold_cost
    from backend.arbitrage.scorer import compute_opportunity_score, get_phase_multiplier
    from backend.arbitrage.quick_filter import quick_filter
    from backend.arbitrage.triangular import find_triangular_arbitrage
    from backend.predictors.clustering import CurrencyClusterer
    from backend.models.currency import FlipOpportunity, ClusterLabel

    config = get_settings()
    provider = Poe2ScoutProvider(config)
    cache = get_cache(config)
    detector = PhaseDetector(config.league.league_start_datetime, config)

    async def _fetch():
        # Get exchange rates
        rates_result = await cache.get_or_fetch(
            "prices", provider.name(), "get_exchange_rates",
            provider.get_exchange_rates, config.league.league_name,
        )
        rates = rates_result.value if rates_result.value else {}

        # Get phase info
        phase_info = detector.get_phase_info()

        # Get metadata
        metadata_result = await cache.get_or_fetch(
            "metadata", provider.name(), "get_currency_metadata",
            provider.get_currency_metadata, config.league.league_name,
        )
        currencies = metadata_result.value if metadata_result.value else []

        # Gold rate
        gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
        if config.fees.gold_to_chaos_rate_source == "market":
            observed = await provider.get_gold_chaos_rate(config.league.league_name)
            if observed is not None:
                gold_to_chaos_rate = observed

        return rates, phase_info, currencies, gold_to_chaos_rate

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Streamlit is already running an event loop; create a new one
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(
                    asyncio.run, _fetch()
                )
                rates, phase_info, currencies, gold_to_chaos_rate = future.result(timeout=30)
        else:
            rates, phase_info, currencies, gold_to_chaos_rate = loop.run_until_complete(_fetch())
    except Exception as e:
        logger.error("Direct data loading failed: %s", e)
        return {
            "error": str(e),
            "phase_info": None,
            "rates": [],
            "opportunities": [],
            "triangular": [],
            "gold_to_chaos_rate": None,
        }

    # Build phase info dict
    phase_dict = {
        "phase": phase_info.phase.value,
        "days_since_reference": phase_info.days_since_reference,
        "reference_currency": phase_info.reference_currency,
        "recommended_strategy": phase_info.recommended_strategy,
        "min_spread_after_fees": phase_info.min_spread_after_fees,
        "max_hold_time": phase_info.max_hold_time,
    }

    # Build rates list
    rates_list = []
    for key, rate in rates.items():
        rates_list.append({
            "pair": key,
            "currency_from": rate.currency_from,
            "currency_to": rate.currency_to,
            "raw_rate": rate.raw_rate,
            "volume_traded": rate.volume_traded,
            "stock_value": rate.stock_value,
            "fee_fraction": 0,
            "gold_fee_actual": 0,
        })

    # Build flip opportunities
    phase_multiplier = get_phase_multiplier(phase_info.phase, config)
    max_volume = max((r.volume_traded for r in rates.values() if r.volume_traded > 0), default=1)

    # Prices in chaos (simplified)
    prices_in_chaos = {config.league.base_currency: 1.0}
    for key, rate in rates.items():
        if rate.currency_from == config.league.base_currency:
            prices_in_chaos[rate.currency_to] = rate.raw_rate
        elif rate.currency_to == config.league.base_currency and rate.raw_rate > 0:
            prices_in_chaos[rate.currency_from] = 1.0 / rate.raw_rate

    # Run currency clustering (Milestone 6)
    cluster_labels: dict[str, ClusterLabel] = {}
    try:
        cluster_price_histories: dict[str, list[float]] = {}
        cluster_volumes: dict[str, float] = {}
        cluster_prices_now: dict[str, float] = {}
        cluster_prices_24h_ago: dict[str, float] = {}

        for key, rate in rates.items():
            for curr in (rate.currency_from, rate.currency_to):
                if curr not in cluster_price_histories:
                    cluster_price_histories[curr] = []
                    cluster_volumes[curr] = 0.0
                    cluster_prices_now[curr] = 0.0
                    cluster_prices_24h_ago[curr] = 0.0
            for curr in (rate.currency_from, rate.currency_to):
                vol = float(rate.volume_traded)
                if vol > cluster_volumes.get(curr, 0):
                    cluster_volumes[curr] = vol

        # Derive prices from exchange rates for clustering
        for curr in cluster_volumes:
            cluster_prices_now[curr] = prices_in_chaos.get(curr, 0)
            cluster_prices_24h_ago[curr] = prices_in_chaos.get(curr, 0)

        if len(cluster_price_histories) >= 3:
            clusterer = CurrencyClusterer(config)
            output = clusterer.fit(
                cluster_price_histories, cluster_volumes,
                cluster_prices_now, cluster_prices_24h_ago,
            )
            cluster_labels = {c.currency: c.cluster for c in output.clusters}
    except Exception:
        cluster_labels = {}

    opportunities = []
    for key, rate in rates.items():
        price_to_chaos = prices_in_chaos.get(rate.currency_to, 0)
        trade_value = rate.raw_rate * price_to_chaos

        try:
            fee_fraction = compute_gold_fee_fraction(
                rate.currency_to, rate.raw_rate,
                gold_to_chaos_rate, max(trade_value, 1e-10),
                config.fees.unknown_item_gold_cost,
            )
            gold_fee_actual = compute_gold_fee(
                rate.currency_to, rate.raw_rate,
                config.fees.unknown_item_gold_cost,
            )
        except Exception:
            fee_fraction = 0.0
            gold_fee_actual = 0.0

        # Estimate bid/ask
        mid_price = rate.raw_rate
        spread_est = 0.02
        bid = mid_price * (1 - spread_est / 2)
        ask = mid_price * (1 + spread_est / 2)

        # Momentum from history (simplified: use 0 if no data)
        momentum = 0.0
        volatility = fee_fraction  # proxy

        score = compute_opportunity_score(
            bid=bid, ask=ask, mid_price=mid_price,
            volume_24h=float(rate.volume_traded),
            max_volume=float(max_volume),
            volatility=volatility,
            gold_fee_fraction=fee_fraction,
            phase_multiplier=phase_multiplier,
            momentum=momentum,
            momentum_neg_threshold=config.scoring.momentum_negative_threshold,
            vol_reference=config.scoring.volatility_reference,
        )

        # Use clustering result if available
        currency_key = rate.currency_from
        cluster = cluster_labels.get(currency_key, ClusterLabel.MODERATE)

        opp = FlipOpportunity(
            currency=f"{rate.currency_from}/{rate.currency_to}",
            score=score,
            spread_after_fees=(ask - bid) / mid_price - fee_fraction if mid_price > 0 else 0,
            gold_fee_fraction=fee_fraction,
            gold_fee_actual=gold_fee_actual,
            volume_24h=float(rate.volume_traded),
            momentum=momentum,
            volatility=volatility,
            cluster=cluster,
            bid=bid, ask=ask, mid_price=mid_price,
        )

        if quick_filter(opp, phase_info.phase, fee_fraction, config):
            opportunities.append({
                "currency": opp.currency,
                "score": opp.score,
                "spread_after_fees": opp.spread_after_fees,
                "gold_fee_fraction": opp.gold_fee_fraction,
                "gold_fee_actual": opp.gold_fee_actual,
                "volume_24h": opp.volume_24h,
                "momentum": opp.momentum,
                "volatility": opp.volatility,
                "cluster": opp.cluster.value,
                "bid": opp.bid,
                "ask": opp.ask,
                "mid_price": opp.mid_price,
            })

    opportunities.sort(key=lambda o: o["score"], reverse=True)

    # Triangular arbitrage
    rates_for_bf = {(r.currency_from, r.currency_to): r.raw_rate for r in rates.values()}
    gold_cost_dict = get_api_id_to_gold_cost()

    try:
        tri_opp = find_triangular_arbitrage(
            rates=rates_for_bf,
            gold_cost_per_unit=gold_cost_dict,
            prices_in_chaos=prices_in_chaos,
            gold_to_chaos_rate=gold_to_chaos_rate,
            min_profit_pct=0.1,
            fallback_gold_cost=config.fees.unknown_item_gold_cost,
        )
        tri_list = [
            {
                "cycle": o.cycle,
                "net_profit_pct": o.net_profit_pct,
                "step_rates": o.step_rates,
                "step_fees_gold": o.step_fees_gold,
                "step_fees_fraction": o.step_fees_fraction,
                "total_volume": o.total_volume,
                "confidence": o.confidence,
            }
            for o in tri_opp
        ]
    except Exception as e:
        logger.error("Triangular arb failed: %s", e)
        tri_list = []

    # Close provider
    try:
        import asyncio
        asyncio.run(provider.close())
    except Exception:
        pass

    return {
        "phase_info": phase_dict,
        "rates": rates_list,
        "opportunities": opportunities,
        "triangular": tri_list,
        "gold_to_chaos_rate": gold_to_chaos_rate,
    }


# ---------------------------------------------------------------------------
# Main App
# ---------------------------------------------------------------------------

def main():
    """Main Streamlit application."""

    # Header
    st.title("💰 PoE2 Flipper")
    st.caption("Currency Analysis & Arbitrage Dashboard — Path of Exile 2")

    # Data loading with spinner
    with st.spinner("Loading market data..."):
        # Try FastAPI backend first
        prices_data = fetch_api("/api/prices")
        flips_data = fetch_api("/api/arbitrage/flips", params={"limit": 200})
        phase_data = fetch_api("/api/phase")
        tri_data = fetch_api("/api/arbitrage/triangular")

    # Check if backend is available
    backend_available = prices_data is not None

    if backend_available:
        # Use API data
        rates_data = prices_data.get("rates", [])
        gold_to_chaos_rate = prices_data.get("gold_to_chaos_rate", 0.001)
        phase_info = phase_data or prices_data.get("phase_info")

        opportunities = flips_data.get("opportunities", []) if flips_data else []
        triangular = tri_data.get("opportunities", []) if tri_data else []
    else:
        # Fallback: load data directly via backend modules
        st.warning(
            "⚠️ Backend API not available at `{}`. "
            "Using direct backend module import (slower, no caching). "
            "Start the backend with: `uvicorn backend.main:app --reload`".format(API_BASE_URL)
        )
        with st.spinner("Loading data directly from POE2Scout API..."):
            direct_data = _load_data_directly()

        if "error" in direct_data:
            st.error(f"Failed to load data: {direct_data['error']}")
            st.info(
                "Make sure you have internet access and the POE2Scout API is reachable. "
                "Try refreshing the page."
            )
            return

        rates_data = direct_data.get("rates", [])
        phase_info = direct_data.get("phase_info")
        opportunities = direct_data.get("opportunities", [])
        triangular = direct_data.get("triangular", [])
        gold_to_chaos_rate = direct_data.get("gold_to_chaos_rate", 0.001)

    # ------------------------------------------------------------------
    # Sticky Bar
    # ------------------------------------------------------------------
    best_flip = opportunities[0] if opportunities else None
    best_tri = triangular[0] if triangular else None

    # Compute 24h trend from opportunities (average momentum)
    trend_24h = None
    if opportunities:
        momenta = [o.get("momentum", 0) for o in opportunities[:20]]
        trend_24h = sum(momenta) / len(momenta) if momenta else None

    render_sticky_bar(
        best_flip=best_flip,
        trend_24h=trend_24h,
        best_triangular=best_tri,
        active_event=None,  # events module not yet implemented
        phase_info=phase_info,
        gold_to_chaos_rate=gold_to_chaos_rate,
    )

    # ------------------------------------------------------------------
    # Tabs
    # ------------------------------------------------------------------
    # Build cluster assignments dict for graph tab
    cluster_assignments = {}
    if opportunities:
        for opp in opportunities:
            curr = opp.get("currency", "")
            cluster = opp.get("cluster", "moderate")
            # Use both sides of the pair
            parts = curr.split("/")
            for p in parts:
                if p and p not in cluster_assignments:
                    cluster_assignments[p] = cluster

    tab_overview, tab_flips, tab_graph, tab_forecast = st.tabs(
        ["📊 Overview", "🔄 Flip Opportunities", "🕸️ Currency Graph", "📈 Forecasts"]
    )

    with tab_overview:
        top_flips = opportunities[:5] if opportunities else []
        render_overview_tab(
            rates_data=rates_data,
            phase_info=phase_info,
            top_flips=top_flips,
            gold_to_chaos_rate=gold_to_chaos_rate,
            cluster_assignments=cluster_assignments,
        )

    with tab_flips:
        render_flips_tab(
            opportunities=opportunities,
            phase_info=phase_info,
            gold_to_chaos_rate=gold_to_chaos_rate,
        )

    with tab_graph:
        render_graph_tab(
            rates_data=rates_data,
            opportunities=opportunities,
            triangular=triangular,
            cluster_assignments=cluster_assignments,
            gold_to_chaos_rate=gold_to_chaos_rate,
        )

    with tab_forecast:
        # Currency selector for forecast
        available_currencies = list(set(
            opp.get("currency", "").split("/")[0]
            for opp in (opportunities or [])
        ))
        if available_currencies:
            selected_currency = st.selectbox(
                "Select currency for forecast",
                options=sorted(available_currencies),
                key="forecast_currency_select",
            )
        else:
            selected_currency = "exalted"

        # Fetch forecast data from API
        forecast_data = fetch_api(f"/api/forecast/{selected_currency}")
        stl_data = fetch_api(f"/api/forecast/{selected_currency}/stl")

        # Build price history from rates data for the chart background
        price_history_for_chart = []
        if rates_data and isinstance(rates_data, list):
            for rate in rates_data:
                pair = rate.get("pair", "")
                if selected_currency in pair:
                    price_history_for_chart.append({
                        "timestamp": rate.get("timestamp", ""),
                        "price": rate.get("raw_rate", 0),
                    })

        render_forecast_tab(
            forecast_data=forecast_data,
            stl_data=stl_data,
            anomaly_alerts=None,  # Will be populated when anomaly API is available
            currency=selected_currency,
            price_history=price_history_for_chart if price_history_for_chart else None,
        )

    # ------------------------------------------------------------------
    # Footer
    # ------------------------------------------------------------------
    st.markdown("---")
    st.caption(
        f"PoE2 Flipper v0.1 | Data from [POE2Scout](https://poe2scout.com/) | "
        f"Last refresh: {datetime.now(timezone.utc).strftime('%H:%M:%S UTC')}"
    )


if __name__ == "__main__":
    main()
