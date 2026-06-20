"""
League Phase Detection — PhaseDetector.

From PoE2_Flipper_Canonical_Formulas.md §1 + §6:

    days_since_reference = floor((current_utc_timestamp - reference_timestamp) / 86400)
    reference_timestamp = last_major_patch_timestamp if a major_patch event
                          has been registered, else league_start_timestamp

    if days_since_reference ≤ phase_early_days: → EARLY
    elif days_since_reference ≤ phase_mid_days: → MID
    else:                                        → LATE

Defaults: phase_early_days=14, phase_mid_days=42

Phase boundaries are not purely day-based. A major patch event can reset
the phase clock. The system accepts an external event flag (set manually
via API/UI) that reclassifies the current phase.

P0-4 fix: previously the formula used `max(league_start, last_major_patch)`,
which silently ignored major_patch events that shipped before league_start
(the typical preview-patch scenario). Per §6, an explicit major_patch reset
must ALWAYS take precedence — see `_reference_date`.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from backend.config import AppConfig, get_settings
from backend.models.currency import LeaguePhase, LeagueType, PhaseInfo


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

    The reference date is the last major patch timestamp if a major_patch
    reset has been registered (via `reset_for_major_patch`), else the league
    start timestamp. See `_reference_date` for the P0-4 fix rationale.
    """

    def __init__(
        self,
        league_start: datetime,
        config: AppConfig | None = None,
        league_type: LeagueType = LeagueType.STANDARD,
    ):
        self._league_start = league_start
        self._config = config or get_settings()
        self._patch_reset_date: datetime | None = None
        # FIX: Track league type for proper phase multiplier calculation
        self._league_type = league_type

    @property
    def patch_reset_date(self) -> datetime | None:
        return self._patch_reset_date

    @patch_reset_date.setter
    def patch_reset_date(self, value: datetime | None) -> None:
        """Set the patch reset date. Set to None to clear it."""
        self._patch_reset_date = value

    def _reference_date(self) -> datetime:
        """The reference date — last major patch if set, else league start.

        P0-4 fix: previously returned `max(league_start, patch_reset_date)`.
        That broke the major_patch reset contract when a patch shipped BEFORE
        league_start (typical preview-patch scenario): league_start won the
        `max()`, the reset was silently ignored, and the phase stayed LATE
        instead of resetting to EARLY. Per PoE2_Flipper_Canonical_Formulas.md
        §6 ("Only major_patch events reset the PhaseDetector reference date"),
        an explicit `reset_for_major_patch()` call must ALWAYS reset the
        reference — even if the patch timestamp predates league_start.
        """
        if self._patch_reset_date is not None:
            return self._patch_reset_date
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

    def get_league_type(self) -> LeagueType:
        """Return the league type (standard, flashback, event)."""
        return self._league_type

    def set_league_type(self, league_type: LeagueType) -> None:
        """Set the league type. Call this when the league type is known."""
        self._league_type = league_type

    def get_phase_multiplier(self, now: datetime | None = None) -> float:
        """Get the combined phase + league type multiplier for scoring.

        FIX: Added to properly compute phase multiplier with league type.
        Previously, scorer.py only used EARLY/MID/LATE multipliers and
        ignored flashback/event leagues entirely.

        Multipliers by league type (from Data Flow Reference §5.2.4):
            standard: EARLY=1.2, MID=1.0, LATE=0.9
            flashback: base * flashback_multiplier (default 1.5)
            event: base * event_multiplier (default 2.0)
        """
        phase = self.current_phase(now)
        base_multipliers = {
            LeaguePhase.EARLY: self._config.scoring.phase_multiplier_early,
            LeaguePhase.MID: self._config.scoring.phase_multiplier_mid,
            LeaguePhase.LATE: self._config.scoring.phase_multiplier_late,
        }
        base = base_multipliers[phase]

        # League type multipliers (stack on top of base phase)
        type_multipliers = {
            LeagueType.STANDARD: 1.0,
            LeagueType.FLASHBACK: self._config.scoring.flashback_multiplier,
            LeagueType.EVENT: self._config.scoring.event_multiplier,
        }
        return base * type_multipliers[self._league_type]

    def reset_for_major_patch(self, patch_datetime: datetime) -> None:
        """Reset the phase clock for a major patch event.

        From Implementation Spec §6 (Events):
        If event_type == "major_patch", the PhaseDetector resets its
        reference date to the event timestamp.
        """
        self.patch_reset_date = patch_datetime
