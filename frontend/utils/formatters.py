"""
Formatting helpers for the Streamlit dashboard.

Centralizes all number formatting, color mapping, and display logic
so that components stay clean and consistent.
"""

from __future__ import annotations

from typing import Optional


# ---------------------------------------------------------------------------
# Number formatting
# ---------------------------------------------------------------------------

def fmt_pct(value: float, decimals: int = 2) -> str:
    """Format a value as percentage string. E.g. 0.053 → '5.30%'"""
    return f"{value * 100:.{decimals}f}%"


def fmt_number(value: float, decimals: int = 2) -> str:
    """Format a number with thousands separator."""
    if abs(value) >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if abs(value) >= 1_000:
        return f"{value / 1_000:.1f}K"
    return f"{value:.{decimals}f}"


def fmt_gold(value: float) -> str:
    """Format gold amount with emoji."""
    if abs(value) >= 1_000_000:
        return f"{value / 1_000_000:.1f}M gold"
    if abs(value) >= 1_000:
        return f"{value / 1_000:.1f}K gold"
    return f"{value:.0f} gold"


def fmt_rate(value: float, decimals: int = 4) -> str:
    """Format an exchange rate."""
    if value == 0:
        return "—"
    if abs(value) >= 100:
        return f"{value:.2f}"
    if abs(value) >= 1:
        return f"{value:.{decimals}f}"
    return f"{value:.{decimals + 2}f}"


def fmt_score(value: float) -> str:
    """Format a score (0-1) as percentage."""
    return f"{value * 100:.1f}%"


def fmt_momentum(value: float) -> str:
    """Format momentum with direction indicator."""
    if value > 0.001:
        return f"+{value:.4f}"
    elif value < -0.001:
        return f"{value:.4f}"
    else:
        return f"{value:.4f}"


def fmt_spread(value: float) -> str:
    """Format spread after fees."""
    if value <= 0:
        return f"{value * 100:.2f}% (no profit)"
    return f"+{value * 100:.2f}%"


def fmt_timestamp(iso_str: str | None) -> str:
    """Format an ISO timestamp for display."""
    if not iso_str:
        return "—"
    try:
        # Extract just the date and time part
        if "T" in iso_str:
            parts = iso_str.split("T")
            date_part = parts[0]
            time_part = parts[1][:8] if len(parts) > 1 else ""
            return f"{date_part} {time_part}"
        return iso_str[:19]
    except Exception:
        return iso_str[:19] if len(iso_str) > 19 else iso_str


def fmt_currency_with_icon(currency_name: str, icon_url: str | None = None) -> str:
    """Format a currency name with an optional icon."""
    display_name = currency_name.replace("_", " ").title()
    if icon_url:
        return f"<img src='{icon_url}' style='height:16px;width:16px;vertical-align:middle;margin-right:4px'>{display_name}"
    return display_name


# ---------------------------------------------------------------------------
# Color mapping (from spec section 7.7)
# ---------------------------------------------------------------------------

# Spec colors
COLOR_GREEN = "#22c55e"
COLOR_RED = "#ef4444"
COLOR_BLUE = "#3b82f6"
COLOR_ORANGE = "#f97316"
COLOR_GRAY = "#6b7280"


def score_color(score: float) -> str:
    """Return a color based on opportunity score (0-1)."""
    if score >= 0.7:
        return COLOR_GREEN
    elif score >= 0.4:
        return COLOR_BLUE
    elif score >= 0.2:
        return COLOR_ORANGE
    else:
        return COLOR_GRAY


def momentum_color(momentum: float) -> str:
    """Return a color based on momentum direction."""
    if momentum > 0.001:
        return COLOR_GREEN
    elif momentum < -0.001:
        return COLOR_RED
    return COLOR_GRAY


def phase_color(phase: str) -> str:
    """Return a color for the league phase badge."""
    if phase == "early":
        return COLOR_ORANGE
    elif phase == "mid":
        return COLOR_BLUE
    elif phase == "late":
        return COLOR_GRAY
    return COLOR_GRAY


def phase_emoji(phase: str) -> str:
    """Return an emoji for the league phase."""
    if phase == "early":
        return "🔥"
    elif phase == "mid":
        return "⚖️"
    elif phase == "late":
        return "🏦"
    return "❓"


def direction_arrow(value: float) -> str:
    """Return an arrow based on direction of change."""
    if value > 0.001:
        return "📈"
    elif value < -0.001:
        return "📉"
    return "➡️"


def cluster_display(cluster: str) -> tuple[str, str]:
    """Return a display-friendly cluster label with color."""
    labels = {
        "stable": ("Stable", COLOR_GREEN),
        "moderate": ("Moderate", COLOR_BLUE),
        "volatile_illiquid": ("Volatile/Illiquid", COLOR_RED),
    }
    return labels.get(cluster, (cluster.title(), COLOR_GRAY))


# ---------------------------------------------------------------------------
# Event display helpers (Milestone 9)
# ---------------------------------------------------------------------------

def event_type_display(event_type: str) -> tuple[str, str]:
    """Return a display-friendly event type label with icon.

    Returns:
        Tuple of (label, icon_emoji)
    """
    mapping = {
        "major_patch": ("Major Patch", "🔴"),
        "minor_patch": ("Minor Patch", "🟡"),
        "streamer_hype": ("Streamer Hype", "🟠"),
        "other": ("Other Event", "⚪"),
    }
    return mapping.get(event_type, (event_type.replace("_", " ").title(), "⚠️"))


def event_severity_color(event_type: str) -> str:
    """Return a color based on event severity.

    Major patches are most severe (red), streamer hype is moderate (orange),
    minor patches and other events are less severe (yellow/gray).
    """
    severity = {
        "major_patch": COLOR_RED,
        "minor_patch": COLOR_ORANGE,
        "streamer_hype": COLOR_ORANGE,
        "other": COLOR_GRAY,
    }
    return severity.get(event_type, COLOR_GRAY)


def fmt_event_status(any_active: bool, affected_currencies: list[str] | None = None) -> str:
    """Format event status for display in the overview.

    Args:
        any_active: Whether any event is currently active
        affected_currencies: List of affected currency API IDs

    Returns:
        Human-readable status string
    """
    if not any_active:
        return "No active events"

    if affected_currencies:
        curr_list = ", ".join(c.replace("_", " ").title() for c in affected_currencies[:5])
        if len(affected_currencies) > 5:
            curr_list += f" +{len(affected_currencies) - 5} more"
        return f"Events active — affecting: {curr_list}"

    return "Events active — all currencies affected"
