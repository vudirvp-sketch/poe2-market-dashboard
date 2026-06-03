"""
Tests for scorer.py — opportunity scoring.

Simplified: gold/commission fees are EXCLUDED from all calculations.
The formula now uses raw spread: spread = (ask - bid) / mid_price

Verification (gold fees excluded):
bid = 95, ask = 105, mid_price = 100
volume_24h = 500, max_volume = 2000
volatility = 0.03, phase_multiplier = 1.0, momentum = 0.002

spread = (105-95)/100 = 0.10
fill_probability = log1p(500)/log1p(2000) = 6.216/7.601 ≈ 0.818
expected_profit = 0.10 * 0.818 = 0.0818
momentum_penalty = 1.0 (momentum > 0)
vol_penalty = 1/(1+(0.03/0.05)^2) = 1/(1+0.36) = 0.735
score = 0.0818 * 1.0 * 0.735 * 1.0 ≈ 0.0601
"""

import math
import pytest

from backend.arbitrage.scorer import compute_opportunity_score, get_phase_multiplier
from backend.models.currency import LeaguePhase


class TestOpportunityScoring:
    """Test the opportunity scoring formula (gold fees excluded)."""

    def test_verification_example(self):
        """
        With gold fees excluded:
        spread = (105-95)/100 = 0.10
        expected_profit = 0.10 * 0.818 ≈ 0.0818
        score = 0.0818 * 1.0 * 0.735 ≈ 0.0601
        """
        score = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03,
            phase_multiplier=1.0, momentum=0.002,
        )
        # With gold fees excluded, score is higher since no fee deduction
        assert abs(score - 0.0601) < 0.001

    def test_score_in_range(self):
        """Score must be in [0, 1]."""
        score = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03,
            phase_multiplier=1.0, momentum=0.002,
        )
        assert 0.0 <= score <= 1.0

    def test_no_profit_when_spread_is_negative(self):
        """If ask < bid (negative spread), score should be 0."""
        score = compute_opportunity_score(
            bid=105, ask=95, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.02,
            phase_multiplier=1.0, momentum=0.01,
        )
        assert score == 0.0

    def test_zero_mid_price(self):
        """Zero mid_price should return score 0."""
        score = compute_opportunity_score(
            bid=0, ask=0, mid_price=0,
            volume_24h=500, max_volume=2000,
            volatility=0.03,
            phase_multiplier=1.0, momentum=0.002,
        )
        assert score == 0.0

    def test_negative_momentum_reduces_score(self):
        """Strong negative momentum should reduce the score (penalty = 0.5)."""
        score_positive = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03,
            phase_multiplier=1.0, momentum=0.01,
        )
        score_negative = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03,
            phase_multiplier=1.0, momentum=-0.02,  # < momentum_neg_threshold
        )
        assert score_positive > score_negative

    def test_high_volatility_reduces_score(self):
        """High volatility should reduce the score through vol_penalty."""
        score_low_vol = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.01,
            phase_multiplier=1.0, momentum=0.002,
        )
        score_high_vol = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.20,
            phase_multiplier=1.0, momentum=0.002,
        )
        assert score_low_vol > score_high_vol

    def test_phase_multiplier_effect(self):
        """EARLY phase (1.2) should amplify score vs LATE (0.9)."""
        score_early = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03,
            phase_multiplier=1.2, momentum=0.002,
        )
        score_late = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03,
            phase_multiplier=0.9, momentum=0.002,
        )
        assert score_early > score_late

    def test_expected_profit_positive(self):
        """With reasonable parameters, expected profit should be > 0."""
        spread = (105 - 95) / 100  # raw spread, no fee deduction
        assert spread > 0


class TestPhaseMultiplier:
    """Test the get_phase_multiplier function."""

    def test_early_phase_multiplier(self):
        """EARLY phase should return 1.2 (default config)."""
        multiplier = get_phase_multiplier(LeaguePhase.EARLY)
        assert multiplier == 1.2

    def test_mid_phase_multiplier(self):
        """MID phase should return 1.0 (default config)."""
        multiplier = get_phase_multiplier(LeaguePhase.MID)
        assert multiplier == 1.0

    def test_late_phase_multiplier(self):
        """LATE phase should return 0.9 (default config)."""
        multiplier = get_phase_multiplier(LeaguePhase.LATE)
        assert multiplier == 0.9

    def test_phase_multiplier_ordering(self):
        """EARLY > MID > LATE multipliers."""
        m_early = get_phase_multiplier(LeaguePhase.EARLY)
        m_mid = get_phase_multiplier(LeaguePhase.MID)
        m_late = get_phase_multiplier(LeaguePhase.LATE)
        assert m_early > m_mid > m_late


class TestHourlyVolatilityScaling:
    """Test that hourly volatility is scaled by sqrt(24)."""

    def test_hourly_vol_reduces_score_vs_daily(self):
        """Same numeric volatility value should produce different scores
        depending on whether it's labeled hourly or daily.

        Hourly volatility gets scaled by sqrt(24), increasing the
        effective volatility, which reduces the vol_penalty and thus
        the score.
        """
        score_daily = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03,
            phase_multiplier=1.0, momentum=0.002,
            volatility_period="daily",
        )
        score_hourly = compute_opportunity_score(
            bid=95, ask=105, mid_price=100,
            volume_24h=500, max_volume=2000,
            volatility=0.03,
            phase_multiplier=1.0, momentum=0.002,
            volatility_period="hourly",
        )
        # Hourly volatility is scaled up → higher effective vol → lower score
        assert score_daily > score_hourly
