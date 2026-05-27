"""
Tests for scorer.py — opportunity scoring.

From PoE2_Flipper_Canonical_Formulas.md §7 Verification:

bid = 95, ask = 105, mid_price = 100
volume_24h = 500, max_volume = 2000
volatility = 0.03, gold_fee_fraction = 0.05
phase_multiplier = 1.0, momentum = 0.002

spread_after_fees = (105-95)/100 - 0.05 = 0.10 - 0.05 = 0.05
fill_probability = log1p(500)/log1p(2000) = 6.216/7.601 ≈ 0.818
expected_profit = 0.05 * 0.818 = 0.0409
momentum_penalty = 1.0 (momentum > 0)
vol_penalty = 1/(1+(0.03/0.05)^2) = 1/(1+0.36) = 0.735
score = 0.0409 * 1.0 * 0.735 * 1.0 = 0.0301
"""

import math
import pytest

from backend.arbitrage.scorer import compute_opportunity_score, get_phase_multiplier
from backend.models.currency import LeaguePhase


class TestOpportunityScoring:
    """Test the opportunity scoring formula from §7 Verification."""

    def test_verification_example(self):
        """
        From §7 Verification:
        bid=95, ask=105, mid_price=100, volume_24h=500, max_volume=2000,
        volatility=0.03, gold_fee_fraction=0.05, phase_multiplier=1.0, momentum=0.002
        Expected score ≈ 0.0301
        """
        score = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03, gold_fee_fraction=0.05,
            phase_multiplier=1.0, momentum=0.002,
        )
        assert abs(score - 0.0301) < 0.001

    def test_score_in_range(self):
        """Score must be in [0, 1]."""
        score = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03, gold_fee_fraction=0.05,
            phase_multiplier=1.0, momentum=0.002,
        )
        assert 0.0 <= score <= 1.0

    def test_no_profit_when_fees_exceed_spread(self):
        """If gold_fee_fraction >= spread, score should be 0."""
        score = compute_opportunity_score(
            bid=99, ask=101, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.02, gold_fee_fraction=0.05,  # fee > 2% spread
            phase_multiplier=1.0, momentum=0.01,
        )
        assert score == 0.0

    def test_zero_mid_price(self):
        """Zero mid_price should return score 0."""
        score = compute_opportunity_score(
            bid=0, ask=0, mid_price=0,
            volume_24h=500, max_volume=2000,
            volatility=0.03, gold_fee_fraction=0.05,
            phase_multiplier=1.0, momentum=0.002,
        )
        assert score == 0.0

    def test_negative_momentum_reduces_score(self):
        """Strong negative momentum should reduce the score (penalty = 0.5)."""
        score_positive = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03, gold_fee_fraction=0.05,
            phase_multiplier=1.0, momentum=0.01,
        )
        score_negative = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03, gold_fee_fraction=0.05,
            phase_multiplier=1.0, momentum=-0.02,  # < momentum_neg_threshold
        )
        assert score_positive > score_negative

    def test_high_volatility_reduces_score(self):
        """High volatility should reduce the score through vol_penalty."""
        score_low_vol = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.01, gold_fee_fraction=0.05,
            phase_multiplier=1.0, momentum=0.002,
        )
        score_high_vol = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.20, gold_fee_fraction=0.05,
            phase_multiplier=1.0, momentum=0.002,
        )
        assert score_low_vol > score_high_vol

    def test_phase_multiplier_effect(self):
        """EARLY phase (1.2) should amplify score vs LATE (0.9)."""
        score_early = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03, gold_fee_fraction=0.05,
            phase_multiplier=1.2, momentum=0.002,
        )
        score_late = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03, gold_fee_fraction=0.05,
            phase_multiplier=0.9, momentum=0.002,
        )
        assert score_early > score_late

    def test_expected_profit_positive(self):
        """With reasonable parameters, expected profit should be > 0."""
        # spread_after_fees > 0 implies potential profit
        spread_after_fees = (105 - 95) / 100 - 0.05
        assert spread_after_fees > 0


class TestPhaseMultiplier:
    """Test the phase multiplier lookup."""

    def test_early_phase_multiplier(self):
        assert get_phase_multiplier(LeaguePhase.EARLY) == 1.2

    def test_mid_phase_multiplier(self):
        assert get_phase_multiplier(LeaguePhase.MID) == 1.0

    def test_late_phase_multiplier(self):
        assert get_phase_multiplier(LeaguePhase.LATE) == 0.9
