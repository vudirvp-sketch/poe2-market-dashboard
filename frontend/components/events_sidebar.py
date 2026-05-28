"""
Events Sidebar — manual event flagging UI for the PoE2 Flipper dashboard.

From spec section 6:
Events are flagged manually by the user via API/UI. This component provides:
- Create event form (event type, description, affected currencies, expiry)
- List of active events with deactivation/delete buttons
- Event effects summary

This is displayed in a Streamlit sidebar section.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
import streamlit as st

from frontend.utils.formatters import (
    fmt_timestamp,
    event_type_display,
    event_severity_color,
    COLOR_ORANGE,
    COLOR_RED,
    COLOR_GRAY,
    COLOR_GREEN,
)

logger = logging.getLogger(__name__)


def render_events_sidebar(api_base_url: str = "http://localhost:8000") -> dict | None:
    """Render the event management section in the sidebar.

    This should be called from app.py inside a sidebar block.

    Args:
        api_base_url: Base URL of the FastAPI backend

    Returns:
        Dict with active event summary if any events are active, else None
    """
    active_event_summary = None

    # ---------------------------------------------------------------
    # Fetch current events
    # ---------------------------------------------------------------
    events_data = None
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"{api_base_url}/api/events", params={"active_only": True})
            if resp.status_code == 200:
                events_data = resp.json()
    except Exception:
        pass  # Backend may not be running; form still works

    if events_data and events_data.get("events"):
        active_event_summary = events_data["events"][0] if events_data["events"] else None
        # Build a summary for the sticky bar
        if active_event_summary:
            summary_for_bar = {
                "event_type": active_event_summary.get("event_type", "other"),
                "description": active_event_summary.get("description", ""),
                "affected_currencies": active_event_summary.get("affected_currencies", []),
                "expires_at": active_event_summary.get("expires_at"),
                "total_active_events": events_data.get("total", 1),
            }
            active_event_summary = summary_for_bar

    # ---------------------------------------------------------------
    # Active Events Display
    # ---------------------------------------------------------------
    st.markdown("#### Active Events")

    if events_data and events_data.get("total", 0) > 0:
        for event in events_data["events"]:
            event_type = event.get("event_type", "other")
            event_label, event_icon = event_type_display(event_type)
            severity = event_severity_color(event_type)
            desc = event.get("description", "")
            expires = event.get("expires_at")
            event_id = event.get("event_id", "")
            affected = event.get("affected_currencies", [])

            with st.container():
                st.markdown(
                    f"<div style='background:#1e2533;padding:0.5em 0.8em;border-radius:6px;"
                    f"border-left:3px solid {severity};margin-bottom:0.5em'>"
                    f"<span style='font-weight:bold;color:{severity}'>{event_icon} {event_label}</span><br>"
                    f"<span style='font-size:0.85em'>{desc}</span><br>"
                    f"<span style='font-size:0.75em;color:{COLOR_GRAY}'>"
                    f"Expires: {fmt_timestamp(expires) if expires else 'Never'}</span>",
                    unsafe_allow_html=True,
                )

                if affected:
                    affected_str = ", ".join(
                        c.replace("_", " ").title() for c in affected[:5]
                    )
                    if len(affected) > 5:
                        affected_str += f" +{len(affected) - 5}"
                    st.caption(f"Affects: {affected_str}")

                # Deactivate / Delete buttons
                col_a, col_b = st.columns(2)
                with col_a:
                    if st.button("Deactivate", key=f"deact_{event_id}"):
                        try:
                            with httpx.Client(timeout=5.0) as client:
                                resp = client.post(
                                    f"{api_base_url}/api/events/{event_id}/deactivate"
                                )
                                if resp.status_code == 200:
                                    st.success("Event deactivated")
                                    st.rerun()
                        except Exception as e:
                            st.error(f"Failed: {e}")

                with col_b:
                    if st.button("Delete", key=f"del_{event_id}"):
                        try:
                            with httpx.Client(timeout=5.0) as client:
                                resp = client.delete(
                                    f"{api_base_url}/api/events/{event_id}"
                                )
                                if resp.status_code == 200:
                                    st.success("Event deleted")
                                    st.rerun()
                        except Exception as e:
                            st.error(f"Failed: {e}")
    else:
        st.caption("No active events")

    # ---------------------------------------------------------------
    # Create Event Form
    # ---------------------------------------------------------------
    st.markdown("---")
    st.markdown("#### Flag New Event")

    with st.form("create_event_form"):
        event_type = st.selectbox(
            "Event Type",
            options=["major_patch", "minor_patch", "streamer_hype", "other"],
            index=1,
            help="Major patch: resets phase clock. Minor patch: moderate impact. "
                 "Streamer hype: temporary surge. Other: generic event.",
        )

        description = st.text_input(
            "Description",
            placeholder="e.g. Patch 0.3.0 released with new currency items",
            max_chars=500,
        )

        affected_currencies = st.text_input(
            "Affected Currencies (comma-separated API IDs)",
            placeholder="e.g. divine, exalted, chaos (leave empty for all)",
            help="Leave empty to apply penalty to all currencies. "
                 "Specify currency API IDs to exclude only those from scoring.",
        )

        expiry_hours = st.number_input(
            "Expiry (hours)",
            min_value=1,
            max_value=168,
            value=48,
            help="How long until the event auto-expires",
        )

        submitted = st.form_submit_button("Create Event")

        if submitted:
            if not description.strip():
                st.error("Description is required")
            else:
                # Parse affected currencies
                currencies = []
                if affected_currencies.strip():
                    currencies = [
                        c.strip().lower()
                        for c in affected_currencies.split(",")
                        if c.strip()
                    ]

                # Create event via API
                payload = {
                    "event_type": event_type,
                    "description": description.strip(),
                    "affected_currencies": currencies,
                }

                try:
                    with httpx.Client(timeout=5.0) as client:
                        resp = client.post(
                            f"{api_base_url}/api/events",
                            json=payload,
                        )
                        if resp.status_code == 200:
                            result = resp.json()
                            st.success(
                                f"Event created: {result['event']['event_type']} "
                                f"(ID: {result['event']['event_id']})"
                            )
                            st.rerun()
                        else:
                            st.error(f"Failed to create event: {resp.text}")
                except httpx.ConnectError:
                    st.error(
                        "Cannot connect to backend. Start it with: "
                        "`uvicorn backend.main:app --reload`"
                    )
                except Exception as e:
                    st.error(f"Error creating event: {e}")

    return active_event_summary
