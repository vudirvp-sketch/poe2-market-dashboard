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
from unittest.mock import AsyncMock, patch

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


# ===========================================================================
# 7. iter 110 — Live-price enrichment (P9 Phase-aware Investment Advisor)
# ===========================================================================

from datetime import timedelta  # noqa: E402

from backend.economy.phase_hints import (  # noqa: E402
    CHANGE_MONTH_DAYS,
    CHANGE_WEEK_DAYS,
    MOMENTUM_DOWN_THRESHOLD_PCT,
    MOMENTUM_UP_THRESHOLD_PCT,
    _compute_change_pct,
    _find_price_near,
    _momentum_from_change,
    _recommendation_from_phase_momentum,
    list_tracked_hints,
)
from backend.models.currency import PricePoint  # noqa: E402


def _make_point(ts: datetime, price: float) -> PricePoint:
    """Build a PricePoint at timestamp ``ts`` with the given price."""
    return PricePoint(timestamp=ts, price=price)


def _make_snapshot(
    *,
    price_history: list[PricePoint] | None = None,
    current_price: float | None = None,
    api_id: str = "exalted",
) -> SimpleNamespace:
    """Build a mock DataSnapshot with just enough surface for enrichment.

    The real DataSnapshot has ``get_price_history(api_id)`` and
    ``get_current_price(api_id)`` — we only need those two methods.
    """
    history_map: dict[str, list[PricePoint]] = {}
    if price_history is not None:
        history_map[api_id] = price_history
    price_map: dict[str, float] = {}
    if current_price is not None:
        price_map[api_id] = current_price
    return SimpleNamespace(
        get_price_history=lambda aid: history_map.get(aid.lower(), []),
        get_current_price=lambda aid: price_map.get(aid.lower()),
    )


class TestListTrackedHints:
    """Verify the static table declares the expected tracked hints."""

    def test_returns_three_tracked_hints(self):
        tracked = list_tracked_hints()
        assert len(tracked) == 3

    def test_early_quick_flips_tracks_exalted(self):
        tracked = list_tracked_hints()
        ids = [(p, hid) for p, hid, _ in tracked]
        assert (LeaguePhase.EARLY, "early-quick-flips") in ids
        cur = next(c for p, hid, c in tracked if hid == "early-quick-flips")
        assert cur == "exalted"

    def test_mid_triangular_arb_tracks_divine(self):
        tracked = list_tracked_hints()
        cur = next(
            c for p, hid, c in tracked if hid == "mid-triangular-arb"
        )
        assert cur == "divine"

    def test_late_portfolio_hold_tracks_divine(self):
        tracked = list_tracked_hints()
        cur = next(
            c for p, hid, c in tracked if hid == "late-portfolio-hold"
        )
        assert cur == "divine"

    def test_untracked_hints_have_empty_tracked_currency(self):
        """All hints NOT in list_tracked_hints must have tracked_currency=''."""
        tracked_ids = {hid for _, hid, _ in list_tracked_hints()}
        for phase in LeaguePhase:
            for hint in _PHASE_HINTS.get(phase, []):
                if hint["id"] not in tracked_ids:
                    assert hint.get("tracked_currency", "") == "", (
                        f"Hint {hint['id']} should be untracked but has "
                        f"tracked_currency='{hint.get('tracked_currency')}'"
                    )


class TestFindPriceNear:
    """Nearest-neighbour price lookup with 24h tolerance."""

    def test_empty_history_returns_none(self):
        target = datetime(2026, 7, 1, tzinfo=timezone.utc)
        assert _find_price_near([], target) is None

    def test_exact_match_returns_price(self):
        ts = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        history = [_make_point(ts, 100.0)]
        assert _find_price_near(history, ts) == 100.0

    def test_within_tolerance_returns_nearest(self):
        target = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # 2 hours before target
        history = [_make_point(target - timedelta(hours=2), 95.0)]
        assert _find_price_near(history, target) == 95.0

    def test_outside_tolerance_returns_none(self):
        target = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # 48 hours before target — exceeds 24h tolerance
        history = [_make_point(target - timedelta(hours=48), 95.0)]
        assert _find_price_near(history, target) is None

    def test_picks_closest_of_multiple(self):
        target = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        history = [
            _make_point(target - timedelta(hours=10), 90.0),
            _make_point(target - timedelta(hours=2), 95.0),  # closest
            _make_point(target + timedelta(hours=5), 105.0),
        ]
        assert _find_price_near(history, target) == 95.0

    def test_custom_tolerance(self):
        target = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # 48h away — within 72h tolerance, outside 24h default
        history = [_make_point(target - timedelta(hours=48), 80.0)]
        assert _find_price_near(history, target, tolerance_hours=72) == 80.0
        assert _find_price_near(history, target, tolerance_hours=24) is None


class TestComputeChangePct:
    """Signed % change over a lookback window."""

    def test_empty_history_returns_none(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        assert _compute_change_pct(100.0, [], CHANGE_WEEK_DAYS, now) is None

    def test_zero_current_returns_none(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        history = [_make_point(now - timedelta(days=7), 100.0)]
        assert _compute_change_pct(0.0, history, CHANGE_WEEK_DAYS, now) is None

    def test_negative_current_returns_none(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        history = [_make_point(now - timedelta(days=7), 100.0)]
        assert _compute_change_pct(-5.0, history, CHANGE_WEEK_DAYS, now) is None

    def test_rising_price_returns_positive_pct(self):
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # 7d ago: 100, now: 110 → +10%
        history = [_make_point(now - timedelta(days=7), 100.0)]
        result = _compute_change_pct(110.0, history, CHANGE_WEEK_DAYS, now)
        assert result is not None
        assert abs(result - 10.0) < 0.01

    def test_falling_price_returns_negative_pct(self):
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # 7d ago: 100, now: 80 → -20%
        history = [_make_point(now - timedelta(days=7), 100.0)]
        result = _compute_change_pct(80.0, history, CHANGE_WEEK_DAYS, now)
        assert result is not None
        assert abs(result - (-20.0)) < 0.01

    def test_no_price_within_tolerance_returns_none(self):
        """When history only has points much older than the lookback window,
        no price is within 24h tolerance of (now - days) → None."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # 30d ago — too old for a 7d lookback (24h tolerance)
        history = [_make_point(now - timedelta(days=30), 100.0)]
        assert _compute_change_pct(110.0, history, CHANGE_WEEK_DAYS, now) is None

    def test_zero_old_price_returns_none(self):
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        history = [_make_point(now - timedelta(days=7), 0.0)]
        assert _compute_change_pct(110.0, history, CHANGE_WEEK_DAYS, now) is None


class TestMomentumFromChange:
    """UP / DOWN / FLAT classification from 7d % change."""

    def test_none_change_returns_none(self):
        assert _momentum_from_change(None) is None

    def test_above_up_threshold_returns_up(self):
        assert _momentum_from_change(MOMENTUM_UP_THRESHOLD_PCT) == "UP"
        assert _momentum_from_change(10.0) == "UP"

    def test_below_down_threshold_returns_down(self):
        assert _momentum_from_change(MOMENTUM_DOWN_THRESHOLD_PCT) == "DOWN"
        assert _momentum_from_change(-10.0) == "DOWN"

    def test_between_thresholds_returns_flat(self):
        assert _momentum_from_change(0.0) == "FLAT"
        assert _momentum_from_change(4.9) == "FLAT"
        assert _momentum_from_change(-4.9) == "FLAT"

    def test_exact_up_threshold_returns_up(self):
        """Boundary: exactly +5% → UP (>= is the check)."""
        assert _momentum_from_change(5.0) == "UP"

    def test_exact_down_threshold_returns_down(self):
        """Boundary: exactly -5% → DOWN (<= is the check)."""
        assert _momentum_from_change(-5.0) == "DOWN"


class TestRecommendationFromPhaseMomentum:
    """Phase-aware recommendation matrix."""

    @pytest.mark.parametrize(
        "phase,momentum,expected",
        [
            # EARLY
            (LeaguePhase.EARLY, "UP", "HOLD"),
            (LeaguePhase.EARLY, "DOWN", "BUY_OPPORTUNITY"),
            (LeaguePhase.EARLY, "FLAT", "WATCH"),
            # MID
            (LeaguePhase.MID, "UP", "HOLD"),
            (LeaguePhase.MID, "DOWN", "WATCH"),
            (LeaguePhase.MID, "FLAT", "NEUTRAL"),
            # LATE
            (LeaguePhase.LATE, "UP", "SELL_INTO_STRENGTH"),
            (LeaguePhase.LATE, "DOWN", "SELL_NOW"),
            (LeaguePhase.LATE, "FLAT", "NEUTRAL"),
        ],
    )
    def test_matrix(self, phase, momentum, expected):
        assert _recommendation_from_phase_momentum(phase, momentum) == expected

    def test_none_momentum_returns_none(self):
        for phase in LeaguePhase:
            assert _recommendation_from_phase_momentum(phase, None) is None


class TestGetPhaseHintsWithSnapshot:
    """End-to-end enrichment tests via get_phase_hints()."""

    def test_no_snapshot_returns_static_hints_only(self):
        """When snapshot=None, hints must NOT have live-price fields."""
        result = get_phase_hints(LeaguePhase.MID, 25, league_name="runes")
        for hint in result["hints"]:
            assert "current_price" not in hint
            assert "change_pct_week" not in hint
            assert "momentum" not in hint
            assert "recommendation" not in hint
            # tracked_currency IS present (added in iter 110, always present)
            assert "tracked_currency" in hint

    def test_snapshot_with_data_enriches_tracked_hint(self):
        """When snapshot has data for the tracked currency, the hint is enriched."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # 7d ago: 100, now: 115 → +15% → UP momentum → MID+UP → HOLD
        history = [
            _make_point(now - timedelta(days=7), 100.0),
            _make_point(now - timedelta(days=3), 110.0),
            _make_point(now - timedelta(hours=1), 115.0),
        ]
        snapshot = _make_snapshot(
            price_history=history, current_price=115.0, api_id="divine"
        )
        result = get_phase_hints(
            LeaguePhase.MID, 25, league_name="runes", now=now, snapshot=snapshot
        )
        # Find the tracked hint (mid-triangular-arb → divine)
        tracked = next(
            h for h in result["hints"] if h["id"] == "mid-triangular-arb"
        )
        assert tracked["tracked_currency"] == "divine"
        assert tracked["current_price"] == 115.0
        assert tracked["change_pct_week"] is not None
        assert tracked["change_pct_week"] > 14.0  # ~15%
        assert tracked["momentum"] == "UP"
        assert tracked["recommendation"] == "HOLD"

    def test_snapshot_with_falling_price_in_early(self):
        """EARLY + DOWN → BUY_OPPORTUNITY."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # 7d ago: 100, now: 80 → -20% → DOWN → EARLY+DOWN → BUY_OPPORTUNITY
        history = [_make_point(now - timedelta(days=7), 100.0)]
        snapshot = _make_snapshot(
            price_history=history, current_price=80.0, api_id="exalted"
        )
        result = get_phase_hints(
            LeaguePhase.EARLY, 5, league_name="runes", now=now, snapshot=snapshot
        )
        tracked = next(
            h for h in result["hints"] if h["id"] == "early-quick-flips"
        )
        assert tracked["momentum"] == "DOWN"
        assert tracked["recommendation"] == "BUY_OPPORTUNITY"

    def test_snapshot_with_rising_price_in_late(self):
        """LATE + UP → SELL_INTO_STRENGTH."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        history = [_make_point(now - timedelta(days=7), 100.0)]
        snapshot = _make_snapshot(
            price_history=history, current_price=120.0, api_id="divine"
        )
        result = get_phase_hints(
            LeaguePhase.LATE, 70, league_name="runes", now=now, snapshot=snapshot
        )
        tracked = next(
            h for h in result["hints"] if h["id"] == "late-portfolio-hold"
        )
        assert tracked["momentum"] == "UP"
        assert tracked["recommendation"] == "SELL_INTO_STRENGTH"

    def test_untracked_hint_gets_none_live_fields(self):
        """Hints with tracked_currency='' must have all live fields = None."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        history = [_make_point(now - timedelta(days=7), 100.0)]
        snapshot = _make_snapshot(
            price_history=history, current_price=100.0, api_id="divine"
        )
        result = get_phase_hints(
            LeaguePhase.MID, 25, league_name="runes", now=now, snapshot=snapshot
        )
        untracked = next(
            h for h in result["hints"] if h["id"] == "mid-skill-gems-18-20"
        )
        assert untracked["tracked_currency"] == ""
        assert untracked["current_price"] is None
        assert untracked["change_pct_week"] is None
        assert untracked["change_pct_month"] is None
        assert untracked["momentum"] is None
        assert untracked["recommendation"] is None

    def test_snapshot_without_data_for_tracked_currency(self):
        """When snapshot has NO data for the tracked currency, live fields are None."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # Snapshot has data for "chaos" but the hint tracks "divine"
        history = [_make_point(now - timedelta(days=7), 100.0)]
        snapshot = _make_snapshot(
            price_history=history, current_price=100.0, api_id="chaos"
        )
        result = get_phase_hints(
            LeaguePhase.MID, 25, league_name="runes", now=now, snapshot=snapshot
        )
        tracked = next(
            h for h in result["hints"] if h["id"] == "mid-triangular-arb"
        )
        assert tracked["tracked_currency"] == "divine"
        assert tracked["current_price"] is None
        assert tracked["momentum"] is None
        assert tracked["recommendation"] is None

    def test_snapshot_with_short_history_no_weekly_change(self):
        """When history is <7d old, change_pct_week is None → momentum is None."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # Only 2 days of history — too short for 7d lookback
        history = [
            _make_point(now - timedelta(days=2), 100.0),
            _make_point(now - timedelta(hours=1), 105.0),
        ]
        snapshot = _make_snapshot(
            price_history=history, current_price=105.0, api_id="divine"
        )
        result = get_phase_hints(
            LeaguePhase.MID, 25, league_name="runes", now=now, snapshot=snapshot
        )
        tracked = next(
            h for h in result["hints"] if h["id"] == "mid-triangular-arb"
        )
        assert tracked["current_price"] == 105.0
        assert tracked["change_pct_week"] is None
        assert tracked["momentum"] is None
        assert tracked["recommendation"] is None

    def test_russian_table_with_snapshot_also_enriches(self):
        """Russian hint table must also get live-price enrichment."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        history = [_make_point(now - timedelta(days=7), 100.0)]
        snapshot = _make_snapshot(
            price_history=history, current_price=110.0, api_id="divine"
        )
        result = get_phase_hints(
            LeaguePhase.MID, 25, league_name="runes", now=now,
            lang="ru", snapshot=snapshot,
        )
        # Russian title confirms we got the RU table
        tracked = next(
            h for h in result["hints"] if h["id"] == "mid-triangular-arb"
        )
        assert "треугольного" in tracked["title"]
        assert tracked["current_price"] == 110.0
        assert tracked["momentum"] == "UP"

    def test_flat_momentum_in_mid_returns_neutral(self):
        """MID + FLAT → NEUTRAL."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        # 7d ago: 100, now: 102 → +2% → FLAT
        history = [_make_point(now - timedelta(days=7), 100.0)]
        snapshot = _make_snapshot(
            price_history=history, current_price=102.0, api_id="divine"
        )
        result = get_phase_hints(
            LeaguePhase.MID, 25, league_name="runes", now=now, snapshot=snapshot
        )
        tracked = next(
            h for h in result["hints"] if h["id"] == "mid-triangular-arb"
        )
        assert tracked["momentum"] == "FLAT"
        assert tracked["recommendation"] == "NEUTRAL"

    def test_does_not_mutate_static_table(self):
        """Calling get_phase_hints with a snapshot must NOT modify _PHASE_HINTS."""
        now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
        history = [_make_point(now - timedelta(days=7), 100.0)]
        snapshot = _make_snapshot(
            price_history=history, current_price=110.0, api_id="divine"
        )
        # Before the call, the static table hint has no current_price
        static_hint = next(
            h for h in _PHASE_HINTS[LeaguePhase.MID] if h["id"] == "mid-triangular-arb"
        )
        assert "current_price" not in static_hint

        # Call with snapshot
        get_phase_hints(
            LeaguePhase.MID, 25, league_name="runes", now=now, snapshot=snapshot
        )

        # After the call, the static table must still have no current_price
        static_hint_after = next(
            h for h in _PHASE_HINTS[LeaguePhase.MID] if h["id"] == "mid-triangular-arb"
        )
        assert "current_price" not in static_hint_after


class TestRouteHandlerWithSnapshot:
    """iter 110: route handler now fetches the snapshot (best-effort)."""

    async def test_route_enriches_when_snapshot_available(self):
        """When the snapshot manager has data, the route passes it through."""
        from backend.api.routes_phase_hints import get_phase_hints_route

        # Use real now — the route handler does NOT accept a `now` override,
        # so history must be relative to the actual current time for the
        # 7d lookback to find a matching price point.
        now = datetime.now(timezone.utc)
        history = [_make_point(now - timedelta(days=7), 100.0)]

        mock_info = SimpleNamespace(
            phase=LeaguePhase.MID,
            days_since_reference=25,
            reference_currency="divine",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)
        mock_snapshot = _make_snapshot(
            price_history=history, current_price=110.0, api_id="divine"
        )
        mock_snap_mgr = SimpleNamespace(last_snapshot=mock_snapshot)

        with patch(
            "backend.api.routes_phase_hints.get_phase_detector"
        ) as mock_get_detector, patch(
            "backend.api.routes_phase_hints.get_snapshot_manager"
        ) as mock_get_mgr, patch(
            "backend.api.routes_phase_hints.get_snapshot",
            new=AsyncMock(return_value=mock_snapshot),
        ):
            mock_get_detector.return_value = mock_detector
            mock_get_mgr.return_value = mock_snap_mgr
            result = await get_phase_hints_route()

        tracked = next(
            h for h in result["hints"] if h["id"] == "mid-triangular-arb"
        )
        assert tracked["current_price"] == 110.0
        assert tracked["momentum"] == "UP"

    async def test_route_falls_back_when_snapshot_unavailable(self):
        """When snapshot manager has no data, hints are returned static-only."""
        from backend.api.routes_phase_hints import get_phase_hints_route

        mock_info = SimpleNamespace(
            phase=LeaguePhase.MID,
            days_since_reference=25,
            reference_currency="divine",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)
        # last_snapshot is None — no data yet
        mock_snap_mgr = SimpleNamespace(last_snapshot=None)

        with patch(
            "backend.api.routes_phase_hints.get_phase_detector"
        ) as mock_get_detector, patch(
            "backend.api.routes_phase_hints.get_snapshot_manager"
        ) as mock_get_mgr:
            mock_get_detector.return_value = mock_detector
            mock_get_mgr.return_value = mock_snap_mgr
            result = await get_phase_hints_route()

        # Hints are returned (static), but no live-price fields
        assert result["data_available"] is True
        assert len(result["hints"]) == 4
        for hint in result["hints"]:
            assert "current_price" not in hint
            assert "momentum" not in hint

    async def test_route_falls_back_when_snapshot_raises(self):
        """When get_snapshot_manager raises, hints are returned static-only."""
        from backend.api.routes_phase_hints import get_phase_hints_route

        mock_info = SimpleNamespace(
            phase=LeaguePhase.MID,
            days_since_reference=25,
            reference_currency="divine",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)

        with patch(
            "backend.api.routes_phase_hints.get_phase_detector"
        ) as mock_get_detector, patch(
            "backend.api.routes_phase_hints.get_snapshot_manager"
        ) as mock_get_mgr:
            mock_get_detector.return_value = mock_detector
            mock_get_mgr.side_effect = RuntimeError("snap mgr broken")
            result = await get_phase_hints_route()

        # Hints are returned (static), no live-price fields, no crash
        assert result["data_available"] is True
        assert len(result["hints"]) == 4

    async def test_route_response_with_snapshot_validates_pydantic(self):
        """The enriched response must still validate against PhaseHintsResponse."""
        from backend.api.response_models import PhaseHintsResponse
        from backend.api.routes_phase_hints import get_phase_hints_route

        # Use real now — the route handler does NOT accept a `now` override.
        now = datetime.now(timezone.utc)
        history = [_make_point(now - timedelta(days=7), 100.0)]

        mock_info = SimpleNamespace(
            phase=LeaguePhase.EARLY,
            days_since_reference=5,
            reference_currency="exalted",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)
        mock_snapshot = _make_snapshot(
            price_history=history, current_price=80.0, api_id="exalted"
        )
        mock_snap_mgr = SimpleNamespace(last_snapshot=mock_snapshot)

        with patch(
            "backend.api.routes_phase_hints.get_phase_detector"
        ) as mock_get_detector, patch(
            "backend.api.routes_phase_hints.get_snapshot_manager"
        ) as mock_get_mgr, patch(
            "backend.api.routes_phase_hints.get_snapshot",
            new=AsyncMock(return_value=mock_snapshot),
        ):
            mock_get_detector.return_value = mock_detector
            mock_get_mgr.return_value = mock_snap_mgr
            result = await get_phase_hints_route()

        model = PhaseHintsResponse(**result)
        assert model.data_available is True
        # The early-quick-flips hint tracks exalted — should be enriched
        tracked = next(h for h in model.hints if h.id == "early-quick-flips")
        assert tracked.tracked_currency == "exalted"
        assert tracked.current_price == 80.0
        assert tracked.momentum == "DOWN"
        assert tracked.recommendation == "BUY_OPPORTUNITY"
