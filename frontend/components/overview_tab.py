"""
Overview Tab — heatmap + scatter + phase badge for the PoE2 Flipper dashboard.

From spec §7.2:
- Heatmap: Currencies x Time (24h), color = price change %. Use plotly.
- Scatter plot: X=liquidity, Y=volatility, color=cluster, size=volume. Use plotly.
- Phase badge: Current league phase + recommended strategy.
- Top-5 flips: Compact cards with score, spread, volume.
"""

from __future__ import annotations

from typing import Any

import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd
import numpy as np

from frontend.utils.formatters import (
    fmt_score,
    fmt_pct,
    fmt_number,
    fmt_gold,
    score_color,
    phase_color,
    phase_emoji,
    COLOR_GREEN,
    COLOR_RED,
    COLOR_BLUE,
    COLOR_ORANGE,
    COLOR_GRAY,
)


def render_overview_tab(
    rates_data: list[dict],
    phase_info: dict | None = None,
    top_flips: list[dict] | None = None,
    gold_to_chaos_rate: float | None = None,
) -> None:
    """Render the Overview tab with heatmap, scatter, phase badge, and top flips.

    Args:
        rates_data: List of exchange rate dicts with keys:
            pair, currency_from, currency_to, raw_rate, volume_traded,
            fee_fraction, gold_fee_actual
        phase_info: Dict with phase, days_since_reference, recommended_strategy, etc.
        top_flips: List of top flip opportunity dicts (sorted by score desc)
        gold_to_chaos_rate: Current gold-to-chaos rate
    """
    # ------------------------------------------------------------------
    # Phase Badge Section
    # ------------------------------------------------------------------
    _render_phase_badge(phase_info)

    # ------------------------------------------------------------------
    # Two-column layout: Heatmap | Scatter
    # ------------------------------------------------------------------
    left_col, right_col = st.columns(2)

    with left_col:
        _render_heatmap(rates_data)

    with right_col:
        _render_scatter(rates_data)

    # ------------------------------------------------------------------
    # Top-5 Flips Cards
    # ------------------------------------------------------------------
    _render_top_flips(top_flips or [])


# ---------------------------------------------------------------------------
# Phase Badge
# ---------------------------------------------------------------------------

def _render_phase_badge(phase_info: dict | None) -> None:
    """Render the current phase badge with strategy recommendation."""
    if phase_info is None:
        st.info("Phase information unavailable. Check API connection.")
        return

    phase = phase_info.get("phase", "unknown")
    days = phase_info.get("days_since_reference", 0)
    strategy = phase_info.get("recommended_strategy", "—")
    min_spread = phase_info.get("min_spread_after_fees", 0)
    max_hold = phase_info.get("max_hold_time", "—")
    ref_curr = phase_info.get("reference_currency", "exalted")

    emoji = phase_emoji(phase)
    color = phase_color(phase)
    phase_label = phase.upper()

    st.markdown(
        f"""
        <div style='background:#1e2533;padding:1em 1.5em;border-radius:8px;
                    border-left:4px solid {color};margin-bottom:1em'>
            <span style='font-size:1.3em'>{emoji}</span>
            <span style='color:{color};font-weight:bold;font-size:1.2em;margin-left:0.5em'>
                {phase_label} Phase
            </span>
            <span style='color:{COLOR_GRAY};margin-left:1em'>
                (Day {days} | Ref: {ref_curr.title()})
            </span>
            <br>
            <span style='font-size:0.9em'>
                Strategy: <b>{strategy}</b> |
                Min spread after fees: <b>{fmt_pct(min_spread)}</b> |
                Max hold: <b>{max_hold}</b>
            </span>
        </div>
        """,
        unsafe_allow_html=True,
    )


# ---------------------------------------------------------------------------
# Heatmap: Currencies x Time (simulated from rate changes)
# ---------------------------------------------------------------------------

def _render_heatmap(rates_data: list[dict]) -> None:
    """Render a heatmap showing price change percentages across currencies.

    Since we only have current snapshot data (not full time series) at this
    milestone, we create a synthetic 24h heatmap based on volatility estimates
    derived from the spread. A real implementation would use actual hourly
    historical data from the historical store.
    """
    st.subheader("Price Change Heatmap (24h)")

    if not rates_data:
        st.info("No rate data available for heatmap.")
        return

    # Build a dataframe of currencies with simulated price changes
    # In a full implementation, this would use actual hourly price_history
    currencies = []
    for r in rates_data:
        curr_from = r.get("currency_from", "")
        curr_to = r.get("currency_to", "")
        if curr_from and curr_to:
            currencies.append(f"{curr_from}/{curr_to}")

    if not currencies:
        st.info("No currency pairs available.")
        return

    # Take top currencies by volume for readability
    sorted_rates = sorted(rates_data, key=lambda x: x.get("volume_traded", 0), reverse=True)
    top_currencies = []
    seen = set()
    for r in sorted_rates:
        pair_name = f"{r.get('currency_from', '')}/{r.get('currency_to', '')}"
        if pair_name not in seen and len(top_currencies) < 20:
            seen.add(pair_name)
            top_currencies.append(r)

    if not top_currencies:
        return

    # Create simulated hourly data
    # Using fee_fraction as a proxy for volatility in this milestone
    hours = [f"{h:02d}:00" for h in range(24)]

    np.random.seed(42)  # deterministic for demo
    data_matrix = []
    labels = []

    for r in top_currencies:
        pair_name = f"{r.get('currency_from', '')}/{r.get('currency_to', '')}"
        labels.append(pair_name)
        # Simulate price changes around zero, scaled by fee_fraction (volatility proxy)
        vol_proxy = max(r.get("fee_fraction", 0.01), 0.005)
        changes = np.random.normal(0, vol_proxy * 10, 24).tolist()
        data_matrix.append(changes)

    if not data_matrix:
        return

    df = pd.DataFrame(data_matrix, index=labels, columns=hours)

    fig = go.Figure(data=go.Heatmap(
        z=df.values,
        x=df.columns,
        y=df.index,
        colorscale=[
            [0.0, COLOR_RED],
            [0.45, "#1e2533"],
            [0.55, "#1e2533"],
            [1.0, COLOR_GREEN],
        ],
        zmid=0,
        hovertemplate="%{y}<br>%{x}: %{z:.2f}%<extra></extra>",
        colorbar=dict(title="Change %", tickformat=".1f"),
    ))

    fig.update_layout(
        height=max(300, len(labels) * 25 + 100),
        margin=dict(l=120, r=20, t=30, b=40),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color="#e2e8f0", size=10),
        xaxis_title="Hour (UTC)",
        yaxis_title="",
    )

    st.plotly_chart(fig, use_container_width=True)


# ---------------------------------------------------------------------------
# Scatter Plot: Liquidity vs Volatility
# ---------------------------------------------------------------------------

def _render_scatter(rates_data: list[dict]) -> None:
    """Render a scatter plot of liquidity vs volatility, colored by cluster.

    At this milestone, cluster labels are not yet computed (that's M6),
    so all currencies are shown as 'moderate'. The scatter still visualizes
    the liquidity-volatility landscape.
    """
    st.subheader("Liquidity vs Volatility")

    if not rates_data:
        st.info("No rate data available for scatter plot.")
        return

    # Build dataframe
    rows = []
    for r in rates_data:
        pair_name = f"{r.get('currency_from', '')}/{r.get('currency_to', '')}"
        volume = r.get("volume_traded", 0)
        fee_frac = r.get("fee_fraction", 0)

        # Use fee_fraction as volatility proxy (higher fee = higher effective vol)
        # and volume as liquidity proxy
        rows.append({
            "pair": pair_name,
            "volume": volume,
            "liquidity": np.log1p(volume),  # log-scaled for visualization
            "volatility": fee_frac * 100,  # scale for readability
            "cluster": "moderate",  # placeholder until M6
        })

    df = pd.DataFrame(rows)

    if df.empty:
        st.info("No data points for scatter plot.")
        return

    cluster_colors = {
        "stable": COLOR_GREEN,
        "moderate": COLOR_BLUE,
        "volatile_illiquid": COLOR_RED,
    }

    fig = px.scatter(
        df,
        x="liquidity",
        y="volatility",
        color="cluster",
        size="volume",
        color_discrete_map=cluster_colors,
        hover_name="pair",
        hover_data={
            "volume": ":,.0f",
            "volatility": ":.2f",
            "liquidity": ":.2f",
            "cluster": True,
        },
    )

    fig.update_layout(
        height=400,
        margin=dict(l=60, r=20, t=30, b=50),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color="#e2e8f0", size=11),
        xaxis_title="Liquidity (log1p volume)",
        yaxis_title="Volatility (fee fraction proxy, %)",
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1,
        ),
    )

    st.plotly_chart(fig, use_container_width=True)


# ---------------------------------------------------------------------------
# Top-5 Flips Cards
# ---------------------------------------------------------------------------

def _render_top_flips(top_flips: list[dict]) -> None:
    """Render compact cards for the top-5 flip opportunities."""
    st.subheader("Top Flip Opportunities")

    if not top_flips:
        st.info("No flip opportunities detected. This may be due to low volume or high fees.")
        return

    top5 = top_flips[:5]
    cols = st.columns(min(len(top5), 5))

    for i, flip in enumerate(top5):
        with cols[i]:
            currency = flip.get("currency", "—")
            score = flip.get("score", 0)
            spread = flip.get("spread_after_fees", 0)
            volume = flip.get("volume_24h", 0)
            gold_fee = flip.get("gold_fee_actual", 0)
            momentum = flip.get("momentum", 0)

            # Determine card border color from score
            border = score_color(score)
            momentum_dir = "↑" if momentum > 0 else "↓" if momentum < 0 else "→"
            momentum_clr = COLOR_GREEN if momentum > 0 else COLOR_RED if momentum < 0 else COLOR_GRAY

            st.markdown(
                f"""
                <div style='background:#1e2533;padding:0.8em;border-radius:8px;
                            border-top:3px solid {border};height:100%'>
                    <div style='font-weight:bold;font-size:1em;margin-bottom:0.3em'>{currency}</div>
                    <div style='color:{border};font-size:1.3em;font-weight:bold'>
                        {fmt_score(score)}
                    </div>
                    <div style='font-size:0.85em;color:#94a3b8'>
                        Spread: <b>{fmt_pct(spread)}</b><br>
                        Vol: <b>{fmt_number(volume)}</b><br>
                        Fee: <b>{fmt_gold(gold_fee)}</b><br>
                        Mom: <span style='color:{momentum_clr}'>{momentum_dir} {abs(momentum):.4f}</span>
                    </div>
                </div>
                """,
                unsafe_allow_html=True,
            )
