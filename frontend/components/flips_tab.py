"""
Flips Tab — flip opportunities table for the PoE2 Flipper dashboard.

From spec §7.3:
- Sortable table: currency, score (with color gradient), spread after fees,
  gold fee (actual gold amount), volume, momentum, cluster.
- Filters: min score, min volume, exclude cluster, phase-appropriate only.
- Click row → detail panel: price history chart, anomaly indicators,
  projected value (detail panel deferred to later milestones).
"""

from __future__ import annotations

from typing import Any

import streamlit as st
import pandas as pd
import plotly.graph_objects as go

from frontend.utils.formatters import (
    fmt_score,
    fmt_pct,
    fmt_number,
    fmt_gold,
    fmt_rate,
    fmt_momentum,
    fmt_spread,
    score_color,
    momentum_color,
    cluster_display,
    COLOR_GREEN,
    COLOR_RED,
    COLOR_BLUE,
    COLOR_ORANGE,
    COLOR_GRAY,
)


def render_flips_tab(
    opportunities: list[dict],
    phase_info: dict | None = None,
    gold_to_chaos_rate: float | None = None,
) -> None:
    """Render the Flip Opportunities tab with filters and table.

    Args:
        opportunities: List of flip opportunity dicts with keys:
            currency, score, spread_after_fees, gold_fee_fraction,
            gold_fee_actual, volume_24h, momentum, volatility, cluster,
            bid, ask, mid_price
        phase_info: Current phase information for contextual filters
        gold_to_chaos_rate: Current gold-to-chaos rate
    """
    st.subheader("Flip Opportunities")

    if not opportunities:
        st.info(
            "No flip opportunities detected. This may be due to low market volume "
            "or high gold fees. Try adjusting the filters below or check back later."
        )
        return

    # ------------------------------------------------------------------
    # Filters Section
    # ------------------------------------------------------------------
    with st.expander("Filters", expanded=True):
        filter_cols = st.columns(4)

        with filter_cols[0]:
            min_score = st.slider(
                "Min Score",
                min_value=0.0,
                max_value=1.0,
                value=0.0,
                step=0.05,
                help="Minimum opportunity score (0-1)",
            )

        with filter_cols[1]:
            min_volume = st.number_input(
                "Min Volume (24h)",
                min_value=0,
                max_value=10000,
                value=0,
                step=50,
                help="Minimum 24-hour trading volume",
            )

        with filter_cols[2]:
            exclude_clusters = st.multiselect(
                "Exclude Clusters",
                options=["stable", "moderate", "volatile_illiquid"],
                default=[],
                help="Exclude currencies in selected clusters",
            )

        with filter_cols[3]:
            phase_only = st.checkbox(
                "Phase-appropriate only",
                value=False,
                help="Only show opportunities that meet the current phase's min spread requirement",
            )

    # ------------------------------------------------------------------
    # Apply Filters
    # ------------------------------------------------------------------
    filtered = opportunities.copy()

    if min_score > 0:
        filtered = [o for o in filtered if o.get("score", 0) >= min_score]

    if min_volume > 0:
        filtered = [o for o in filtered if o.get("volume_24h", 0) >= min_volume]

    if exclude_clusters:
        filtered = [o for o in filtered if o.get("cluster", "") not in exclude_clusters]

    if phase_only and phase_info:
        min_spread = phase_info.get("min_spread_after_fees", 0)
        filtered = [o for o in filtered if o.get("spread_after_fees", 0) >= min_spread]

    # ------------------------------------------------------------------
    # Summary Stats
    # ------------------------------------------------------------------
    if filtered:
        total = len(filtered)
        avg_score = sum(o.get("score", 0) for o in filtered) / total
        best = filtered[0] if filtered else None

        summary_cols = st.columns(4)
        with summary_cols[0]:
            st.metric("Total Opportunities", total)
        with summary_cols[1]:
            st.metric("Avg Score", f"{avg_score * 100:.1f}%")
        with summary_cols[2]:
            if best:
                st.metric("Best Pair", best.get("currency", "—"))
        with summary_cols[3]:
            if gold_to_chaos_rate is not None:
                st.metric("Gold Rate", f"{gold_to_chaos_rate:.4f} C/G")
    else:
        st.warning("No opportunities match the current filters.")

    # ------------------------------------------------------------------
    # Data Table
    # ------------------------------------------------------------------
    if not filtered:
        return

    # Build DataFrame for display
    df_data = []
    for o in filtered:
        cluster_label, _ = cluster_display(o.get("cluster", "moderate"))
        df_data.append({
            "Currency": o.get("currency", "—"),
            "Score": o.get("score", 0),
            "Score %": fmt_score(o.get("score", 0)),
            "Spread (after fees)": fmt_spread(o.get("spread_after_fees", 0)),
            "Gold Fee": fmt_gold(o.get("gold_fee_actual", 0)),
            "Fee %": fmt_pct(o.get("gold_fee_fraction", 0)),
            "Volume (24h)": fmt_number(o.get("volume_24h", 0)),
            "Momentum": fmt_momentum(o.get("momentum", 0)),
            "Volatility": f"{o.get('volatility', 0):.4f}",
            "Cluster": cluster_label,
            "Bid": fmt_rate(o.get("bid", 0)),
            "Ask": fmt_rate(o.get("ask", 0)),
            "Mid": fmt_rate(o.get("mid_price", 0)),
            # Keep raw values for sorting
            "_score_raw": o.get("score", 0),
            "_volume_raw": o.get("volume_24h", 0),
            "_spread_raw": o.get("spread_after_fees", 0),
            "_momentum_raw": o.get("momentum", 0),
            "_volatility_raw": o.get("volatility", 0),
            "_fee_raw": o.get("gold_fee_actual", 0),
        })

    df = pd.DataFrame(df_data)

    # Sort options
    sort_col = st.selectbox(
        "Sort by",
        options=["Score", "Volume (24h)", "Spread (after fees)", "Momentum", "Volatility", "Gold Fee"],
        index=0,
        key="flips_sort",
    )

    sort_ascending = st.checkbox("Ascending", value=False, key="flips_ascending")

    # Map display name to raw column
    sort_map = {
        "Score": "_score_raw",
        "Volume (24h)": "_volume_raw",
        "Spread (after fees)": "_spread_raw",
        "Momentum": "_momentum_raw",
        "Volatility": "_volatility_raw",
        "Gold Fee": "_fee_raw",
    }

    raw_col = sort_map.get(sort_col, "_score_raw")
    df = df.sort_values(raw_col, ascending=sort_ascending)

    # Pagination
    page_size = 50
    total_pages = max(1, (len(df) + page_size - 1) // page_size)
    page = st.number_input(
        f"Page (of {total_pages})",
        min_value=1,
        max_value=total_pages,
        value=1,
        key="flips_page",
    )

    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    page_df = df.iloc[start_idx:end_idx]

    # Display columns (hide raw sort columns)
    display_cols = [
        "Currency", "Score %", "Spread (after fees)", "Gold Fee", "Fee %",
        "Volume (24h)", "Momentum", "Volatility", "Cluster", "Bid", "Ask", "Mid",
    ]

    # Color-code the score column
    st.dataframe(
        page_df[display_cols],
        use_container_width=True,
        hide_index=True,
        height=min(600, len(page_df) * 35 + 40),
    )

    # ------------------------------------------------------------------
    # Detail Panel (on selection)
    # ------------------------------------------------------------------
    _render_detail_panel(filtered, df, start_idx, end_idx, gold_to_chaos_rate)


# ---------------------------------------------------------------------------
# Detail Panel
# ---------------------------------------------------------------------------

def _render_detail_panel(
    opportunities: list[dict],
    df: pd.DataFrame,
    start_idx: int,
    end_idx: int,
    gold_to_chaos_rate: float | None,
) -> None:
    """Render a detail panel for the selected opportunity.

    Shows: fee breakdown, a simple price chart (if historical data available),
    and quick metrics.
    """
    # Let user select a currency pair for details
    page_currencies = df.iloc[start_idx:end_idx]["Currency"].tolist()
    if not page_currencies:
        return

    selected = st.selectbox(
        "Select pair for details",
        options=page_currencies,
        key="flips_detail_select",
    )

    if not selected:
        return

    # Find the opportunity
    opp = None
    for o in opportunities:
        if o.get("currency") == selected:
            opp = o
            break

    if opp is None:
        return

    # Detail cards
    detail_cols = st.columns(4)

    with detail_cols[0]:
        st.markdown("**Score Breakdown**")
        score = opp.get("score", 0)
        st.markdown(f"Score: **{fmt_score(score)}**")
        st.markdown(f"Spread after fees: **{fmt_spread(opp.get('spread_after_fees', 0))}**")
        st.markdown(f"Fee fraction: **{fmt_pct(opp.get('gold_fee_fraction', 0))}**")

    with detail_cols[1]:
        st.markdown("**Gold Fee**")
        gold_fee = opp.get("gold_fee_actual", 0)
        st.markdown(f"Total gold: **{fmt_gold(gold_fee)}**")
        if gold_to_chaos_rate is not None:
            st.markdown(f"In Chaos: **{gold_fee * gold_to_chaos_rate:.2f}**")
        st.markdown(f"Per unit: **{fmt_gold(gold_fee / max(opp.get('mid_price', 1), 0.001))}**")

    with detail_cols[2]:
        st.markdown("**Momentum**")
        momentum = opp.get("momentum", 0)
        vol = opp.get("volatility", 0)
        mom_color = "🟢" if momentum > 0 else "🔴" if momentum < 0 else "⚪"
        st.markdown(f"{mom_color} Momentum: **{fmt_momentum(momentum)}**")
        st.markdown(f"Volatility: **{vol:.4f}**")
        st.markdown(f"Cluster: **{opp.get('cluster', 'moderate')}**")

    with detail_cols[3]:
        st.markdown("**Volume**")
        volume = opp.get("volume_24h", 0)
        st.markdown(f"24h volume: **{fmt_number(volume)}**")
        st.markdown(f"Bid: **{fmt_rate(opp.get('bid', 0))}**")
        st.markdown(f"Ask: **{fmt_rate(opp.get('ask', 0))}**")

    # Simple price visualization (synthetic for M4 — real data comes from
    # the forecast tab in M7)
    st.markdown("**Price Estimate**")
    mid = opp.get("mid_price", 0)
    if mid > 0:
        # Show a simple gauge of the current price relative to bid/ask
        bid = opp.get("bid", 0)
        ask = opp.get("ask", 0)
        spread_total = ask - bid if ask > bid else 0.001

        fig = go.Figure()
        fig.add_trace(go.Indicator(
            mode="gauge+number",
            value=mid,
            domain={'x': [0.1, 0.9], 'y': [0, 1]},
            title={'text': f"Mid Price: {fmt_rate(mid)}"},
            gauge={
                'axis': {'range': [bid * 0.95, ask * 1.05]},
                'bar': {'color': COLOR_BLUE},
                'steps': [
                    {'range': [bid, mid], 'color': '#1a3a2a'},
                    {'range': [mid, ask], 'color': '#1a2a3a'},
                ],
                'threshold': {
                    'line': {'color': COLOR_ORANGE, 'width': 3},
                    'thickness': 0.8,
                    'value': mid,
                },
            },
        ))
        fig.update_layout(
            height=200,
            margin=dict(l=30, r=30, t=40, b=20),
            paper_bgcolor="rgba(0,0,0,0)",
            font=dict(color="#e2e8f0", size=11),
        )
        st.plotly_chart(fig, use_container_width=True)
