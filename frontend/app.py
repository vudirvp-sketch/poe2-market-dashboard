"""
PoE2 Flipper — Streamlit Dashboard

This is the main entry point for the frontend. Run with:
    streamlit run frontend/app.py

Tabs:
    - Overview: heatmap + scatter + phase badge + top-5 flips
    - Flips: sortable/filterable flip opportunities table with detail panel
    - Currency Graph: network visualization with cycle highlighting
    - Forecasts: price charts + predictions + STL decomposition
    - Portfolio: allocation weights + risk metrics

Milestone 9 additions:
    - Events sidebar for manual event flagging
    - Active event display in sticky bar
    - Event effects propagated to scoring and forecasting
    - UI polish: progressive disclosure, pagination, currency icons
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
from frontend.components.portfolio_tab import render_portfolio_tab
from frontend.components.events_sidebar import render_events_sidebar
from frontend.utils.formatters import fmt_number, fmt_event_status

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Page Configuration
# ---------------------------------------------------------------------------

st.set_page_config(
    page_title="PoE2 Flipper",
    page_icon="💰",
    layout="wide",
    initial_sidebar_state="expanded",  # Changed: sidebar now holds event controls
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

    /* Event alert banner */
    .event-banner {
        background: linear-gradient(90deg, #7c2d12, #92400e);
        padding: 0.5em 1em;
        border-radius: 6px;
        margin-bottom: 0.5em;
    }

    /* Progressive disclosure hint */
    .detail-hint {
        font-size: 0.85em;
        color: #64748b;
        font-style: italic;
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

    Key improvements over previous version:
    - Fetches currencies with price_logs from all categories (paginated)
    - Computes real momentum/volatility from price history via PriceMomentumTracker
    - Derives rates from relative_price (more reliable than volume-based)
    - Proper spread estimation based on volume
    """
    import asyncio
    import numpy as np
    from backend.config import get_settings
    from backend.data.providers.poe2scout import Poe2ScoutProvider
    from backend.data.cache import get_cache
    from backend.economy.lifecycle import PhaseDetector
    from backend.economy.momentum import PriceMomentumTracker
    from backend.economy.gold_costs import compute_gold_fee_fraction, compute_gold_fee
    from backend.economy.gold_cost_table import get_gold_cost_per_unit, get_api_id_to_gold_cost
    from backend.economy.events import get_event_manager
    from backend.arbitrage.scorer import compute_opportunity_score, get_phase_multiplier
    from backend.arbitrage.quick_filter import quick_filter
    from backend.arbitrage.triangular import find_triangular_arbitrage
    from backend.predictors.clustering import CurrencyClusterer
    from backend.models.currency import FlipOpportunity, ClusterLabel

    config = get_settings()
    provider = Poe2ScoutProvider(config)
    cache = get_cache(config)
    detector = PhaseDetector(config.league.league_start_datetime, config)
    event_manager = get_event_manager(config)

    async def _fetch():
        # Get exchange rates from SnapshotPairs
        rates_result = await cache.get_or_fetch(
            "prices", provider.name(), "get_exchange_rates",
            provider.get_exchange_rates, config.league.league_name,
        )
        rates = rates_result.value if rates_result.value else {}

        # Get phase info
        phase_info = detector.get_phase_info()

        # Get all currencies with price_logs from all categories
        # This provides real price history for momentum/volatility computation
        all_currencies = await provider.get_all_currencies_with_prices(
            config.league.league_name
        )

        # Gold rate
        gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
        if config.fees.gold_to_chaos_rate_source == "market":
            observed = await provider.get_gold_chaos_rate(config.league.league_name)
            if observed is not None:
                gold_to_chaos_rate = observed

        return rates, phase_info, all_currencies, gold_to_chaos_rate

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, _fetch())
                rates, phase_info, all_currencies, gold_to_chaos_rate = future.result(timeout=60)
        else:
            rates, phase_info, all_currencies, gold_to_chaos_rate = loop.run_until_complete(_fetch())
    except Exception as e:
        logger.error("Direct data loading failed: %s", e)
        return {
            "error": str(e),
            "phase_info": None,
            "rates": [],
            "opportunities": [],
            "triangular": [],
            "gold_to_chaos_rate": None,
            "active_event": None,
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

    # Build a lookup of currency api_id → price_logs for momentum computation
    currency_price_logs: dict[str, list[dict]] = {}
    currency_current_price: dict[str, float | None] = {}
    currency_icon_urls: dict[str, str | None] = {}
    for curr in all_currencies:
        api_id = curr.get("api_id", "")
        if api_id:
            currency_price_logs[api_id] = curr.get("price_logs", [])
            currency_current_price[api_id] = curr.get("current_price")
            currency_icon_urls[api_id] = curr.get("icon_url")

    # Compute momentum and volatility for each currency using PriceMomentumTracker
    momentum_data: dict[str, dict] = {}  # api_id → {momentum, volatility, acceleration}
    for api_id, price_logs in currency_price_logs.items():
        if len(price_logs) < 2:
            momentum_data[api_id] = {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}
            continue
        try:
            # Sort by time and extract prices
            sorted_logs = sorted(
                [l for l in price_logs if l.get("price") is not None and l.get("time") is not None],
                key=lambda l: l["time"],
            )
            prices = [l["price"] for l in sorted_logs]
            if len(prices) < 2:
                momentum_data[api_id] = {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}
                continue

            tracker = PriceMomentumTracker(window_size=24)
            for p in prices:
                tracker.update(p)
            result = tracker.compute()
            momentum_data[api_id] = {
                "momentum": result.momentum,
                "volatility": result.volatility,
                "acceleration": result.acceleration,
            }
        except Exception as e:
            logger.debug("Momentum computation failed for %s: %s", api_id, e)
            momentum_data[api_id] = {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}

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

    # Build flip opportunities with real momentum/volatility and event penalties
    phase_multiplier = get_phase_multiplier(phase_info.phase, config)
    max_volume = max((r.volume_traded for r in rates.values() if r.volume_traded > 0), default=1)

    # Build prices_in_chaos using rates derived from relative_price
    prices_in_chaos = {config.league.base_currency: 1.0}
    for key, rate in rates.items():
        if rate.currency_from == config.league.base_currency:
            prices_in_chaos[rate.currency_to] = rate.raw_rate
        elif rate.currency_to == config.league.base_currency and rate.raw_rate > 0:
            prices_in_chaos[rate.currency_from] = 1.0 / rate.raw_rate

    # Also use current_price from all_currencies for more accurate prices
    for api_id, curr_price in currency_current_price.items():
        if curr_price is not None and curr_price > 0:
            # current_price is in base_currency (Exalted) terms
            prices_in_chaos[api_id] = curr_price

    # Run currency clustering with real price histories
    cluster_labels: dict[str, ClusterLabel] = {}
    try:
        cluster_price_histories: dict[str, list[float]] = {}
        cluster_volumes: dict[str, float] = {}
        cluster_prices_now: dict[str, float] = {}
        cluster_prices_24h_ago: dict[str, float] = {}

        # Use price_logs from all_currencies for clustering features
        for curr in all_currencies:
            api_id = curr.get("api_id", "")
            if not api_id:
                continue
            logs = curr.get("price_logs", [])
            prices_from_logs = [l["price"] for l in logs if l.get("price") is not None]
            cluster_price_histories[api_id] = prices_from_logs
            cluster_volumes[api_id] = float(curr.get("current_quantity") or 0)
            cluster_prices_now[api_id] = curr.get("current_price") or prices_in_chaos.get(api_id, 0)

            # Estimate 24h_ago price from price_logs
            if len(prices_from_logs) >= 2:
                cluster_prices_24h_ago[api_id] = prices_from_logs[0]
            else:
                cluster_prices_24h_ago[api_id] = cluster_prices_now[api_id]

        # Also include currencies from rates that weren't in all_currencies
        for key, rate in rates.items():
            for curr in (rate.currency_from, rate.currency_to):
                if curr not in cluster_price_histories:
                    cluster_price_histories[curr] = []
                    cluster_volumes[curr] = float(rate.volume_traded)
                    cluster_prices_now[curr] = prices_in_chaos.get(curr, 0)
                    cluster_prices_24h_ago[curr] = prices_in_chaos.get(curr, 0)
                else:
                    vol = float(rate.volume_traded)
                    if vol > cluster_volumes.get(curr, 0):
                        cluster_volumes[curr] = vol

        if len(cluster_price_histories) >= 3:
            clusterer = CurrencyClusterer(config)
            output = clusterer.fit(
                cluster_price_histories, cluster_volumes,
                cluster_prices_now, cluster_prices_24h_ago,
            )
            cluster_labels = {c.currency: c.cluster for c in output.clusters}
    except Exception as e:
        logger.debug("Clustering failed: %s", e)
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

        mid_price = rate.raw_rate
        # Estimate spread from volume: higher volume → tighter spread
        vol = float(rate.volume_traded)
        if vol > 1000:
            spread_est = 0.01
        elif vol > 100:
            spread_est = 0.02
        else:
            spread_est = 0.05
        bid = mid_price * (1 - spread_est / 2)
        ask = mid_price * (1 + spread_est / 2)

        # Use real momentum/volatility from price_logs (not hardcoded!)
        curr_momentum = momentum_data.get(rate.currency_from, {}).get("momentum", 0.0)
        curr_volatility = momentum_data.get(rate.currency_from, {}).get("volatility", 0.0)
        # If volatility is 0 (no history), use fee_fraction as a conservative estimate
        if curr_volatility <= 0:
            curr_volatility = fee_fraction if fee_fraction > 0 else 0.01

        score = compute_opportunity_score(
            bid=bid, ask=ask, mid_price=mid_price,
            volume_24h=float(rate.volume_traded),
            max_volume=float(max_volume),
            volatility=curr_volatility,
            gold_fee_fraction=fee_fraction,
            phase_multiplier=phase_multiplier,
            momentum=curr_momentum,
            momentum_neg_threshold=config.scoring.momentum_negative_threshold,
            vol_reference=config.scoring.volatility_reference,
        )

        # MILESTONE 9: Apply event penalty
        event_penalty = event_manager.get_event_score_penalty(rate.currency_from)
        if event_penalty == 0.0:
            continue  # excluded
        score = score * event_penalty
        event_penalty_to = event_manager.get_event_score_penalty(rate.currency_to)
        if event_penalty_to == 0.0:
            continue
        score = score * event_penalty_to
        score = min(max(score, 0.0), 1.0)

        currency_key = rate.currency_from
        cluster = cluster_labels.get(currency_key, ClusterLabel.MODERATE)

        opp = FlipOpportunity(
            currency=f"{rate.currency_from}/{rate.currency_to}",
            score=score,
            spread_after_fees=(ask - bid) / mid_price - fee_fraction if mid_price > 0 else 0,
            gold_fee_fraction=fee_fraction,
            gold_fee_actual=gold_fee_actual,
            volume_24h=float(rate.volume_traded),
            momentum=curr_momentum,
            volatility=curr_volatility,
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

    # Get active event summary for the sticky bar
    active_event = event_manager.get_active_event_summary()

    return {
        "phase_info": phase_dict,
        "rates": rates_list,
        "opportunities": opportunities,
        "triangular": tri_list,
        "gold_to_chaos_rate": gold_to_chaos_rate,
        "active_event": active_event,
        "icon_urls": currency_icon_urls,  # Phase 2 (Spec §4)
    }


# ---------------------------------------------------------------------------
# Main App
# ---------------------------------------------------------------------------

def main():
    """Main Streamlit application."""

    # Header
    st.title("💰 PoE2 Flipper")
    st.caption("Currency Analysis & Arbitrage Dashboard — Path of Exile 2")

    # ------------------------------------------------------------------
    # Sidebar: Event Management (Milestone 9)
    # ------------------------------------------------------------------
    active_event = None

    with st.sidebar:
        st.markdown("### 🎛️ Controls")
        active_event = render_events_sidebar(API_BASE_URL)

        # Data refresh control
        st.markdown("---")
        st.markdown("### 🔄 Data")
        if st.button("Force Refresh", use_container_width=True):
            st.cache_data.clear()
            st.rerun()

        # Event status indicator
        if active_event:
            st.markdown("---")
            event_status = fmt_event_status(
                True,
                active_event.get("affected_currencies", []),
            )
            st.warning(f"⚠️ {event_status}")

    # ------------------------------------------------------------------
    # Data Loading
    # ------------------------------------------------------------------
    with st.spinner("Loading market data..."):
        # Try FastAPI backend first
        prices_data = fetch_api("/api/prices")
        flips_data = fetch_api("/api/arbitrage/flips", params={"limit": 200})
        phase_data = fetch_api("/api/phase")
        tri_data = fetch_api("/api/arbitrage/triangular")
        # Phase 2: Fetch heatmap data for real overview
        heatmap_data = fetch_api("/api/prices/heatmap")
        # Phase 2 (Spec §4): Fetch currency icons
        currencies_data = fetch_api("/api/currencies")

    # Check if backend is available
    backend_available = prices_data is not None

    if backend_available:
        # Use API data
        rates_data = prices_data.get("rates", [])
        gold_to_chaos_rate = prices_data.get("gold_to_chaos_rate", 0.001)
        phase_info = phase_data or prices_data.get("phase_info")

        opportunities = flips_data.get("opportunities", []) if flips_data else []
        triangular = tri_data.get("opportunities", []) if tri_data else []
        heatmap_data_api = heatmap_data  # Save for overview tab

        # Phase 2 (Spec §4): Build icon_url lookup from /api/currencies
        icon_urls: dict[str, str | None] = {}
        if currencies_data and "currencies" in currencies_data:
            for c in currencies_data["currencies"]:
                api_id = c.get("api_id", "")
                if api_id:
                    icon_urls[api_id] = c.get("icon_url")

        # Get event status from the flips response (Milestone 9)
        if flips_data and "event_status" in flips_data:
            event_status = flips_data["event_status"]
            if event_status.get("any_active") and not active_event:
                active_event = event_status.get("summary")

        # If no active event from sidebar, try the events summary API
        if not active_event:
            events_summary = fetch_api("/api/events/summary")
            if events_summary and events_summary.get("any_event_active"):
                active_event = events_summary.get("event")
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
        heatmap_data_api = None  # No heatmap data in direct mode

        # Phase 2 (Spec §4): Use icon URLs from direct backend load
        icon_urls = direct_data.get("icon_urls", {})

        # Event summary from direct data
        if direct_data.get("active_event"):
            active_event = direct_data["active_event"]

    # ------------------------------------------------------------------
    # Event Banner (Milestone 9) — prominent alert if events active
    # ------------------------------------------------------------------
    if active_event:
        from frontend.utils.formatters import event_type_display, event_severity_color

        event_type = active_event.get("event_type", "other")
        event_label, event_icon = event_type_display(event_type)
        desc = active_event.get("description", "")
        severity_color = event_severity_color(event_type)
        total = active_event.get("total_active_events", 1)

        banner_extra = ""
        if total > 1:
            banner_extra = f" (+{total - 1} more active)"

        st.markdown(
            f"<div class='event-banner'>"
            f"<span style='font-size:1.1em'>{event_icon} <b>{event_label}</b>{banner_extra}</span><br>"
            f"<span style='font-size:0.9em'>{desc}</span><br>"
            f"<span style='font-size:0.8em;color:#fbbf24'>"
            f"Forecasts: low confidence | Holt-Winters: suspended | "
            f"Some currencies may be excluded from scoring"
            f"</span>"
            f"</div>",
            unsafe_allow_html=True,
        )

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
        active_event=active_event,
        phase_info=phase_info,
        gold_to_chaos_rate=gold_to_chaos_rate,
    )

    # ------------------------------------------------------------------
    # Tabs
    # ------------------------------------------------------------------
    cluster_assignments = {}
    if opportunities:
        for opp in opportunities:
            curr = opp.get("currency", "")
            cluster = opp.get("cluster", "moderate")
            parts = curr.split("/")
            for p in parts:
                if p and p not in cluster_assignments:
                    cluster_assignments[p] = cluster

    tab_overview, tab_flips, tab_graph, tab_forecast, tab_portfolio = st.tabs(
        ["📊 Overview", "🔄 Flip Opportunities", "🕸️ Currency Graph", "📈 Forecasts", "💼 Portfolio"]
    )

    with tab_overview:
        top_flips = opportunities[:5] if opportunities else []
        render_overview_tab(
            rates_data=rates_data,
            phase_info=phase_info,
            top_flips=top_flips,
            gold_to_chaos_rate=gold_to_chaos_rate,
            cluster_assignments=cluster_assignments,
            heatmap_data=heatmap_data_api,  # Phase 2: real heatmap data
            icon_urls=icon_urls,  # Phase 2 (Spec §4)
        )

    with tab_flips:
        render_flips_tab(
            opportunities=opportunities,
            phase_info=phase_info,
            gold_to_chaos_rate=gold_to_chaos_rate,
            icon_urls=icon_urls,  # Phase 2 (Spec §4)
        )

    with tab_graph:
        render_graph_tab(
            rates_data=rates_data,
            opportunities=opportunities,
            triangular=triangular,
            cluster_assignments=cluster_assignments,
            gold_to_chaos_rate=gold_to_chaos_rate,
            icon_urls=icon_urls,  # Phase 2 (Spec §4)
        )

    with tab_forecast:
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
        # Milestone 9: event status is auto-detected by the forecast endpoint
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

        # Phase 2: Fetch anomaly data from API
        anomaly_alerts = None
        try:
            anomaly_resp_data = fetch_api(f"/api/anomalies?currency={selected_currency}")
            if anomaly_resp_data:
                anomaly_alerts = anomaly_resp_data.get("anomalies", [])
        except Exception:
            anomaly_alerts = None

        # Phase 2: Fetch storage value data
        storage_value_data = None
        try:
            storage_value_data = fetch_api(f"/api/storage-value/{selected_currency}")
        except Exception:
            storage_value_data = None

        render_forecast_tab(
            forecast_data=forecast_data,
            stl_data=stl_data,
            anomaly_alerts=anomaly_alerts,
            currency=selected_currency,
            price_history=price_history_for_chart if price_history_for_chart else None,
            storage_value_data=storage_value_data,  # Phase 2
            icon_urls=icon_urls,  # Phase 2 (Spec §4)
        )

    with tab_portfolio:
        portfolio_data = fetch_api("/api/portfolio")

        # Handle rebalance trigger
        if st.session_state.get("portfolio_rebalance_trigger"):
            try:
                with httpx.Client(timeout=15.0) as client:
                    resp = client.post(f"{API_BASE_URL}/api/portfolio/rebalance")
                    if resp.status_code == 200:
                        portfolio_data = resp.json()
                        st.success("Portfolio rebalanced successfully!")
            except Exception as e:
                logger.error("Rebalance failed: %s", e)
                st.error(f"Rebalance failed: {e}")
            st.session_state["portfolio_rebalance_trigger"] = False

        render_portfolio_tab(
            portfolio_data=portfolio_data,
            phase_info=phase_info,
            icon_urls=icon_urls,  # Phase 2 (Spec §4)
        )

    # ------------------------------------------------------------------
    # Footer
    # ------------------------------------------------------------------
    st.markdown("---")
    event_note = " | ⚠️ Events active" if active_event else ""
    st.caption(
        f"PoE2 Flipper v0.2 (M9){event_note} | Data from [POE2Scout](https://poe2scout.com/) | "
        f"Last refresh: {datetime.now(timezone.utc).strftime('%H:%M:%S UTC')}"
    )


if __name__ == "__main__":
    main()
