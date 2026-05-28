"""
Portfolio Tab — displays portfolio allocation for PoE2 currencies.

From PoE2_Flipper_Implementation_Spec.md §7.6 Tab: Portfolio (LATE phase):
    - Bar chart: recommended weights per currency.
    - Portfolio risk metric (annualized volatility).
    - Correlation warning indicator.
    - "Rebalance" button (triggers portfolio recalculation).
    - Efficient frontier visualization ONLY if min-variance method is selected
      (risk parity has no frontier to show).
"""

from __future__ import annotations

import logging
from typing import Optional

import plotly.graph_objects as go
import streamlit as st

logger = logging.getLogger(__name__)


def render_portfolio_tab(
    portfolio_data: Optional[dict] = None,
    phase_info: Optional[dict] = None,
) -> None:
    """Render the Portfolio tab.

    Args:
        portfolio_data: Dict from the /api/portfolio endpoint with keys:
            method, weights, expected_risk, correlation_warning, last_rebalance
        phase_info: Dict with current league phase info.
    """
    st.subheader("Portfolio Allocation")

    # Phase context
    if phase_info:
        phase = phase_info.get("phase", "late")
        if phase != "late":
            st.info(
                f"Current phase: **{phase.upper()}**. "
                "Portfolio holding is recommended during LATE phase. "
                "During EARLY/MID, focus on quick flips and triangular arbitrage."
            )

    # Check if data is available
    if portfolio_data is None:
        st.warning(
            "Portfolio data unavailable. "
            "Make sure the backend is running and provides sufficient historical data "
            "(at least 2 currencies with >= 5 price points)."
        )
        return

    method = portfolio_data.get("method", "risk_parity")
    weights = portfolio_data.get("weights", {})
    expected_risk = portfolio_data.get("expected_risk", 0.0)
    correlation_warning = portfolio_data.get("correlation_warning", False)
    last_rebalance = portfolio_data.get("last_rebalance", None)

    if not weights:
        st.warning("No portfolio weights computed. Insufficient data.")
        return

    # ------------------------------------------------------------------
    # Key metrics row
    # ------------------------------------------------------------------
    col1, col2, col3 = st.columns(3)

    with col1:
        st.metric("Method", method.replace("_", " ").title())

    with col2:
        st.metric("Annualized Risk", f"{expected_risk:.2%}")

    with col3:
        if correlation_warning:
            st.markdown(
                '<div style="background-color:#7f1d1d;padding:8px;border-radius:4px;">'
                '<span style="color:#fca5a5;font-weight:bold;">⚠️ Correlation Shock Detected</span>'
                "</div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                '<div style="background-color:#14532d;padding:8px;border-radius:4px;">'
                '<span style="color:#86efac;font-weight:bold;">✓ No Correlation Shock</span>'
                "</div>",
                unsafe_allow_html=True,
            )

    # ------------------------------------------------------------------
    # Correlation warning detail
    # ------------------------------------------------------------------
    if correlation_warning:
        st.error(
            "**Correlation Shock Detected!** Average pairwise correlation has "
            "increased by >50% compared to the previous period. Position sizes "
            "have been reduced by the configured factor (default: 50%). "
            "Consider reducing exposure further or moving to cash."
        )

    # ------------------------------------------------------------------
    # Bar chart: recommended weights
    # ------------------------------------------------------------------
    st.markdown("### Recommended Weights")

    # Sort weights by value (descending)
    sorted_weights = dict(sorted(weights.items(), key=lambda x: x[1], reverse=True))

    # Color scheme from spec §7.7:
    # Green (#22c55e): profit/positive, Blue (#3b82f6): liquidity/volume
    # Use a blue-green gradient based on weight magnitude
    currencies = list(sorted_weights.keys())
    weight_values = list(sorted_weights.values())

    # Color gradient: higher weights get more saturated green
    max_w = max(weight_values) if weight_values else 1.0
    colors = [
        f"rgba(34, 197, 94, {0.3 + 0.7 * (w / max_w)})" if max_w > 0 else "rgba(34, 197, 94, 0.5)"
        for w in weight_values
    ]

    fig = go.Figure()

    fig.add_trace(
        go.Bar(
            x=currencies,
            y=weight_values,
            marker_color=colors,
            text=[f"{w:.1%}" for w in weight_values],
            textposition="auto",
            textfont=dict(size=11, color="#e2e8f0"),
            hovertemplate="<b>%{x}</b><br>Weight: %{y:.2%}<extra></extra>",
        )
    )

    fig.update_layout(
        title=dict(
            text=f"Portfolio Weights ({method.replace('_', ' ').title()})",
            font=dict(size=16, color="#e2e8f0"),
        ),
        xaxis=dict(
            title="Currency",
            tickangle=-45,
            title_font=dict(color="#94a3b8"),
            tickfont=dict(color="#94a3b8"),
        ),
        yaxis=dict(
            title="Weight",
            tickformat=".0%",
            title_font=dict(color="#94a3b8"),
            tickfont=dict(color="#94a3b8"),
        ),
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
        font=dict(color="#e2e8f0"),
        height=400,
        margin=dict(l=60, r=30, t=50, b=120),
    )

    st.plotly_chart(fig, use_container_width=True)

    # ------------------------------------------------------------------
    # Portfolio allocation table
    # ------------------------------------------------------------------
    st.markdown("### Allocation Details")

    # Build table data
    table_data = []
    for curr, w in sorted_weights.items():
        table_data.append({
            "Currency": curr,
            "Weight": f"{w:.2%}",
            "Weight (raw)": f"{w:.6f}",
        })

    if table_data:
        st.dataframe(
            table_data,
            use_container_width=True,
            hide_index=True,
            column_config={
                "Currency": st.column_config.TextColumn("Currency"),
                "Weight": st.column_config.TextColumn("Weight"),
                "Weight (raw)": st.column_config.TextColumn("Weight (raw)"),
            },
        )

    # ------------------------------------------------------------------
    # Rebalance button
    # ------------------------------------------------------------------
    st.markdown("### Actions")

    col_a, col_b = st.columns([1, 3])
    with col_a:
        if st.button("🔄 Rebalance Portfolio", type="primary"):
            st.info("Rebalancing... (triggering POST /api/portfolio/rebalance)")
            # The actual rebalance call happens in the main app.py
            st.session_state["portfolio_rebalance_trigger"] = True
            st.rerun()

    # Last rebalance timestamp
    if last_rebalance:
        st.caption(f"Last rebalance: {last_rebalance}")

    # ------------------------------------------------------------------
    # Method explanation (collapsible)
    # ------------------------------------------------------------------
    with st.expander("📖 Method Explanation"):
        if method == "risk_parity":
            st.markdown(
                """
                **Risk Parity** allocates portfolio weights so that each currency
                contributes equally to total portfolio risk.

                - No expected return estimates needed.
                - Each asset's weight is inversely proportional to its risk contribution.
                - Risk = volatility (std of log-returns).
                - Iterative solving via Sequential Least Squares (scipy SLSQP).

                **Simplified formula** (when correlations are low):
                ```
                w_i = (1 / volatility_i) / sum(1 / volatility_j)
                ```

                This approach is recommended during LATE league phase when markets
                are more stable and portfolio holding is viable.
                """
            )
        elif method == "min_variance":
            st.markdown(
                """
                **Minimum Variance Portfolio** minimizes total portfolio variance:
                ```
                minimize: w^T * Σ * w
                ```

                - Uses Ledoit-Wolf shrinkage on the covariance matrix for
                  stability when observations are few.
                - Constraints: weights sum to 1, all weights ≥ 1%.
                - No expected return estimates needed.

                **Correlation Shock Detection**: If average pairwise correlation
                increases by >50% vs. previous period, positions are reduced
                by a configurable factor (default: 50%).

                Change method in `config.yaml` → `portfolio.method` to switch
                between "risk_parity" and "min_variance".
                """
            )

    # ------------------------------------------------------------------
    # Efficient frontier (only for min_variance)
    # ------------------------------------------------------------------
    if method == "min_variance":
        with st.expander("📊 Efficient Frontier (Min-Variance)"):
            st.info(
                "Efficient frontier visualization requires computing optimal "
                "portfolios across a range of target returns. This is a "
                "computationally intensive operation and will be available in "
                "a future update. Currently, only the global minimum variance "
                "portfolio is computed."
            )
