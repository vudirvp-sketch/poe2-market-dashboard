"""
Sticky Bar — top alert bar for the PoE2 Flipper dashboard.

From spec section 7.1, the sticky bar shows:
- Best flip opportunity (max score)
- 24h trend (sparkline + direction arrow)
- Active hype/anomaly alert (if any)
- Best triangular cycle (net profit %)
- Active event warning (if any)
- Current league phase badge
"""

from __future__ import annotations

from typing import Any, Optional

import streamlit as st

from frontend.utils.formatters import (
    fmt_score,
    fmt_pct,
    fmt_gold,
    fmt_number,
    score_color,
    momentum_color,
    phase_color,
    phase_emoji,
    direction_arrow,
    event_type_display,
    COLOR_GREEN,
    COLOR_RED,
    COLOR_BLUE,
    COLOR_ORANGE,
    COLOR_GRAY,
)


def render_sticky_bar(
    best_flip: dict | None = None,
    trend_24h: float | None = None,
    best_triangular: dict | None = None,
    active_event: dict | None = None,
    phase_info: dict | None = None,
    gold_to_chaos_rate: float | None = None,
) -> None:
    """Render the top sticky bar with key metrics and alerts.

    Args:
        best_flip: Dict with 'currency', 'score', 'spread_after_fees', 'gold_fee_actual'
        trend_24h: 24h trend as a float (positive = up, negative = down)
        best_triangular: Dict with 'cycle', 'net_profit_pct'
        active_event: Dict with 'event_type', 'description' if an event is active
        phase_info: Dict with 'phase', 'recommended_strategy', 'reference_currency'
        gold_to_chaos_rate: Current gold-to-chaos conversion rate
    """
    # Build columns for the bar
    col_count = 5
    cols = st.columns(col_count)

    # --- Column 1: Phase Badge ---
    with cols[0]:
        if phase_info:
            phase = phase_info.get("phase", "unknown")
            phase_label = phase.upper()
            emoji = phase_emoji(phase)
            ref_curr = phase_info.get("reference_currency", "exalted").title()

            st.markdown(
                f"<div style='text-align:center'>"
                f"<span style='font-size:1.4em'>{emoji}</span><br>"
                f"<span style='color:{phase_color(phase)};font-weight:bold;font-size:1.1em'>"
                f"{phase_label}</span><br>"
                f"<span style='font-size:0.8em;color:{COLOR_GRAY}'>Ref: {ref_curr}</span>"
                f"</div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                "<div style='text-align:center;color:#6b7280'>Phase: —</div>",
                unsafe_allow_html=True,
            )

    # --- Column 2: Best Flip ---
    with cols[1]:
        if best_flip:
            currency = best_flip.get("currency", "—")
            score = best_flip.get("score", 0)
            spread = best_flip.get("spread_after_fees", 0)
            gold_fee = best_flip.get("gold_fee_actual", 0)

            st.markdown(
                f"<div style='text-align:center'>"
                f"<span style='font-size:0.85em;color:{COLOR_GRAY}'>Best Flip</span><br>"
                f"<span style='font-weight:bold;font-size:1.1em;color:{score_color(score)}'>"
                f"{currency}</span><br>"
                f"<span style='font-size:0.85em'>Score: {fmt_score(score)} | "
                f"Spread: {fmt_pct(spread)} | Fee: {fmt_gold(gold_fee)}</span>"
                f"</div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                "<div style='text-align:center;color:#6b7280'>Best Flip: —</div>",
                unsafe_allow_html=True,
            )

    # --- Column 3: 24h Trend ---
    with cols[2]:
        if trend_24h is not None:
            arrow = direction_arrow(trend_24h)
            trend_color = COLOR_GREEN if trend_24h > 0 else COLOR_RED if trend_24h < 0 else COLOR_GRAY
            sign = "+" if trend_24h > 0 else ""

            st.markdown(
                f"<div style='text-align:center'>"
                f"<span style='font-size:0.85em;color:{COLOR_GRAY}'>24h Trend</span><br>"
                f"<span style='font-size:1.4em'>{arrow}</span><br>"
                f"<span style='font-weight:bold;font-size:1.1em;color:{trend_color}'>"
                f"{sign}{trend_24h * 100:.2f}%</span>"
                f"</div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                "<div style='text-align:center;color:#6b7280'>24h Trend: —</div>",
                unsafe_allow_html=True,
            )

    # --- Column 4: Best Triangular ---
    with cols[3]:
        if best_triangular and best_triangular.get("net_profit_pct", 0) > 0:
            cycle = best_triangular.get("cycle", [])
            profit = best_triangular["net_profit_pct"]
            cycle_str = " → ".join(c.title() if isinstance(c, str) else str(c) for c in cycle)

            st.markdown(
                f"<div style='text-align:center'>"
                f"<span style='font-size:0.85em;color:{COLOR_GRAY}'>Triangular Arb</span><br>"
                f"<span style='font-weight:bold;font-size:1.1em;color:{COLOR_GREEN}'>"
                f"+{profit:.2f}%</span><br>"
                f"<span style='font-size:0.75em;color:{COLOR_GRAY}'>{cycle_str}</span>"
                f"</div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                "<div style='text-align:center;color:#6b7280'>Triangular Arb: None</div>",
                unsafe_allow_html=True,
            )

    # --- Column 5: Event Warning / Gold Rate ---
    with cols[4]:
        if active_event:
            event_type = active_event.get("event_type", "other")
            desc = active_event.get("description", "")
            total_events = active_event.get("total_active_events", 1)
            event_label, event_icon = event_type_display(event_type)

            # Truncate description for display
            short_desc = desc[:40] + "..." if len(desc) > 40 else desc

            # Pulsing warning style
            extra_badge = ""
            if total_events > 1:
                extra_badge = f" <span style='background:{COLOR_ORANGE};color:#fff;border-radius:8px;padding:0 6px;font-size:0.7em'>+{total_events - 1}</span>"

            st.markdown(
                f"<div style='text-align:center'>"
                f"<span style='font-size:0.85em;color:{COLOR_ORANGE}'>{event_icon} Event Active</span><br>"
                f"<span style='font-weight:bold;color:{COLOR_ORANGE}'>{event_label}</span>"
                f"{extra_badge}<br>"
                f"<span style='font-size:0.75em;color:{COLOR_GRAY}'>{short_desc}</span>"
                f"</div>",
                unsafe_allow_html=True,
            )
        elif gold_to_chaos_rate is not None:
            st.markdown(
                f"<div style='text-align:center'>"
                f"<span style='font-size:0.85em;color:{COLOR_GRAY}'>Gold Rate</span><br>"
                f"<span style='font-weight:bold;font-size:1.1em;color:{COLOR_BLUE}'>"
                f"{gold_to_chaos_rate:.4f}</span><br>"
                f"<span style='font-size:0.75em;color:{COLOR_GRAY}'>Chaos/gold</span>"
                f"</div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                "<div style='text-align:center;color:#6b7280'>No active events</div>",
                unsafe_allow_html=True,
            )

    # Thin separator line
    st.markdown(
        "<hr style='margin:0.5em 0;border:1px solid #2d3748'>",
        unsafe_allow_html=True,
    )
