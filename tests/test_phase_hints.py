"""
Tests for backend/economy/phase_hints.py — F6 (iter 78).

Coverage:
1. Pure-function tests on each phase (EARLY / MID / LATE):
   - Correct phase value returned.
   - phase_label is non-empty.
   - phase_summary is non-empty.
   - hints list is non-empty.
   - Each hint has all required keys (id, title, detail, action, category).
   - ids are stable slugs (lowercase, hyphenated).
2. days_since_reference and reference_currency pass-through.
3. league_name pass-through.
4. fetched_at is a valid ISO 8601 string.
5. data_available is always True.
6. Helper functions: list_phases_with_hints, hint_count_for_phase.
7. Route handler smoke tests (with mocked PhaseDetector).
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.economy.phase_hints import (
    get_phase_hints,
    hint_count_for_phase,
    list_phases_with_hints,
    _PHASE_HINTS,
    _PHASE_META,
)
from backend.models.currency import LeaguePhase


# ---------------------------------------------------------------------------
# Constants — mirror the hardcoded table
# ---------------------------------------------------------------------------

EXPECTED_HINT_COUNTS = {
    LeaguePhase.EARLY: 4,
    LeaguePhase.MID: 4,
    LeaguePhase.LATE: 4,
}

REQUIRED_HINT_KEYS = {"id", "title", "detail", "action", "category"}


# ===========================================================================
# 1. Per-phase smoke tests
# ===========================================================================

class TestPerPhase:
    """Verify each phase returns a well-formed response."""

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_returns_correct_phase_value(self, phase: LeaguePhase):
        result = get_phase_hints(phase, 10, league_name="runes")
        assert result["phase"] == phase.value

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_phase_label_is_nonempty(self, phase: LeaguePhase):
        result = get_phase_hints(phase, 10, league_name="runes")
        assert isinstance(result["phase_label"], str)
        assert len(result["phase_label"]) > 0

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_phase_summary_is_nonempty(self, phase: LeaguePhase):
        result = get_phase_hints(phase, 10, league_name="runes")
        assert isinstance(result["phase_summary"], str)
        assert len(result["phase_summary"]) > 20  # at least a sentence

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_hints_list_is_nonempty(self, phase: LeaguePhase):
        result = get_phase_hints(phase, 10, league_name="runes")
        assert isinstance(result["hints"], list)
        assert len(result["hints"]) == EXPECTED_HINT_COUNTS[phase]

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_each_hint_has_required_keys(self, phase: LeaguePhase):
        result = get_phase_hints(phase, 10, league_name="runes")
        for hint in result["hints"]:
            assert REQUIRED_HINT_KEYS.issubset(hint.keys()), (
                f"Hint {hint.get('id', '?')} missing keys: "
                f"{REQUIRED_HINT_KEYS - set(hint.keys())}"
            )

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_hint_ids_are_stable_slugs(self, phase: LeaguePhase):
        """Hint IDs should be lowercase, hyphenated slugs (no spaces, no caps)."""
        result = get_phase_hints(phase, 10, league_name="runes")
        for hint in result["hints"]:
            hid = hint["id"]
            assert isinstance(hid, str)
            assert len(hid) > 0
            assert " " not in hid, f"Hint id '{hid}' should not contain spaces"
            assert hid == hid.lower(), f"Hint id '{hid}' should be lowercase"
            # slug chars only: letters, digits, hyphens
            assert all(c.isalnum() or c == "-" for c in hid), (
                f"Hint id '{hid}' should be a slug (alnum + hyphens only)"
            )

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_hint_titles_are_nonempty(self, phase: LeaguePhase):
        result = get_phase_hints(phase, 10, league_name="runes")
        for hint in result["hints"]:
            assert isinstance(hint["title"], str)
            assert len(hint["title"]) > 0

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_hint_details_are_nonempty(self, phase: LeaguePhase):
        result = get_phase_hints(phase, 10, league_name="runes")
        for hint in result["hints"]:
            assert isinstance(hint["detail"], str)
            assert len(hint["detail"]) > 20  # at least a sentence

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_hint_actions_are_nonempty(self, phase: LeaguePhase):
        result = get_phase_hints(phase, 10, league_name="runes")
        for hint in result["hints"]:
            assert isinstance(hint["action"], str)
            assert len(hint["action"]) > 0

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_hint_categories_are_strings(self, phase: LeaguePhase):
        """Category may be empty string but must be a string."""
        result = get_phase_hints(phase, 10, league_name="runes")
        for hint in result["hints"]:
            assert isinstance(hint["category"], str)

    @pytest.mark.parametrize("phase", list(LeaguePhase))
    def test_hint_ids_are_unique_within_phase(self, phase: LeaguePhase):
        result = get_phase_hints(phase, 10, league_name="runes")
        ids = [h["id"] for h in result["hints"]]
        assert len(ids) == len(set(ids)), f"Duplicate hint ids in phase {phase.value}: {ids}"


# ===========================================================================
# 2. Pass-through fields
# ===========================================================================

class TestPassthrough:
    def test_days_since_reference_passes_through(self):
        result = get_phase_hints(LeaguePhase.MID, 42, league_name="runes")
        assert result["days_since_reference"] == 42

    def test_days_since_reference_zero(self):
        result = get_phase_hints(LeaguePhase.EARLY, 0, league_name="runes")
        assert result["days_since_reference"] == 0

    def test_days_since_reference_large(self):
        result = get_phase_hints(LeaguePhase.LATE, 999, league_name="runes")
        assert result["days_since_reference"] == 999

    def test_reference_currency_passes_through(self):
        result = get_phase_hints(
            LeaguePhase.MID, 25, reference_currency="divine", league_name="runes"
        )
        assert result["reference_currency"] == "divine"

    def test_reference_currency_empty_default(self):
        result = get_phase_hints(LeaguePhase.MID, 25, league_name="runes")
        assert result["reference_currency"] == ""

    def test_league_name_passes_through(self):
        result = get_phase_hints(LeaguePhase.MID, 25, league_name="custom-league")
        assert result["league"] == "custom-league"

    def test_league_name_empty_default(self):
        result = get_phase_hints(LeaguePhase.MID, 25)
        assert result["league"] == ""


# ===========================================================================
# 3. Metadata fields
# ===========================================================================

class TestMetadata:
    def test_data_available_always_true(self):
        """The hint table is hardcoded — data_available is always True."""
        for phase in LeaguePhase:
            result = get_phase_hints(phase, 10, league_name="runes")
            assert result["data_available"] is True

    def test_fetched_at_is_iso_string(self):
        result = get_phase_hints(LeaguePhase.MID, 25, league_name="runes")
        ts = result["fetched_at"]
        assert isinstance(ts, str)
        # Should be parseable as ISO 8601
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        assert parsed.year >= 2026  # sanity check

    def test_fetched_at_uses_now_override(self):
        custom_now = datetime(2025, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
        result = get_phase_hints(
            LeaguePhase.MID, 25, league_name="runes", now=custom_now
        )
        assert result["fetched_at"] == custom_now.isoformat()

    def test_phase_label_matches_meta_table(self):
        for phase in LeaguePhase:
            result = get_phase_hints(phase, 10, league_name="runes")
            assert result["phase_label"] == _PHASE_META[phase]["label"]
            assert result["phase_summary"] == _PHASE_META[phase]["summary"]


# ===========================================================================
# 4. Helper functions
# ===========================================================================

class TestHelpers:
    def test_list_phases_with_hints_returns_all_three(self):
        phases = list_phases_with_hints()
        assert set(phases) == {
            LeaguePhase.EARLY,
            LeaguePhase.MID,
            LeaguePhase.LATE,
        }

    @pytest.mark.parametrize(
        "phase,expected",
        [
            (LeaguePhase.EARLY, 4),
            (LeaguePhase.MID, 4),
            (LeaguePhase.LATE, 4),
        ],
    )
    def test_hint_count_for_phase(self, phase: LeaguePhase, expected: int):
        assert hint_count_for_phase(phase) == expected

    def test_hint_count_for_phase_zero_when_missing(self):
        """A phase not in the table should return 0 (defensive)."""
        # All LeaguePhase values are in the table — but the helper should
        # still be defensive. We test with a mock phase-like enum.
        class FakePhase:
            value = "fake"
        assert hint_count_for_phase(FakePhase()) == 0  # type: ignore[arg-type]


# ===========================================================================
# 5. Content sanity — verify specific hints are present
# ===========================================================================

class TestContentSanity:
    """Verify the hardcoded table contains the expected key hints (so a
    refactor doesn't accidentally drop them)."""

    def test_early_has_quick_flips_hint(self):
        result = get_phase_hints(LeaguePhase.EARLY, 5, league_name="runes")
        ids = [h["id"] for h in result["hints"]]
        assert "early-quick-flips" in ids

    def test_mid_has_skill_gems_hint(self):
        result = get_phase_hints(LeaguePhase.MID, 25, league_name="runes")
        ids = [h["id"] for h in result["hints"]]
        assert "mid-skill-gems-18-20" in ids

    def test_mid_has_temporalis_rising_hint(self):
        result = get_phase_hints(LeaguePhase.MID, 25, league_name="runes")
        ids = [h["id"] for h in result["hints"]]
        assert "mid-temporalis-rising" in ids

    def test_late_has_temporalis_peak_hint(self):
        result = get_phase_hints(LeaguePhase.LATE, 60, league_name="runes")
        ids = [h["id"] for h in result["hints"]]
        assert "late-temporalis-peak" in ids

    def test_late_has_portfolio_hold_hint(self):
        result = get_phase_hints(LeaguePhase.LATE, 60, league_name="runes")
        ids = [h["id"] for h in result["hints"]]
        assert "late-portfolio-hold" in ids

    def test_skill_gems_hint_mentions_18_20(self):
        """The MID-phase skill gems hint should mention the 18-20 lvl range."""
        result = get_phase_hints(LeaguePhase.MID, 25, league_name="runes")
        skill_hint = next(h for h in result["hints"] if h["id"] == "mid-skill-gems-18-20")
        text = (skill_hint["title"] + " " + skill_hint["detail"]).lower()
        assert "18-20" in text or "18" in text

    def test_temporalis_hint_in_every_phase(self):
        """Every phase should mention Temporalis in at least one hint
        (it's a chase unique tracked across the league lifecycle)."""
        for phase in LeaguePhase:
            result = get_phase_hints(phase, 10, league_name="runes")
            has_temporalis = any(
                "temporalis" in (h["title"] + " " + h["detail"]).lower()
                for h in result["hints"]
            )
            assert has_temporalis, (
                f"Phase {phase.value} has no Temporalis hint"
            )


# ===========================================================================
# 6. Route handler smoke tests
# ===========================================================================

class TestRouteHandler:
    """Smoke test the FastAPI route handler without spinning up uvicorn.

    We patch `get_phase_detector` so the route returns deterministic data
    based on a mocked PhaseInfo, then call the handler function directly.
    """

    async def test_route_returns_hints_for_current_phase(self):
        from backend.api.routes_phase_hints import get_phase_hints_route

        # Mock PhaseDetector.get_phase_info() to return MID phase
        mock_info = SimpleNamespace(
            phase=LeaguePhase.MID,
            days_since_reference=25,
            reference_currency="divine",
            recommended_strategy="Triangular arb",
            min_spread_after_fees=0.05,
            max_hold_time="24 hours",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)

        with patch(
            "backend.api.routes_phase_hints.get_phase_detector"
        ) as mock_get_detector:
            mock_get_detector.return_value = mock_detector
            result = await get_phase_hints_route()

        assert result["phase"] == "mid"
        assert result["phase_label"] == "Mid League"
        assert result["days_since_reference"] == 25
        assert result["reference_currency"] == "divine"
        assert result["data_available"] is True
        assert len(result["hints"]) == 4
        assert "fetched_at" in result

    async def test_route_returns_early_phase(self):
        from backend.api.routes_phase_hints import get_phase_hints_route

        mock_info = SimpleNamespace(
            phase=LeaguePhase.EARLY,
            days_since_reference=3,
            reference_currency="exalted",
            recommended_strategy="Quick flips",
            min_spread_after_fees=0.15,
            max_hold_time="2 hours",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)

        with patch(
            "backend.api.routes_phase_hints.get_phase_detector"
        ) as mock_get_detector:
            mock_get_detector.return_value = mock_detector
            result = await get_phase_hints_route()

        assert result["phase"] == "early"
        assert result["phase_label"] == "Early League"
        assert result["days_since_reference"] == 3
        assert result["reference_currency"] == "exalted"
        assert len(result["hints"]) == 4

    async def test_route_returns_late_phase(self):
        from backend.api.routes_phase_hints import get_phase_hints_route

        mock_info = SimpleNamespace(
            phase=LeaguePhase.LATE,
            days_since_reference=70,
            reference_currency="divine",
            recommended_strategy="Portfolio holding",
            min_spread_after_fees=0.03,
            max_hold_time="72+ hours",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)

        with patch(
            "backend.api.routes_phase_hints.get_phase_detector"
        ) as mock_get_detector:
            mock_get_detector.return_value = mock_detector
            result = await get_phase_hints_route()

        assert result["phase"] == "late"
        assert result["phase_label"] == "Late League"
        assert result["days_since_reference"] == 70
        assert len(result["hints"]) == 4

    async def test_route_returns_empty_on_exception(self):
        """If get_phase_detector raises, the route should return
        data_available=False with empty hints (no 500)."""
        from backend.api.routes_phase_hints import get_phase_hints_route

        with patch(
            "backend.api.routes_phase_hints.get_phase_detector"
        ) as mock_get_detector:
            mock_get_detector.side_effect = RuntimeError("boom")
            result = await get_phase_hints_route()

        assert result["data_available"] is False
        assert result["hints"] == []
        assert result["phase"] == "unknown"
        assert result["phase_label"] == "Unknown Phase"
        assert "fetched_at" in result

    async def test_route_response_matches_pydantic_model(self):
        """Verify the route's return dict shape matches PhaseHintsResponse."""
        from backend.api.response_models import PhaseHintsResponse
        from backend.api.routes_phase_hints import get_phase_hints_route

        mock_info = SimpleNamespace(
            phase=LeaguePhase.MID,
            days_since_reference=25,
            reference_currency="divine",
            recommended_strategy="Triangular arb",
            min_spread_after_fees=0.05,
            max_hold_time="24 hours",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)

        with patch(
            "backend.api.routes_phase_hints.get_phase_detector"
        ) as mock_get_detector:
            mock_get_detector.return_value = mock_detector
            result = await get_phase_hints_route()

        # Pydantic should validate the dict without raising
        model = PhaseHintsResponse(**result)
        assert model.phase == "mid"
        assert model.data_available is True
        assert len(model.hints) == 4
        assert model.hints[0].id  # non-empty
