"""
League Phase Detection — PhaseDetector.

From PoE2_Flipper_Canonical_Formulas.md §1:

    days_since_reference = floor((current_utc_timestamp - reference_timestamp) / 86400)
    reference_timestamp = max(league_start_timestamp, last_major_patch_timestamp)

    if days_since_reference ≤ phase_early_days: → EARLY
    elif days_since_reference ≤ phase_mid_days: → MID
    else:                                        → LATE

Defaults: phase_early_days=7, phase_mid_days=35

Phase boundaries are not purely day-based. A major patch event can reset
the phase clock. The system accepts an external event flag (set manually
via API/UI) that reclassifies the current phase.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from backend.config import AppConfig, get_settings
from backend.models.currency import LeaguePhase, PhaseInfo


# Phase strategy table from Implementation Spec §3.1
_PHASE_STRATEGIES = {
    LeaguePhase.EARLY: {
        "recommended_strategy": "Quick flips, focus on Chaos/Exalted",
        "min_spread_after_fees": 0.15,  # 15%
        "max_hold_time": "2 hours",
        "reference_currency": "exalted",
    },
    LeaguePhase.MID: {
        "recommended_strategy": "Triangular arb",
        "min_spread_after_fees": 0.05,  # 5%
        "max_hold_time": "24 hours",
        "reference_currency": "divine",
    },
    LeaguePhase.LATE: {
        "recommended_strategy": "Portfolio holding (risk parity)",
        "min_spread_after_fees": 0.03,  # 3% expected return / 72h
        "max_hold_time": "72+ hours",
        "reference_currency": "divine",
    },
}


class PhaseDetector:
    """Detects the current league phase based on time since reference date.

    The reference date is the later of league start or last major patch.
    """

    def __init__(
        self,
        league_start: datetime,
        config: AppConfig | None = None,
    ):
        self._league_start = league_start
        self._config = config or get_settings()
        self._patch_reset_date: datetime | None = None

    @property
    def patch_reset_date(self) -> datetime | None:
        return self._patch_reset_date

    @patch_reset_date.setter
    def patch_reset_date(self, value: datetime | None) -> None:
        """Set the patch reset date. Set to None to clear it."""
        self._patch_reset_date = value

    def _reference_date(self) -> datetime:
        """The reference date is max(league_start, last_major_patch)."""
        if self._patch_reset_date is not None:
            return max(self._league_start, self._patch_reset_date)
        return self._league_start

    def days_since_reference(self, now: datetime | None = None) -> int:
        """Compute days since the reference date.

        Formula from Canonical Formulas §1:
            days_since_reference = floor((current - reference) / 86400)
        """
        current = now or datetime.now(timezone.utc)
        reference = self._reference_date()

        # Ensure both datetimes are timezone-aware for correct subtraction
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        if reference.tzinfo is None:
            reference = reference.replace(tzinfo=timezone.utc)

        delta = current - reference
        return max(0, math.floor(delta.total_seconds() / 86400))

    def current_phase(self, now: datetime | None = None) -> LeaguePhase:
        """Determine the current league phase.

        From Canonical Formulas §1:
            if days_since_reference ≤ phase_early_days: → EARLY
            elif days_since_reference ≤ phase_mid_days: → MID
            else:                                        → LATE
        """
        days = self.days_since_reference(now)
        early_days = self._config.league.phase_early_days
        mid_days = self._config.league.phase_mid_days

        if days <= early_days:
            return LeaguePhase.EARLY
        elif days <= mid_days:
            return LeaguePhase.MID
        else:
            return LeaguePhase.LATE

    def get_phase_info(self, now: datetime | None = None) -> PhaseInfo:
        """Get detailed phase information including strategy recommendations."""
        phase = self.current_phase(now)
        days = self.days_since_reference(now)
        strategy = _PHASE_STRATEGIES[phase]

        return PhaseInfo(
            phase=phase,
            days_since_reference=days,
            reference_currency=strategy["reference_currency"],
            recommended_strategy=strategy["recommended_strategy"],
            min_spread_after_fees=strategy["min_spread_after_fees"],
            max_hold_time=strategy["max_hold_time"],
        )

    def reset_for_major_patch(self, patch_datetime: datetime) -> None:
        """Reset the phase clock for a major patch event.

        From Implementation Spec §6 (Events):
        If event_type == "major_patch", the PhaseDetector resets its
        reference date to the event timestamp.
        """
        self.patch_reset_date = patch_datetime
