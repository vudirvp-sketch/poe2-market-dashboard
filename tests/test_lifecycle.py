"""
Tests for lifecycle.py — PhaseDetector.

From PoE2_Flipper_Canonical_Formulas.md §1:
    Set league_start = 2025-01-15T00:00:00Z, current = 2025-01-20T12:00:00Z → days_since = 5 → EARLY
    Set current = 2025-02-01T00:00:00Z → days_since = 17 → MID
    Set current = 2025-03-10T00:00:00Z → days_since = 54 → LATE
"""

from datetime import datetime, timezone

import pytest

from backend.economy.lifecycle import PhaseDetector
from backend.models.currency import LeaguePhase
from backend.config import AppConfig, LeagueConfig


def _make_config(early_days=7, mid_days=35) -> AppConfig:
    """Create a config with custom phase boundaries."""
    return AppConfig(league=LeagueConfig(
        phase_early_days=early_days,
        phase_mid_days=mid_days,
    ))


class TestPhaseDetection:
    """Test phase detection from Canonical Formulas §1 Verification."""

    def setup_method(self):
        self.league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        self.config = _make_config()
        self.detector = PhaseDetector(self.league_start, self.config)

    def test_early_phase(self):
        """5 days since reference → EARLY."""
        now = datetime(2025, 1, 20, 12, 0, 0, tzinfo=timezone.utc)
        assert self.detector.current_phase(now) == LeaguePhase.EARLY

    def test_mid_phase(self):
        """17 days since reference → MID."""
        now = datetime(2025, 2, 1, 0, 0, 0, tzinfo=timezone.utc)
        assert self.detector.current_phase(now) == LeaguePhase.MID

    def test_late_phase(self):
        """54 days since reference → LATE."""
        now = datetime(2025, 3, 10, 0, 0, 0, tzinfo=timezone.utc)
        assert self.detector.current_phase(now) == LeaguePhase.LATE

    def test_exact_boundary_early_to_mid(self):
        """At exactly phase_early_days, still EARLY (≤)."""
        # Day 7 (0-indexed from start): still EARLY
        now = datetime(2025, 1, 22, 0, 0, 0, tzinfo=timezone.utc)
        assert self.detector.days_since_reference(now) == 7
        assert self.detector.current_phase(now) == LeaguePhase.EARLY

        # Day 8: now MID
        now = datetime(2025, 1, 23, 0, 0, 0, tzinfo=timezone.utc)
        assert self.detector.current_phase(now) == LeaguePhase.MID

    def test_exact_boundary_mid_to_late(self):
        """At exactly phase_mid_days, still MID (≤)."""
        now = datetime(2025, 2, 19, 0, 0, 0, tzinfo=timezone.utc)
        assert self.detector.days_since_reference(now) == 35
        assert self.detector.current_phase(now) == LeaguePhase.MID

        now = datetime(2025, 2, 20, 0, 0, 0, tzinfo=timezone.utc)
        assert self.detector.current_phase(now) == LeaguePhase.LATE

    def test_from_spec_test_requirements(self):
        """
        From Implementation Spec §10:
        Given league start + 10 days → verify phase=MID
        """
        now = datetime(2025, 1, 25, 0, 0, 0, tzinfo=timezone.utc)
        assert self.detector.days_since_reference(now) == 10
        assert self.detector.current_phase(now) == LeaguePhase.MID


class TestPatchReset:
    """Test that major patch events reset the phase clock."""

    def test_patch_resets_phase(self):
        """A major patch on day 20 should reset reference date."""
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        config = _make_config()
        detector = PhaseDetector(league_start, config)

        # Day 40 → LATE (40 > 35)
        now = datetime(2025, 2, 24, 0, 0, 0, tzinfo=timezone.utc)
        assert detector.current_phase(now) == LeaguePhase.LATE

        # Major patch on day 20 (Feb 4)
        patch_date = datetime(2025, 2, 4, 0, 0, 0, tzinfo=timezone.utc)
        detector.reset_for_major_patch(patch_date)

        # Now: days since patch = 20 → MID (20 ≤ 35)
        assert detector.current_phase(now) == LeaguePhase.MID

    def test_major_patch_resets_even_if_before_league_start(self):
        """A major_patch event BEFORE league_start must STILL reset the reference.

        P0-4 regression: previously `_reference_date` did
        `max(league_start, patch_reset_date)`, so a preview-patch shipped
        a few days before league_start would lose the `max()` and the
        phase would NOT reset — silently staying LATE instead of going
        back to EARLY. Per PoE2_Flipper_Canonical_Formulas.md §6, an
        explicit `reset_for_major_patch()` call must ALWAYS take
        precedence, regardless of relative ordering.

        Setup:
            - league_start = 2025-01-15
            - patch_date   = 2025-01-01 (BEFORE league_start)
            - now          = 2025-01-20

        OLD (buggy): reference = max(01-15, 01-01) = 01-15 → days_since=5 → EARLY
                     (the patch was ignored; phase based on league_start)
        NEW (fixed) : reference = 01-01 (patch wins) → days_since=19 → MID
        """
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        config = _make_config()  # phase_early_days=7, phase_mid_days=35
        detector = PhaseDetector(league_start, config)

        old_patch = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        detector.reset_for_major_patch(old_patch)

        # Reference should now be the patch date (2025-01-01), NOT league_start.
        now = datetime(2025, 1, 20, 0, 0, 0, tzinfo=timezone.utc)
        # Days since 2025-01-01 = 19 → MID (7 < 19 ≤ 35)
        assert detector.days_since_reference(now) == 19
        assert detector.current_phase(now) == LeaguePhase.MID


class TestPhaseInfo:
    """Test PhaseInfo includes strategy recommendations."""

    def test_early_phase_info(self):
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        detector = PhaseDetector(league_start, _make_config())

        now = datetime(2025, 1, 17, 0, 0, 0, tzinfo=timezone.utc)
        info = detector.get_phase_info(now)

        assert info.phase == LeaguePhase.EARLY
        assert info.reference_currency == "exalted"
        assert info.min_spread_after_fees == 0.15
        assert info.recommended_strategy == "Quick flips, focus on Chaos/Exalted"

    def test_late_phase_info(self):
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        detector = PhaseDetector(league_start, _make_config())

        now = datetime(2025, 3, 15, 0, 0, 0, tzinfo=timezone.utc)
        info = detector.get_phase_info(now)

        assert info.phase == LeaguePhase.LATE
        assert info.reference_currency == "divine"
        assert info.min_spread_after_fees == 0.03


class TestNonResetEventTypes:
    """Test that league_start and economy_shift events do NOT reset the phase.

    From spec §6: Only major_patch events reset the PhaseDetector reference date.
    Creating league_start or economy_shift events must leave the phase unchanged.
    """

    def test_league_start_does_not_reset_phase(self):
        """A league_start event must NOT reset the phase clock.

        Regression test: previously, EventManager called reset_for_major_patch
        for league_start events, which incorrectly reset the reference date.
        """
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        config = _make_config()
        detector = PhaseDetector(league_start, config)

        # Day 40 → LATE (40 > 35)
        now = datetime(2025, 2, 24, 0, 0, 0, tzinfo=timezone.utc)
        assert detector.current_phase(now) == LeaguePhase.LATE

        # Simulate creating a league_start event — should NOT reset
        # PhaseDetector.reset_for_major_patch must NOT be called for league_start
        # The event manager only calls reset_for_major_patch when
        # event_type == MAJOR_PATCH (see has_major_patch_event).
        # league_start events should leave the reference date unchanged.
        assert detector.patch_reset_date is None

        # Phase should remain LATE
        assert detector.current_phase(now) == LeaguePhase.LATE
        assert detector.days_since_reference(now) == 40

    def test_economy_shift_does_not_reset_phase(self):
        """An economy_shift event must NOT reset the phase clock.

        Economy shifts affect scoring penalties but not the phase reference date.
        """
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        config = _make_config()
        detector = PhaseDetector(league_start, config)

        now = datetime(2025, 2, 24, 0, 0, 0, tzinfo=timezone.utc)
        assert detector.current_phase(now) == LeaguePhase.LATE

        # economy_shift should NOT change the reference date
        assert detector.patch_reset_date is None
        assert detector.current_phase(now) == LeaguePhase.LATE

    def test_minor_patch_does_not_reset_phase(self):
        """A minor_patch event must NOT reset the phase clock."""
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        config = _make_config()
        detector = PhaseDetector(league_start, config)

        now = datetime(2025, 2, 24, 0, 0, 0, tzinfo=timezone.utc)
        assert detector.current_phase(now) == LeaguePhase.LATE

        # minor_patch should NOT change the reference date
        assert detector.patch_reset_date is None
        assert detector.current_phase(now) == LeaguePhase.LATE

    def test_streamer_hype_does_not_reset_phase(self):
        """A streamer_hype event must NOT reset the phase clock."""
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        config = _make_config()
        detector = PhaseDetector(league_start, config)

        now = datetime(2025, 2, 24, 0, 0, 0, tzinfo=timezone.utc)
        assert detector.current_phase(now) == LeaguePhase.LATE

        # streamer_hype should NOT change the reference date
        assert detector.patch_reset_date is None
        assert detector.current_phase(now) == LeaguePhase.LATE

    def test_only_major_patch_resets_phase(self):
        """Verify that among all event types, only major_patch resets the phase."""
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        config = _make_config()

        # Test each non-major event type: none should reset
        non_major_types = [
            EventType.LEAGUE_START,
            EventType.ECONOMY_SHIFT,
            EventType.MINOR_PATCH,
            EventType.STREAMER_HYPE,
            EventType.OTHER,
        ]

        for event_type in non_major_types:
            detector = PhaseDetector(league_start, config)
            now = datetime(2025, 2, 24, 0, 0, 0, tzinfo=timezone.utc)
            # Should be LATE before
            assert detector.current_phase(now) == LeaguePhase.LATE
            # patch_reset_date should be None (no reset happened)
            assert detector.patch_reset_date is None

        # Now test major_patch: should reset
        detector = PhaseDetector(league_start, config)
        now = datetime(2025, 2, 24, 0, 0, 0, tzinfo=timezone.utc)
        assert detector.current_phase(now) == LeaguePhase.LATE

        patch_date = datetime(2025, 2, 4, 0, 0, 0, tzinfo=timezone.utc)
        detector.reset_for_major_patch(patch_date)
        assert detector.patch_reset_date == patch_date
        assert detector.current_phase(now) == LeaguePhase.MID


class TestNaiveDatetimeTimezoneHandling:
    """Regression tests for KI-27 (iter 133, KI-26-audit).

    The previous implementation used ``replace(tzinfo=timezone.utc)`` on naive
    datetimes, which just relabels wall-clock as UTC without converting. The
    fix uses ``astimezone(timezone.utc)`` which interprets naive as
    system-local and converts to UTC (same fix pattern as KI-26 in
    ``triangular_cycles._safe_snapshot_age_sec``).

    These tests verify that naive ``now`` and naive ``patch_reset_date``
    inputs are handled correctly: the result is a sensible positive value
    (NOT clamped to 0, which was the original KI-26 symptom in non-UTC
    timezones), and matches what ``astimezone(timezone.utc)`` produces.
    """

    def test_naive_current_datetime_uses_astimezone(self):
        """A naive ``now`` must be interpreted as system-local time and
        converted to UTC, not relabelled as UTC wall-clock.

        We assert the result matches the explicit
        ``naive.astimezone(timezone.utc)`` conversion — this catches the
        regression in non-UTC timezones (where ``replace(tzinfo=utc)``
        would produce a different, wrong answer).
        """
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        detector = PhaseDetector(league_start, _make_config())

        naive_now = datetime(2025, 1, 20, 0, 0, 0)  # no tzinfo
        result = detector.days_since_reference(naive_now)

        # Expected: floor((naive_now.astimezone(utc) - league_start) / 86400)
        expected = max(
            0,
            int((naive_now.astimezone(timezone.utc) - league_start).total_seconds() // 86400),
        )
        assert result == expected, (
            f"KI-27 regression: naive 'now' produced days_since_reference="
            f"{result}, expected {expected} (from astimezone conversion)."
        )

    def test_naive_patch_reset_date_uses_astimezone(self):
        """A naive ``patch_reset_date`` (typical for an API request body that
        omitted the ``Z`` suffix) must be interpreted as system-local time.
        """
        league_start = datetime(2025, 1, 15, 0, 0, 0, tzinfo=timezone.utc)
        detector = PhaseDetector(league_start, _make_config())

        naive_patch = datetime(2025, 2, 4, 12, 0, 0)  # no tzinfo
        detector.reset_for_major_patch(naive_patch)

        aware_now = datetime(2025, 2, 24, 12, 0, 0, tzinfo=timezone.utc)
        result = detector.days_since_reference(aware_now)

        expected = max(
            0,
            int((aware_now - naive_patch.astimezone(timezone.utc)).total_seconds() // 86400),
        )
        assert result == expected, (
            f"KI-27 regression: naive patch_reset_date produced "
            f"days_since_reference={result}, expected {expected}."
        )


# Import EventType for TestNonResetEventTypes
from backend.models.currency import EventType
