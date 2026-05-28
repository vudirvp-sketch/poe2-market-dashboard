"""
Currency Graph Tab — network visualization of currency trade pairs.

From spec §7.4:
- NetworkX graph rendered via plotly.
- Nodes = currencies, size = liquidity_score.
- Edges = trade pairs, width = volume_24h.
- Highlighted cycles = detected triangular arbitrage paths.
- Edge labels show effective rate after gold fee (direction-dependent).
- Click node -> focus on that currency's connections.
"""

from __future__ import annotations

from typing import Any

import networkx as nx
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from frontend.utils.formatters import (
    fmt_rate,
    fmt_number,
    fmt_pct,
    fmt_gold,
    fmt_currency_with_icon,
    score_color,
    COLOR_GREEN,
    COLOR_RED,
    COLOR_BLUE,
    COLOR_ORANGE,
    COLOR_GRAY,
)


# Cluster color mapping (matches spec §7.7 and formatters.py)
CLUSTER_COLORS = {
    "stable": COLOR_GREEN,
    "moderate": COLOR_BLUE,
    "volatile_illiquid": COLOR_RED,
}

# Default node size range
MIN_NODE_SIZE = 15
MAX_NODE_SIZE = 50


def render_graph_tab(
    rates_data: list[dict],
    opportunities: list[dict] | None = None,
    triangular: list[dict] | None = None,
    cluster_assignments: dict[str, str] | None = None,
    gold_to_chaos_rate: float | None = None,
    icon_urls: dict[str, str | None] | None = None,
) -> None:
    """Render the Currency Graph tab with an interactive network visualization.

    Args:
        rates_data: List of exchange rate dicts with keys:
            pair, currency_from, currency_to, raw_rate, volume_traded,
            fee_fraction, gold_fee_actual
        opportunities: List of flip opportunity dicts (optional, for node coloring)
        triangular: List of triangular arbitrage dicts (optional, for cycle highlighting)
        cluster_assignments: Dict mapping currency name -> cluster label string
        gold_to_chaos_rate: Current gold-to-chaos conversion rate
    """
    if not rates_data:
        st.info("No exchange rate data available for graph visualization.")
        return

    # Phase 2 (Spec §4): icon URL lookup
    icon_map = icon_urls or {}

    # ------------------------------------------------------------------
    # Build the graph
    # ------------------------------------------------------------------
    G = nx.DiGraph()

    # Track volumes per currency for node sizing
    currency_volumes: dict[str, float] = {}
    currency_count: dict[str, int] = {}

    # Build cluster lookup
    cluster_map = cluster_assignments or {}

    for r in rates_data:
        curr_from = r.get("currency_from", "")
        curr_to = r.get("currency_to", "")
        raw_rate = r.get("raw_rate", 0)
        volume = r.get("volume_traded", 0)
        fee_frac = r.get("fee_fraction", 0)

        if not curr_from or not curr_to or raw_rate <= 0:
            continue

        # Add nodes
        G.add_node(curr_from)
        G.add_node(curr_to)

        # Track volumes for node sizing
        currency_volumes[curr_from] = currency_volumes.get(curr_from, 0) + volume
        currency_volumes[curr_to] = currency_volumes.get(curr_to, 0) + volume
        currency_count[curr_from] = currency_count.get(curr_from, 0) + 1
        currency_count[curr_to] = currency_count.get(curr_to, 0) + 1

        # Compute effective rate after fee
        effective_rate = raw_rate * (1 - fee_frac) if fee_frac < 1 else raw_rate

        # Add edge with attributes
        G.add_edge(
            curr_from, curr_to,
            raw_rate=raw_rate,
            effective_rate=effective_rate,
            volume=volume,
            fee_fraction=fee_frac,
            # Edge label: effective rate
            label=f"{fmt_rate(effective_rate)} (fee: {fmt_pct(fee_frac)})",
        )

    if G.number_of_nodes() == 0:
        st.info("No trade pairs to visualize.")
        return

    # ------------------------------------------------------------------
    # Node focus selector
    # ------------------------------------------------------------------
    nodes_sorted = sorted(G.nodes())
    focus_options = ["All currencies"] + nodes_sorted
    selected_focus = st.selectbox(
        "Focus on currency:",
        options=focus_options,
        index=0,
        key="graph_focus_selector",
    )

    # If a specific currency is selected, show only its neighborhood
    if selected_focus != "All currencies":
        neighbors = set(G.successors(selected_focus)) | set(G.predecessors(selected_focus))
        neighbors.add(selected_focus)
        subgraph_nodes = neighbors
    else:
        subgraph_nodes = set(G.nodes())

    # For very large graphs, limit the display
    MAX_DISPLAY_NODES = 30
    if len(subgraph_nodes) > MAX_DISPLAY_NODES:
        # Keep the most connected nodes
        degrees = {n: G.degree(n) for n in subgraph_nodes}
        top_nodes = sorted(degrees.keys(), key=lambda n: degrees[n], reverse=True)[:MAX_DISPLAY_NODES]
        subgraph_nodes = set(top_nodes)

    subG = G.subgraph(subgraph_nodes)

    # ------------------------------------------------------------------
    # Layout (spring layout for nice visualization)
    # ------------------------------------------------------------------
    if subG.number_of_nodes() > 1:
        pos = nx.spring_layout(subG, k=2.5 / np.sqrt(subG.number_of_nodes()), seed=42)
    else:
        pos = {n: (0.5, 0.5) for n in subG.nodes()}

    # ------------------------------------------------------------------
    # Compute node sizes based on volume (liquidity)
    # ------------------------------------------------------------------
    max_vol = max(currency_volumes.values()) if currency_volumes else 1.0
    node_sizes = {}
    for n in subG.nodes():
        vol = currency_volumes.get(n, 0)
        if max_vol > 0:
            normalized_vol = vol / max_vol
        else:
            normalized_vol = 0.5
        node_sizes[n] = MIN_NODE_SIZE + normalized_vol * (MAX_NODE_SIZE - MIN_NODE_SIZE)

    # ------------------------------------------------------------------
    # Identify triangular arbitrage cycles for highlighting
    # ------------------------------------------------------------------
    cycle_edges: set[tuple[str, str]] = set()
    if triangular:
        for tri in triangular:
            cycle = tri.get("cycle", [])
            for i in range(len(cycle) - 1):
                edge = (cycle[i], cycle[i + 1])
                cycle_edges.add(edge)

    # ------------------------------------------------------------------
    # Build plotly traces
    # ------------------------------------------------------------------
    node_x = []
    node_y = []
    node_text = []
    node_color = []
    node_size_list = []

    for n in subG.nodes():
        x, y = pos[n]
        node_x.append(x)
        node_y.append(y)

        # Node color from cluster assignment
        cluster = cluster_map.get(n, "moderate")
        color = CLUSTER_COLORS.get(cluster, COLOR_GRAY)
        node_color.append(color)

        # Node size from volume
        size = node_sizes.get(n, MIN_NODE_SIZE)
        node_size_list.append(size)

        # Hover text — Phase 2 (Spec §4): include icon in hover if available
        vol = currency_volumes.get(n, 0)
        degree = G.degree(n)
        icon_url = icon_map.get(n)
        node_label = fmt_currency_with_icon(n, icon_url) if icon_url else f"<b>{n}</b>"
        node_text.append(
            f"{node_label}<br>"
            f"Cluster: {cluster.replace('_', ' ').title()}<br>"
            f"Volume: {fmt_number(vol)}<br>"
            f"Connections: {degree}"
        )

    # Edge traces
    edge_traces = []
    for u, v, data in subG.edges(data=True):
        x0, y0 = pos[u]
        x1, y1 = pos[v]

        # Determine if this edge is part of a detected cycle
        is_cycle_edge = (u, v) in cycle_edges

        # Edge width based on volume
        volume = data.get("volume", 0)
        max_edge_vol = max((d.get("volume", 0) for _, _, d in subG.edges(data=True)), default=1)
        edge_width = 1 + (volume / max(max_edge_vol, 1)) * 4 if max_edge_vol > 0 else 1

        # Edge color
        if is_cycle_edge:
            edge_color = COLOR_GREEN  # highlight arbitrage cycles
            edge_width = max(edge_width, 3)
        else:
            edge_color = "#475569"  # dark slate

        # Effective rate for edge label
        eff_rate = data.get("effective_rate", data.get("raw_rate", 0))
        fee_frac = data.get("fee_fraction", 0)

        # Arrow direction (annotate from midpoint)
        mid_x = (x0 + x1) / 2
        mid_y = (y0 + y1) / 2

        edge_traces.append(go.Scatter(
            x=[x0, x1, None],
            y=[y0, y1, None],
            mode='lines',
            line=dict(
                width=edge_width,
                color=edge_color,
            ),
            hoverinfo='text',
            hovertext=f"{u} → {v}<br>"
                      f"Rate: {fmt_rate(data.get('raw_rate', 0))}<br>"
                      f"Effective: {fmt_rate(eff_rate)}<br>"
                      f"Fee: {fmt_pct(fee_frac)}<br>"
                      f"Volume: {fmt_number(volume)}"
                      + (" 🔄 ARB CYCLE" if is_cycle_edge else ""),
            showlegend=False,
        ))

    # ------------------------------------------------------------------
    # Create the figure
    # ------------------------------------------------------------------
    fig = go.Figure()

    # Add edges first (below nodes)
    for trace in edge_traces:
        fig.add_trace(trace)

    # Add nodes
    fig.add_trace(go.Scatter(
        x=node_x,
        y=node_y,
        mode='markers+text',
        text=[n for n in subG.nodes()],
        textposition="top center",
        textfont=dict(color="#e2e8f0", size=9),
        marker=dict(
            size=node_size_list,
            color=node_color,
            line=dict(width=2, color="#1e293b"),
            opacity=0.9,
        ),
        hoverinfo='text',
        hovertext=node_text,
        showlegend=False,
    ))

    # Add cycle edge labels (annotations)
    if triangular:
        for tri in triangular:
            cycle = tri.get("cycle", [])
            profit_pct = tri.get("net_profit_pct", 0)
            if profit_pct > 0:
                # Find the midpoint of the cycle for the annotation
                cycle_nodes_in_subgraph = [n for n in cycle if n in subgraph_nodes]
                if len(cycle_nodes_in_subgraph) >= 2:
                    avg_x = np.mean([pos[n][0] for n in cycle_nodes_in_subgraph if n in pos])
                    avg_y = np.mean([pos[n][1] for n in cycle_nodes_in_subgraph if n in pos])
                    fig.add_annotation(
                        x=avg_x,
                        y=avg_y,
                        text=f"Arb: +{profit_pct:.2f}%",
                        showarrow=True,
                        arrowhead=2,
                        arrowsize=0.8,
                        arrowcolor=COLOR_GREEN,
                        font=dict(color=COLOR_GREEN, size=10),
                        bgcolor="rgba(15, 23, 42, 0.8)",
                        bordercolor=COLOR_GREEN,
                        borderwidth=1,
                    )

    fig.update_layout(
        title=dict(
            text="Currency Exchange Graph",
            font=dict(color="#e2e8f0", size=16),
        ),
        height=600,
        showlegend=False,
        hovermode='closest',
        margin=dict(b=20, l=20, r=20, t=50),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        xaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
        yaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
    )

    st.plotly_chart(fig, use_container_width=True)

    # ------------------------------------------------------------------
    # Cluster legend
    # ------------------------------------------------------------------
    st.markdown("#### Cluster Legend")
    legend_cols = st.columns(3)
    with legend_cols[0]:
        st.markdown(
            f"<div style='display:flex;align-items:center;gap:8px'>"
            f"<span style='width:12px;height:12px;background:{COLOR_GREEN};border-radius:50%;display:inline-block'></span>"
            f"<span style='color:#e2e8f0'>Stable — low volatility, high liquidity</span>"
            f"</div>",
            unsafe_allow_html=True,
        )
    with legend_cols[1]:
        st.markdown(
            f"<div style='display:flex;align-items:center;gap:8px'>"
            f"<span style='width:12px;height:12px;background:{COLOR_BLUE};border-radius:50%;display:inline-block'></span>"
            f"<span style='color:#e2e8f0'>Moderate — balanced profile</span>"
            f"</div>",
            unsafe_allow_html=True,
        )
    with legend_cols[2]:
        st.markdown(
            f"<div style='display:flex;align-items:center;gap:8px'>"
            f"<span style='width:12px;height:12px;background:{COLOR_RED};border-radius:50%;display:inline-block'></span>"
            f"<span style='color:#e2e8f0'>Volatile/Illiquid — high risk</span>"
            f"</div>",
            unsafe_allow_html=True,
        )

    # ------------------------------------------------------------------
    # Triangular arbitrage summary (if available)
    # ------------------------------------------------------------------
    if triangular:
        st.markdown("#### Detected Arbitrage Cycles")
        for i, tri in enumerate(triangular[:5]):  # show top 5
            cycle = tri.get("cycle", [])
            profit = tri.get("net_profit_pct", 0)
            step_rates = tri.get("step_rates", [])
            step_fees = tri.get("step_fees_fraction", [])

            cycle_str = " → ".join(cycle)

            with st.expander(f"Cycle {i + 1}: {profit:.2f}% profit — {cycle_str}"):
                # Show step-by-step details
                step_data = []
                for j in range(len(cycle) - 1):
                    step_data.append({
                        "From": cycle[j],
                        "To": cycle[j + 1],
                        "Rate": fmt_rate(step_rates[j]) if j < len(step_rates) else "—",
                        "Fee": fmt_pct(step_fees[j]) if j < len(step_fees) else "—",
                    })
                if step_data:
                    st.dataframe(
                        pd.DataFrame(step_data),
                        use_container_width=True,
                        hide_index=True,
                    )
                st.metric("Net Profit", f"+{profit:.2f}%")

    # ------------------------------------------------------------------
    # Graph statistics
    # ------------------------------------------------------------------
    st.markdown("#### Graph Statistics")
    stats_cols = st.columns(4)
    with stats_cols[0]:
        st.metric("Currencies", value=str(G.number_of_nodes()))
    with stats_cols[1]:
        st.metric("Trade Pairs", value=str(G.number_of_edges()))
    with stats_cols[2]:
        density = nx.density(G) if G.number_of_nodes() > 1 else 0
        st.metric("Graph Density", value=f"{density:.3f}")
    with stats_cols[3]:
        n_cycles = len(triangular) if triangular else 0
        st.metric("Arb Cycles", value=str(n_cycles))
