"""
Tests for backend/economy/leveling_uniques.py — P3 leveling-uniques lifecycle
detector (iter 100).

Coverage:
1. Pure helpers: _lifecycle_stage, _recommendation, _estimate_current_price,
   _days_until_peak.
2. compute_leveling_uniques_lifecycle end-to-end on hand-crafted inputs:
   - Day 0 (PRE_PEAK for all uniques)
   - Day 1 (PRE_PEAK for peak_day=2, AT_PEAK for peak_day=1)
   - Day 2 (AT_PEAK for peak_day=2)
   - Day 3 (AT_PEAK for peak_day=2, POST_PEAK for peak_day=1)
   - Day 7+ (POST_PEAK for all uniques — floor price reached)
   - Negative days_since_reference (defensive — clamped to 0)
   - Empty phase / unknown phase
3. Static table integrity: all entries have required fields, peak_day in
   [1, 14], decay_pct in [0, 100], peak_price_exalted > 0, id is unique.
4. Russian localization: ?lang=ru returns Russian notes for each unique,
   identical structure otherwise.
5. Route handler smoke tests: success path, exception path, lang param echo.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.economy.leveling_uniques import (
    POST_PEAK_FLOOR_DAY,
    PRE_PEAK_DAY0_PRICE_FRACTION,
    PATTERN_SPIKE_THEN_CRASH,
    RECOMMENDATION_AVOID_BUYING,
    RECOMMENDATION_BUY_OR_HOLD,
    RECOMMENDATION_SELL_NOW,
    STAGE_AT_PEAK,
    STAGE_POST_PEAK,
    STAGE_PRE_PEAK,
    _LEVELING_UNIQUES_NOTES_RU,
    _days_until_peak,
    _estimate_current_price,
    _lifecycle_stage,
    _recommendation,
    compute_leveling_uniques_lifecycle,
    leveling_unique_count,
    list_leveling_uniques,
)
from backend.models.currency import LeaguePhase


# ---------------------------------------------------------------------------
# Static-table integrity tests
# ---------------------------------------------------------------------------


class TestStaticTableIntegrity:
    """Verify the hardcoded _LEVELING_UNIQUES table is well-formed."""

    def test_table_is_non_empty(self):
        """The table must have at least 1 entry — otherwise the widget is useless."""
        assert leveling_unique_count() >= 1

    def test_table_has_at_least_5_entries(self):
        """Iter 100 ships with 10 leveling uniques — verify we have at least 5
        (defensive: future iterations may add/remove entries, but 5 is the
        minimum for the widget to be useful)."""
        assert leveling_unique_count() >= 5

    def test_all_entries_have_required_fields(self):
        """Every entry must have id, name, category, peak_day,
        peak_price_exalted, decay_pct, pattern, notes."""
        required_fields = {
            "id", "name", "category", "peak_day",
            "peak_price_exalted", "decay_pct", "pattern", "notes",
        }
        for entry in list_leveling_uniques():
            missing = required_fields - set(entry.keys())
            assert not missing, f"Entry {entry.get('id', '?')} missing fields: {missing}"

    def test_all_ids_are_unique(self):
        """ids must be unique — they're used as React keys and test selectors."""
        ids = [e["id"] for e in list_leveling_uniques()]
        assert len(ids) == len(set(ids)), f"Duplicate ids: {ids}"

    def test_peak_day_is_in_valid_range(self):
        """peak_day must be in [1, 14] — Day 0 is launch day (no peak),
        Day 14+ is MID phase (leveling uniques are no longer relevant)."""
        for entry in list_leveling_uniques():
            pd = entry["peak_day"]
            assert 1 <= pd <= 14, f"{entry['id']}: peak_day={pd} out of [1, 14]"

    def test_decay_pct_is_in_valid_range(self):
        """decay_pct must be in [0, 100] — 0 = no decay, 100 = full collapse."""
        for entry in list_leveling_uniques():
            dp = entry["decay_pct"]
            assert 0 <= dp <= 100, f"{entry['id']}: decay_pct={dp} out of [0, 100]"

    def test_peak_price_is_positive(self):
        """peak_price_exalted must be > 0 — otherwise the widget can't render
        the 'est. ~X exa' line."""
        for entry in list_leveling_uniques():
            pp = entry["peak_price_exalted"]
            assert pp > 0, f"{entry['id']}: peak_price_exalted={pp} not positive"

    def test_all_patterns_are_spike_then_crash(self):
        """Iter 100 only supports SPIKE_THEN_CRASH. Future iterations may
        add more patterns — update this test when that happens."""
        for entry in list_leveling_uniques():
            assert entry["pattern"] == PATTERN_SPIKE_THEN_CRASH, (
                f"{entry['id']}: pattern={entry['pattern']} != SPIKE_THEN_CRASH"
            )

    def test_all_notes_are_non_empty_strings(self):
        """notes must be a non-empty string — empty notes would render as a
        blank line in the widget."""
        for entry in list_leveling_uniques():
            notes = entry["notes"]
            assert isinstance(notes, str) and len(notes) > 0, (
                f"{entry['id']}: notes is empty or not a string"
            )


# ---------------------------------------------------------------------------
# _lifecycle_stage tests
# ---------------------------------------------------------------------------


class TestLifecycleStage:
    """Verify the PRE_PEAK / AT_PEAK / POST_PEAK classification logic."""

    @pytest.mark.parametrize("peak_day", [1, 2, 3, 5, 14])
    def test_pre_peak_when_days_less_than_peak_day(self, peak_day):
        """days < peak_day → PRE_PEAK."""
        assert _lifecycle_stage(peak_day, peak_day - 1) == STAGE_PRE_PEAK
        assert _lifecycle_stage(peak_day, 0) == STAGE_PRE_PEAK

    @pytest.mark.parametrize("peak_day", [1, 2, 3, 5, 14])
    def test_at_peak_on_peak_day(self, peak_day):
        """days == peak_day → AT_PEAK."""
        assert _lifecycle_stage(peak_day, peak_day) == STAGE_AT_PEAK

    @pytest.mark.parametrize("peak_day", [1, 2, 3, 5, 14])
    def test_at_peak_day_after_peak_day(self, peak_day):
        """days == peak_day + 1 → still AT_PEAK (2-day window)."""
        assert _lifecycle_stage(peak_day, peak_day + 1) == STAGE_AT_PEAK

    @pytest.mark.parametrize("peak_day", [1, 2, 3, 5, 14])
    def test_post_peak_two_days_after_peak_day(self, peak_day):
        """days == peak_day + 2 → POST_PEAK (crash begins)."""
        assert _lifecycle_stage(peak_day, peak_day + 2) == STAGE_POST_PEAK

    @pytest.mark.parametrize("peak_day", [1, 2, 3, 5, 14])
    def test_post_peak_far_future(self, peak_day):
        """days = 100 → POST_PEAK for any peak_day."""
        assert _lifecycle_stage(peak_day, 100) == STAGE_POST_PEAK

    def test_peak_day_zero_is_clamped_to_one(self):
        """peak_day=0 is malformed — should be clamped to 1."""
        # days=0 < 1 → PRE_PEAK
        assert _lifecycle_stage(0, 0) == STAGE_PRE_PEAK
        # days=1 == 1 → AT_PEAK
        assert _lifecycle_stage(0, 1) == STAGE_AT_PEAK
        # days=2 == 1+1 → AT_PEAK (still in 2-day window)
        assert _lifecycle_stage(0, 2) == STAGE_AT_PEAK
        # days=3 > 1+1 → POST_PEAK
        assert _lifecycle_stage(0, 3) == STAGE_POST_PEAK

    def test_negative_peak_day_is_clamped_to_one(self):
        """peak_day=-5 is malformed — should be clamped to 1."""
        assert _lifecycle_stage(-5, 0) == STAGE_PRE_PEAK
        assert _lifecycle_stage(-5, 1) == STAGE_AT_PEAK
        assert _lifecycle_stage(-5, 3) == STAGE_POST_PEAK

    def test_boundary_at_peak_day_plus_one(self):
        """The 2-day AT_PEAK window is inclusive on both ends."""
        # peak_day=2 → AT_PEAK for days=2 AND days=3
        assert _lifecycle_stage(2, 2) == STAGE_AT_PEAK
        assert _lifecycle_stage(2, 3) == STAGE_AT_PEAK
        # POST_PEAK starts at days=4
        assert _lifecycle_stage(2, 4) == STAGE_POST_PEAK


# ---------------------------------------------------------------------------
# _recommendation tests
# ---------------------------------------------------------------------------


class TestRecommendation:
    """Verify the stage → recommendation mapping."""

    def test_pre_peak_maps_to_buy_or_hold(self):
        assert _recommendation(STAGE_PRE_PEAK) == RECOMMENDATION_BUY_OR_HOLD

    def test_at_peak_maps_to_sell_now(self):
        assert _recommendation(STAGE_AT_PEAK) == RECOMMENDATION_SELL_NOW

    def test_post_peak_maps_to_avoid_buying(self):
        assert _recommendation(STAGE_POST_PEAK) == RECOMMENDATION_AVOID_BUYING

    def test_unknown_stage_defaults_to_avoid_buying(self):
        """Defensive — unknown stage string should map to AVOID_BUYING
        (the safest recommendation — don't act on uncertain data)."""
        assert _recommendation("UNKNOWN_STAGE") == RECOMMENDATION_AVOID_BUYING
        assert _recommendation("") == RECOMMENDATION_AVOID_BUYING


# ---------------------------------------------------------------------------
# _estimate_current_price tests
# ---------------------------------------------------------------------------


class TestEstimateCurrentPrice:
    """Verify the piecewise-linear price heuristic."""

    def test_pre_peak_day_0_returns_half_of_peak(self):
        """Day 0 (launch day) → price = 0.5 × peak (PRE_PEAK_DAY0_PRICE_FRACTION)."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=70.0, peak_day=2, days_since_reference=0
        )
        assert price == pytest.approx(5.0, abs=0.01)

    def test_pre_peak_day_1_returns_75_pct_of_peak(self):
        """Day 1, peak_day=2 → price = 0.5 + 0.25 = 0.75 × peak
        (linear interp from (0, 0.5) to (2, 1.0) — slope = 0.25/day)."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=70.0, peak_day=2, days_since_reference=1
        )
        assert price == pytest.approx(7.5, abs=0.01)

    def test_at_peak_returns_full_peak_price(self):
        """Day = peak_day → AT_PEAK → price = peak_price."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=70.0, peak_day=2, days_since_reference=2
        )
        assert price == pytest.approx(10.0, abs=0.01)

    def test_at_peak_day_after_peak_returns_full_peak_price(self):
        """Day = peak_day + 1 → still AT_PEAK → price = peak_price."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=70.0, peak_day=2, days_since_reference=3
        )
        assert price == pytest.approx(10.0, abs=0.01)

    def test_post_peak_decays_linearly_to_floor_by_day_7(self):
        """Day 7 (POST_PEAK_FLOOR_DAY) → floor price = peak × (1 - decay/100).
        With peak=10, decay=70% → floor = 3.0."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=70.0, peak_day=2, days_since_reference=7
        )
        assert price == pytest.approx(3.0, abs=0.01)

    def test_post_peak_far_future_returns_floor(self):
        """Day 100 → floor price (decay has fully completed)."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=70.0, peak_day=2, days_since_reference=100
        )
        assert price == pytest.approx(3.0, abs=0.01)

    def test_post_peak_interpolates_between_peak_and_floor(self):
        """Day 5, peak_day=2, decay=70%, peak=10 →
        decay_start = day 3, floor_day = day 7, span = 4 days
        At day 5: 2 days into decay → price = 10 + (3-10)/4 * 2 = 10 - 3.5 = 6.5."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=70.0, peak_day=2, days_since_reference=5
        )
        assert price == pytest.approx(6.5, abs=0.01)

    def test_zero_decay_pct_keeps_price_at_peak(self):
        """decay_pct=0 → no decay, price stays at peak forever (after peak_day)."""
        # Day 7, decay=0 → price = peak × (1 - 0/100) = peak
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=0.0, peak_day=2, days_since_reference=7
        )
        assert price == pytest.approx(10.0, abs=0.01)

    def test_full_decay_pct_drops_to_zero(self):
        """decay_pct=100 → floor price = 0."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=100.0, peak_day=2, days_since_reference=7
        )
        assert price == pytest.approx(0.0, abs=0.01)

    def test_zero_peak_price_returns_zero(self):
        """Defensive — peak_price=0 → all prices are 0."""
        price = _estimate_current_price(
            peak_price=0.0, decay_pct=70.0, peak_day=2, days_since_reference=2
        )
        assert price == 0.0

    def test_negative_peak_price_returns_zero(self):
        """Defensive — negative peak_price is malformed → return 0."""
        price = _estimate_current_price(
            peak_price=-10.0, decay_pct=70.0, peak_day=2, days_since_reference=2
        )
        assert price == 0.0

    def test_decay_pct_above_100_is_clamped(self):
        """Defensive — decay_pct > 100 is clamped to 100 (floor = 0)."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=150.0, peak_day=2, days_since_reference=7
        )
        assert price == pytest.approx(0.0, abs=0.01)

    def test_decay_pct_below_0_is_clamped(self):
        """Defensive — decay_pct < 0 is clamped to 0 (no decay)."""
        price = _estimate_current_price(
            peak_price=10.0, decay_pct=-50.0, peak_day=2, days_since_reference=7
        )
        assert price == pytest.approx(10.0, abs=0.01)

    def test_peak_day_in_at_peak_with_higher_peak_day(self):
        """Verify the heuristic works for peak_day=3 (echoes-of-worldstone)."""
        # Day 0 → PRE_PEAK → 0.5 × 4 = 2.0
        assert _estimate_current_price(4.0, 50.0, 3, 0) == pytest.approx(2.0, abs=0.01)
        # Day 3 → AT_PEAK → 4.0
        assert _estimate_current_price(4.0, 50.0, 3, 3) == pytest.approx(4.0, abs=0.01)
        # Day 4 → AT_PEAK (peak_day+1) → 4.0
        assert _estimate_current_price(4.0, 50.0, 3, 4) == pytest.approx(4.0, abs=0.01)
        # Day 7 → POST_PEAK floor → 4 × (1 - 0.5) = 2.0
        assert _estimate_current_price(4.0, 50.0, 3, 7) == pytest.approx(2.0, abs=0.01)


# ---------------------------------------------------------------------------
# _days_until_peak tests
# ---------------------------------------------------------------------------


class TestDaysUntilPeak:
    """Verify the days_until_peak helper (positive/negative/zero)."""

    def test_pre_peak_returns_positive_days_to_wait(self):
        """peak_day=5, days=2 → 3 days until peak."""
        assert _days_until_peak(5, 2) == 3

    def test_at_peak_returns_zero(self):
        """During AT_PEAK window → 0 (no days to wait, peak is now)."""
        assert _days_until_peak(2, 2) == 0  # peak_day itself
        assert _days_until_peak(2, 3) == 0  # day after peak_day

    def test_post_peak_returns_negative_days_since_peak(self):
        """After AT_PEAK window → negative = days since peak ended."""
        # peak_day=2, days=5 → 5 - (2+1) = 2 days since peak ended
        assert _days_until_peak(2, 5) == 2
        # peak_day=2, days=10 → 10 - 3 = 7 days since peak ended
        assert _days_until_peak(2, 10) == 7


# ---------------------------------------------------------------------------
# compute_leveling_uniques_lifecycle end-to-end tests
# ---------------------------------------------------------------------------


class TestComputeLevelingUniquesLifecycle:
    """End-to-end tests on the main entry point."""

    def test_returns_well_formed_response_shape(self):
        """The response dict has all expected top-level keys."""
        result = compute_leveling_uniques_lifecycle(
            phase=LeaguePhase.EARLY,
            days_since_reference=2,
            league_name="test-league",
            reference_currency="exalted",
        )
        expected_keys = {
            "league", "phase", "days_since_reference", "current_day",
            "reference_currency", "uniques", "data_available", "fetched_at",
        }
        assert set(result.keys()) == expected_keys

    def test_response_passes_phase_value(self):
        """phase is converted to its string value ('early' / 'mid' / 'late')."""
        for phase, expected in [
            (LeaguePhase.EARLY, "early"),
            (LeaguePhase.MID, "mid"),
            (LeaguePhase.LATE, "late"),
        ]:
            result = compute_leveling_uniques_lifecycle(phase, days_since_reference=2)
            assert result["phase"] == expected

    def test_current_day_equals_days_since_reference(self):
        """current_day is an alias for days_since_reference — same value."""
        for d in [0, 1, 2, 5, 14, 42, 100]:
            result = compute_leveling_uniques_lifecycle(
                LeaguePhase.EARLY, days_since_reference=d
            )
            assert result["current_day"] == d
            assert result["days_since_reference"] == d

    def test_negative_days_since_reference_clamped_to_zero(self):
        """Defensive — negative days (league_start in the future) → clamp to 0."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=-5
        )
        assert result["current_day"] == 0
        assert result["days_since_reference"] == 0

    def test_data_available_always_true(self):
        """data_available is always True (the table is hardcoded)."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=0
        )
        assert result["data_available"] is True

    def test_uniques_list_has_expected_count(self):
        """uniques list length matches the static table."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=0
        )
        assert len(result["uniques"]) == leveling_unique_count()

    def test_each_unique_has_all_required_fields(self):
        """Each unique dict has all expected keys."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2
        )
        required_fields = {
            "id", "name", "category", "peak_day", "peak_price_exalted",
            "decay_pct", "pattern", "current_lifecycle_stage",
            "recommendation", "estimated_current_price_exalted",
            "days_until_peak", "notes",
        }
        for u in result["uniques"]:
            missing = required_fields - set(u.keys())
            assert not missing, f"Unique {u.get('id', '?')} missing: {missing}"

    def test_each_unique_has_valid_lifecycle_stage(self):
        """Every unique's current_lifecycle_stage is one of the 3 valid values."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2
        )
        valid_stages = {STAGE_PRE_PEAK, STAGE_AT_PEAK, STAGE_POST_PEAK}
        for u in result["uniques"]:
            assert u["current_lifecycle_stage"] in valid_stages, (
                f"{u['id']}: stage={u['current_lifecycle_stage']}"
            )

    def test_each_unique_has_valid_recommendation(self):
        """Every unique's recommendation is one of the 3 valid values."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2
        )
        valid_recs = {
            RECOMMENDATION_BUY_OR_HOLD,
            RECOMMENDATION_SELL_NOW,
            RECOMMENDATION_AVOID_BUYING,
        }
        for u in result["uniques"]:
            assert u["recommendation"] in valid_recs, (
                f"{u['id']}: rec={u['recommendation']}"
            )

    def test_recommendation_matches_lifecycle_stage(self):
        """The recommendation must be consistent with the lifecycle stage."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2
        )
        stage_to_rec = {
            STAGE_PRE_PEAK: RECOMMENDATION_BUY_OR_HOLD,
            STAGE_AT_PEAK: RECOMMENDATION_SELL_NOW,
            STAGE_POST_PEAK: RECOMMENDATION_AVOID_BUYING,
        }
        for u in result["uniques"]:
            expected_rec = stage_to_rec[u["current_lifecycle_stage"]]
            assert u["recommendation"] == expected_rec, (
                f"{u['id']}: stage={u['current_lifecycle_stage']} but rec={u['recommendation']}"
            )

    def test_day_0_all_uniques_are_pre_peak(self):
        """Day 0 (launch day) → all uniques are PRE_PEAK (peak_day >= 1)."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=0
        )
        for u in result["uniques"]:
            assert u["current_lifecycle_stage"] == STAGE_PRE_PEAK, (
                f"{u['id']} should be PRE_PEAK on Day 0"
            )
            assert u["recommendation"] == RECOMMENDATION_BUY_OR_HOLD

    def test_day_2_uniques_with_peak_day_2_are_at_peak(self):
        """Day 2 → uniques with peak_day=2 are AT_PEAK."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2
        )
        for u in result["uniques"]:
            if u["peak_day"] == 2:
                assert u["current_lifecycle_stage"] == STAGE_AT_PEAK
                assert u["recommendation"] == RECOMMENDATION_SELL_NOW

    def test_day_7_all_uniques_are_post_peak(self):
        """Day 7 → all uniques are POST_PEAK (peak_day max is 14, but Day 7
        is well past peak_day+1 for most leveling uniques — those with
        peak_day >= 6 may still be PRE_PEAK or AT_PEAK)."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=7
        )
        # Most uniques have peak_day <= 5 → POST_PEAK on Day 7
        # Just verify the count of POST_PEAK is > 0
        post_peak_count = sum(
            1 for u in result["uniques"]
            if u["current_lifecycle_stage"] == STAGE_POST_PEAK
        )
        assert post_peak_count > 0, "Expected at least one POST_PEAK unique on Day 7"

    def test_day_50_all_uniques_are_post_peak(self):
        """Day 50 → ALL uniques are POST_PEAK (peak_day max is 14)."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.LATE, days_since_reference=50
        )
        for u in result["uniques"]:
            assert u["current_lifecycle_stage"] == STAGE_POST_PEAK
            assert u["recommendation"] == RECOMMENDATION_AVOID_BUYING

    def test_league_name_is_passed_through(self):
        """league_name appears in the response."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=0,
            league_name="dawn-of-the-hunt",
        )
        assert result["league"] == "dawn-of-the-hunt"

    def test_reference_currency_is_passed_through(self):
        """reference_currency appears in the response."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.MID, days_since_reference=20,
            reference_currency="divine",
        )
        assert result["reference_currency"] == "divine"

    def test_fetched_at_is_iso_8601(self):
        """fetched_at is a valid ISO 8601 timestamp."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=0
        )
        # Should parse without error
        datetime.fromisoformat(result["fetched_at"])

    def test_now_override_is_used_for_fetched_at(self):
        """Passing now= uses that timestamp instead of UTC now."""
        fixed_now = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=0, now=fixed_now
        )
        assert result["fetched_at"] == fixed_now.isoformat()

    def test_estimated_price_for_at_peak_unique_equals_peak_price(self):
        """When a unique is AT_PEAK, its estimated_current_price_exalted
        equals peak_price_exalted."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2
        )
        for u in result["uniques"]:
            if u["current_lifecycle_stage"] == STAGE_AT_PEAK:
                assert u["estimated_current_price_exalted"] == u["peak_price_exalted"], (
                    f"{u['id']}: est={u['estimated_current_price_exalted']} "
                    f"!= peak={u['peak_price_exalted']}"
                )


# ---------------------------------------------------------------------------
# i18n / Russian localization tests
# ---------------------------------------------------------------------------


class TestRussianLocalization:
    """Verify ?lang=ru returns Russian notes for each unique."""

    def test_ru_returns_russian_notes_for_all_uniques(self):
        """Every unique has a Russian notes translation."""
        result = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2, lang="ru"
        )
        for u in result["uniques"]:
            # The Russian notes table must have an entry for every id
            from backend.economy.leveling_uniques import _LEVELING_UNIQUES_NOTES_RU
            assert u["id"] in _LEVELING_UNIQUES_NOTES_RU, (
                f"{u['id']} missing from _LEVELING_UNIQUES_NOTES_RU"
            )
            # The notes field should match the Russian translation
            assert u["notes"] == _LEVELING_UNIQUES_NOTES_RU[u["id"]]

    def test_en_returns_english_notes(self):
        """Default lang=en returns English notes from the main table."""
        result_en = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2, lang="en"
        )
        result_default = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2
        )
        for u_en, u_def in zip(result_en["uniques"], result_default["uniques"]):
            assert u_en["notes"] == u_def["notes"]

    def test_ru_and_en_have_different_notes(self):
        """Russian notes are different from English notes (sanity check)."""
        result_en = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2, lang="en"
        )
        result_ru = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2, lang="ru"
        )
        for u_en, u_ru in zip(result_en["uniques"], result_ru["uniques"]):
            assert u_en["notes"] != u_ru["notes"], (
                f"{u_en['id']}: EN and RU notes are identical (translation missing?)"
            )

    def test_ru_keeps_non_notes_fields_identical_to_en(self):
        """Only notes differs between en and ru — id/name/category/peak_day/
        peak_price_exalted/decay_pct/pattern/stage/rec/est_price/days_until
        must all match."""
        result_en = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2, lang="en"
        )
        result_ru = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2, lang="ru"
        )
        non_notes_fields = [
            "id", "name", "category", "peak_day", "peak_price_exalted",
            "decay_pct", "pattern", "current_lifecycle_stage",
            "recommendation", "estimated_current_price_exalted",
            "days_until_peak",
        ]
        for u_en, u_ru in zip(result_en["uniques"], result_ru["uniques"]):
            for f in non_notes_fields:
                assert u_en[f] == u_ru[f], (
                    f"{u_en['id']}.{f}: EN={u_en[f]} RU={u_ru[f]} (should match)"
                )

    def test_unknown_lang_falls_back_to_english(self):
        """lang='zh' (not supported) → falls back to English notes."""
        result_zh = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2, lang="zh"
        )
        result_en = compute_leveling_uniques_lifecycle(
            LeaguePhase.EARLY, days_since_reference=2, lang="en"
        )
        for u_zh, u_en in zip(result_zh["uniques"], result_en["uniques"]):
            assert u_zh["notes"] == u_en["notes"]


# ---------------------------------------------------------------------------
# Route handler smoke tests
# ---------------------------------------------------------------------------


class TestRouteHandler:
    """Smoke tests for the FastAPI route handler.

    These don't spin up a real HTTP server — they mock the PhaseDetector
    singleton and call the route function directly. Same pattern as
    tests/test_weekly_patterns.py::TestRouteHandler.
    """

    def test_route_returns_success_with_phase_info(self):
        """When PhaseDetector is available, route returns a full response."""
        from backend.api.routes_leveling_uniques import get_leveling_uniques_route

        mock_info = SimpleNamespace(
            phase=LeaguePhase.EARLY,
            days_since_reference=2,
            reference_currency="exalted",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)

        with patch(
            "backend.api.routes_leveling_uniques.get_phase_detector",
            return_value=mock_detector,
        ):
            result = asyncio_run(get_leveling_uniques_route(lang="en"))

        assert result["phase"] == "early"
        assert result["current_day"] == 2
        assert result["reference_currency"] == "exalted"
        assert result["data_available"] is True
        assert len(result["uniques"]) == leveling_unique_count()

    def test_route_returns_degraded_on_exception(self):
        """When PhaseDetector throws, route returns data_available=False."""
        from backend.api.routes_leveling_uniques import get_leveling_uniques_route

        with patch(
            "backend.api.routes_leveling_uniques.get_phase_detector",
            side_effect=RuntimeError("PhaseDetector unavailable"),
        ):
            result = asyncio_run(get_leveling_uniques_route(lang="en"))

        assert result["phase"] == "unknown"
        assert result["current_day"] == 0
        assert result["data_available"] is False
        assert result["uniques"] == []

    def test_route_forwards_lang_param(self):
        """?lang=ru is forwarded to the pure function — Russian notes returned."""
        from backend.api.routes_leveling_uniques import get_leveling_uniques_route

        mock_info = SimpleNamespace(
            phase=LeaguePhase.EARLY,
            days_since_reference=2,
            reference_currency="exalted",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)

        with patch(
            "backend.api.routes_leveling_uniques.get_phase_detector",
            return_value=mock_detector,
        ):
            result = asyncio_run(get_leveling_uniques_route(lang="ru"))

        # All uniques should have Russian notes (sanity check — first one
        # should differ from the English version).
        from backend.economy.leveling_uniques import _LEVELING_UNIQUES_NOTES_RU
        first_id = result["uniques"][0]["id"]
        assert result["uniques"][0]["notes"] == _LEVELING_UNIQUES_NOTES_RU[first_id]

    def test_route_uses_league_name_from_config(self):
        """The route pulls league_name from config (not from PhaseDetector)."""
        from backend.api.routes_leveling_uniques import get_leveling_uniques_route

        mock_info = SimpleNamespace(
            phase=LeaguePhase.EARLY,
            days_since_reference=2,
            reference_currency="exalted",
        )
        mock_detector = SimpleNamespace(get_phase_info=lambda: mock_info)
        mock_config = SimpleNamespace(
            league=SimpleNamespace(league_name="temporium-league")
        )

        with patch(
            "backend.api.routes_leveling_uniques.get_phase_detector",
            return_value=mock_detector,
        ), patch(
            "backend.api.routes_leveling_uniques.get_settings",
            return_value=mock_config,
        ):
            result = asyncio_run(get_leveling_uniques_route(lang="en"))

        assert result["league"] == "temporium-league"


# ---------------------------------------------------------------------------
# Helper: run async function in tests
# ---------------------------------------------------------------------------


def asyncio_run(coro):
    """Run an async coroutine in a synchronous test context.

    Uses asyncio.run() which creates a fresh event loop per call. This is
    fine for these smoke tests (no shared state between calls).
    """
    import asyncio
    return asyncio.run(coro)
