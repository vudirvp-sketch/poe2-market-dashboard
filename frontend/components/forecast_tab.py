"""
Forecast Tab — Price charts with predictions, STL decomposition, and anomaly table.

From spec §7.5:
- Price chart (historical) + LightGBM forecast line + SARIMA forecast line + 95% CI shaded area.
- If models disagree: show both, mark as disagreement.
- STL decomposition sub-charts (trend, seasonal, residual) in a collapsible section.
- Anomaly table: timestamp, currency, alert_score, triggered indicators, direction.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st
import numpy as np

logger = logging.getLogger(__name__)

# Color scheme from spec §7.7
COLOR_GREEN = "#22c55e"
COLOR_RED = "#ef4444"
COLOR_BLUE = "#3b82f6"
COLOR_ORANGE = "#f97316"
COLOR_GRAY = "#6b7280"


def render_forecast_tab(
    forecast_data: dict | None = None,
    stl_data: dict | None = None,
    anomaly_alerts: list[dict] | None = None,
    currency: str = "",
    price_history: list[dict] | None = None,
    storage_value_data: dict | None = None,
) -> None:
    """Render the Forecast tab.

    Args:
        forecast_data: Response from /api/forecast/{currency}
        stl_data: Response from /api/forecast/{currency}/stl
        anomaly_alerts: List of anomaly alert dicts
        currency: Currently selected currency
        price_history: Historical price data points
        storage_value_data: Response from /api/storage-value/{currency} (Phase 2)
    """
    # --- Currency selector ---
    st.subheader("Price Forecasts")

    # Show available data info
    if forecast_data:
        st.info(
            f"**Currency:** {forecast_data.get('currency', currency)} | "
            f"**Data points:** {forecast_data.get('data_points', 0)} | "
            f"**Horizon:** {forecast_data.get('horizon', 24)} periods"
        )

        if forecast_data.get("disagreement"):
            st.warning(
                "⚠️ **Model Disagreement:** SARIMA and LightGBM forecasts diverge "
                "by >20%. Both are shown — interpret with caution."
            )
        if forecast_data.get("low_confidence"):
            st.warning(
                "⚠️ **Low Confidence:** An event flag is active. "
                "Forecasts may be unreliable."
            )

    # --- Price chart with forecasts ---
    _render_price_chart(forecast_data, price_history, currency)

    # --- STL Decomposition (collapsible) ---
    with st.expander("STL Decomposition", expanded=False):
        _render_stl_decomposition(stl_data, currency)

    # --- Anomaly Table (Phase 2: now with real data) ---
    if anomaly_alerts:
        _render_anomaly_table(anomaly_alerts)
    else:
        st.caption("No active anomaly alerts.")

    # --- Storage Value / Hold-Sell Decision (Phase 2, Spec Section 9) ---
    if storage_value_data:
        _render_storage_value(storage_value_data)


def _render_price_chart(
    forecast_data: dict | None,
    price_history: list[dict] | None,
    currency: str,
) -> None:
    """Render the main price chart with forecast overlays.

    From spec §7.5:
        Price chart (historical) + LightGBM forecast line + SARIMA forecast line
        + 95% CI shaded area.
    """
    fig = go.Figure()

    # Historical prices
    if price_history and len(price_history) > 0:
        hist_times = [p.get("timestamp", "") for p in price_history]
        hist_prices = [p.get("price", 0) for p in price_history]

        fig.add_trace(go.Scatter(
            x=hist_times,
            y=hist_prices,
            mode='lines',
            name='Historical Price',
            line=dict(color=COLOR_GRAY, width=2),
        ))

    # Forecast overlays
    if forecast_data and "models" in forecast_data:
        models = forecast_data["models"]

        # LightGBM (primary model — from spec: "The 'official' forecast shown
        # on the main dashboard is the LightGBM forecast (primary model).")
        if "lightgbm" in models:
            lgbm = models["lightgbm"]
            fig.add_trace(go.Scatter(
                x=lgbm["timestamps"],
                y=lgbm["point_forecast"],
                mode='lines',
                name='LightGBM Forecast',
                line=dict(color=COLOR_GREEN, width=2, dash='dash'),
            ))
            # 95% CI shaded area
            fig.add_trace(go.Scatter(
                x=lgbm["timestamps"] + lgbm["timestamps"][::-1],
                y=lgbm["ci_upper"] + lgbm["ci_lower"][::-1],
                fill='toself',
                fillcolor=f'rgba(34, 197, 94, 0.15)',
                line=dict(color='rgba(255,255,255,0)'),
                name='LightGBM 95% CI',
                showlegend=True,
            ))

        # SARIMA
        if "sarima" in models:
            sarima = models["sarima"]
            fig.add_trace(go.Scatter(
                x=sarima["timestamps"],
                y=sarima["point_forecast"],
                mode='lines',
                name='SARIMA Forecast',
                line=dict(color=COLOR_BLUE, width=2, dash='dot'),
            ))
            # 95% CI
            fig.add_trace(go.Scatter(
                x=sarima["timestamps"] + sarima["timestamps"][::-1],
                y=sarima["ci_upper"] + sarima["ci_lower"][::-1],
                fill='toself',
                fillcolor=f'rgba(59, 130, 246, 0.10)',
                line=dict(color='rgba(255,255,255,0)'),
                name='SARIMA 95% CI',
                showlegend=True,
            ))

        # Holt-Winters
        if "holt_winters" in models:
            hw = models["holt_winters"]
            fig.add_trace(go.Scatter(
                x=hw["timestamps"],
                y=hw["point_forecast"],
                mode='lines',
                name='Holt-Winters Forecast',
                line=dict(color=COLOR_ORANGE, width=2, dash='dashdot'),
            ))
            fig.add_trace(go.Scatter(
                x=hw["timestamps"] + hw["timestamps"][::-1],
                y=hw["ci_upper"] + hw["ci_lower"][::-1],
                fill='toself',
                fillcolor=f'rgba(249, 115, 22, 0.10)',
                line=dict(color='rgba(255,255,255,0)'),
                name='Holt-Winters 95% CI',
                showlegend=True,
            ))

    # Layout
    fig.update_layout(
        title=f"Price Forecast — {currency}" if currency else "Price Forecast",
        xaxis_title="Time",
        yaxis_title="Price",
        template="plotly_dark",
        height=450,
        hovermode="x unified",
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1,
        ),
    )

    st.plotly_chart(fig, use_container_width=True)

    # Model details table
    if forecast_data and "models" in forecast_data:
        _render_model_details(forecast_data["models"])


def _render_model_details(models: dict) -> None:
    """Render a summary table of model results."""
    rows = []
    for model_name, data in models.items():
        avg_forecast = np.mean(data["point_forecast"]) if data["point_forecast"] else 0
        mape = data.get("mape")
        rows.append({
            "Model": model_name.replace("_", " ").title(),
            "Avg Forecast": f"{avg_forecast:.4f}",
            "Low Confidence": "⚠️ Yes" if data.get("low_confidence") else "No",
            "Disagreement": "⚠️ Yes" if data.get("disagreement") else "No",
            "MAPE": f"{mape:.4f}" if mape is not None else "N/A",
        })

    if rows:
        st.dataframe(
            rows,
            use_container_width=True,
            hide_index=True,
        )


def _render_stl_decomposition(
    stl_data: dict | None,
    currency: str,
) -> None:
    """Render STL decomposition sub-charts.

    From spec §7.5:
        STL decomposition sub-charts (trend, seasonal, residual) in a
        collapsible section.
    """
    if stl_data is None:
        st.caption("STL decomposition data not available.")
        return

    timestamps = stl_data.get("timestamps", [])
    trend = stl_data.get("trend", [])
    seasonal = stl_data.get("seasonal", [])
    residual = stl_data.get("residual", [])

    if not timestamps or not trend:
        st.caption("Insufficient data for STL decomposition.")
        return

    fig = make_subplots(
        rows=3, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.05,
        subplot_titles=("Trend", "Seasonal", "Residual"),
    )

    # Trend
    fig.add_trace(go.Scatter(
        x=timestamps,
        y=trend,
        mode='lines',
        name='Trend',
        line=dict(color=COLOR_BLUE, width=2),
    ), row=1, col=1)

    # Seasonal
    fig.add_trace(go.Scatter(
        x=timestamps,
        y=seasonal,
        mode='lines',
        name='Seasonal',
        line=dict(color=COLOR_GREEN, width=2),
    ), row=2, col=1)

    # Residual
    fig.add_trace(go.Scatter(
        x=timestamps,
        y=residual,
        mode='lines',
        name='Residual',
        line=dict(color=COLOR_RED, width=1),
    ), row=3, col=1)

    fig.update_layout(
        title=f"STL Decomposition — {currency}" if currency else "STL Decomposition",
        template="plotly_dark",
        height=600,
        showlegend=False,
        hovermode="x unified",
    )

    st.plotly_chart(fig, use_container_width=True)

    # STL info
    st.caption(
        f"Seasonal period: {stl_data.get('seasonal_period', 'N/A')} | "
        f"Data points: {stl_data.get('data_points', len(trend))}"
    )


def _render_anomaly_table(anomaly_alerts: list[dict]) -> None:
    """Render the anomaly alerts table.

    From spec §7.5:
        Anomaly table: timestamp, currency, alert_score, triggered indicators,
        direction.
    """
    st.subheader("Anomaly Alerts")

    # Sort by alert_score descending
    sorted_alerts = sorted(
        anomaly_alerts,
        key=lambda a: a.get("alert_score", 0),
        reverse=True,
    )

    # Format for display
    rows = []
    for alert in sorted_alerts:
        score = alert.get("alert_score", 0)
        direction = alert.get("direction", "")
        direction_icon = "🟢" if direction == "up" else "🔴" if direction == "down" else "⚪"

        rows.append({
            "Timestamp": alert.get("timestamp", ""),
            "Currency": alert.get("currency", ""),
            "Alert Score": f"{score:.2f}",
            "Direction": f"{direction_icon} {direction}",
            "Indicators": ", ".join(alert.get("triggered_indicators", [])),
            "Confirmed": "✅" if alert.get("is_confirmed") else "❌",
        })

    st.dataframe(
        rows,
        use_container_width=True,
        hide_index=True,
    )


def _render_storage_value(sv_data: dict) -> None:
    """Render the Storage Value / Hold-Sell Decision panel.

    Phase 2 (Spec Section 9.3): Shows projected value, decision,
    risk discount, and key inputs for the hold/sell analysis.
    """
    st.subheader("Storage Value — Hold/Sell Decision")

    decision = sv_data.get("decision", "NEUTRAL")
    decision_color = COLOR_GREEN if decision == "BUY/HOLD" else COLOR_RED if decision == "SELL/CONVERT" else COLOR_GRAY

    col1, col2, col3 = st.columns(3)

    with col1:
        st.metric(
            "Projected Value",
            f"{sv_data.get('projected_price', 0):.4f}",
            delta=f"{sv_data.get('ratio', 0) - 1:.2%}" if sv_data.get('ratio') else None,
        )

    with col2:
        st.markdown(
            f"<div style='text-align:center;padding:1em 0'>"
            f"<span style='font-size:1.5em;font-weight:bold;color:{decision_color}'>{decision}</span>"
            f"</div>",
            unsafe_allow_html=True,
        )

    with col3:
        st.metric(
            "Risk Discount",
            f"{sv_data.get('risk_discount', 0):.2%}",
        )

    # Additional details
    inputs = sv_data.get("inputs", {})
    with st.expander("Storage Value Details", expanded=False):
        detail_cols = st.columns(3)
        with detail_cols[0]:
            st.metric("Current Price", f"{sv_data.get('current_price', 0):.4f}")
            st.metric("Adjusted Price", f"{sv_data.get('adjusted_price', 0):.4f}")
        with detail_cols[1]:
            st.metric("Net Value After Fees", f"{sv_data.get('net_value_after_fees', 0):.4f}")
            st.metric("Ratio (net/current)", f"{sv_data.get('ratio', 0):.4f}")
        with detail_cols[2]:
            st.metric("Momentum", f"{inputs.get('momentum', 0):.6f}")
            st.metric("Volatility", f"{inputs.get('volatility', 0):.6f}")
            st.metric("Gold Fee Fraction", f"{inputs.get('gold_fee_fraction', 0):.4f}")
            st.metric("Horizon (hours)", f"{inputs.get('horizon_hours', 24)}")
