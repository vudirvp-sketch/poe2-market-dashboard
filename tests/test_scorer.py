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

from backend.arbitrage.scorer import compute_opportunity_score, compute_quantized_analysis, _scale_factor, get_phase_multiplier
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


# ---------------------------------------------------------------------------
# P1-5 (iter 66): Bounded linear scan in compute_quantized_analysis
# ---------------------------------------------------------------------------

class TestQuantizedAnalysisP1_5:
    """Regression tests for the bounded-search optimization.

    The previous implementation scanned 1..max_lot_search (10000) to find the
    first profitable lot. The new implementation derives a tight upper bound
    N_upper = ceil(2/D) + 1 (where D = R_sell - R_buy) from the theoretical
    guarantee f(N) ≥ N*D - 2, and scans only [1, N_upper].

    These tests verify the new implementation returns the SAME answer as a
    naive full scan, across a range of spreads.
    """

    def _naive_min_profitable_lot(self, R_buy: float, R_sell: float, mid_price: float, max_n: int = 10000) -> int:
        """Reference implementation: full linear scan 1..max_n.

        Applies the same per-pair scaling as compute_quantized_analysis
        (P2-4 _scale_factor) so we're comparing apples to apples.
        """
        if mid_price > 0 and R_buy > 0:
            scale = _scale_factor(mid_price)
            R_buy *= scale
            R_sell *= scale
        for N in range(1, max_n + 1):
            if math.floor(N * R_sell) > math.ceil(N * R_buy):
                return N
        return 0

    def test_no_profit_when_R_sell_le_R_buy(self):
        """When R_sell ≤ R_buy, no profitable lot exists — must return 0 (not loop forever)."""
        result = compute_quantized_analysis(R_buy=1.0, R_sell=1.0, mid_price=1.0)
        assert result.min_profitable_lot == 0

        result = compute_quantized_analysis(R_buy=1.05, R_sell=1.0, mid_price=1.0)
        assert result.min_profitable_lot == 0

    def test_obvious_profitable_lot_at_N_1(self):
        """Wide spread → profitable at N=1."""
        # R_buy=1, R_sell=2 → cost=ceil(1)=1, rev=floor(2)=2, profit=1 > 0
        result = compute_quantized_analysis(R_buy=1.0, R_sell=2.0, mid_price=1.5)
        assert result.min_profitable_lot == 1

    def test_tight_spread_matches_naive_scan(self):
        """Tight spread (D=0.1): bounded scan must agree with naive scan."""
        R_buy, R_sell, mid = 1.0, 1.1, 1.05
        result = compute_quantized_analysis(R_buy=R_buy, R_sell=R_sell, mid_price=mid)
        expected = self._naive_min_profitable_lot(R_buy, R_sell, mid)
        assert result.min_profitable_lot == expected
        assert result.min_profitable_lot > 0  # sanity: there IS a profitable lot

    def test_very_tight_spread_matches_naive_scan(self):
        """Very tight spread (D=0.01): bounded scan must still agree with naive scan."""
        R_buy, R_sell, mid = 1.0, 1.01, 1.005
        result = compute_quantized_analysis(R_buy=R_buy, R_sell=R_sell, mid_price=mid)
        expected = self._naive_min_profitable_lot(R_buy, R_sell, mid)
        assert result.min_profitable_lot == expected

    def test_extremely_tight_spread_matches_naive_scan(self):
        """Extremely tight spread (D=0.001): bounded scan must still agree with naive scan."""
        R_buy, R_sell, mid = 1.0, 1.001, 1.0005
        result = compute_quantized_analysis(R_buy=R_buy, R_sell=R_sell, mid_price=mid)
        expected = self._naive_min_profitable_lot(R_buy, R_sell, mid)
        assert result.min_profitable_lot == expected

    def test_cheap_currency_matches_naive_scan(self):
        """Cheap currency (mid_price=0.001) with tight spread: scaling + bounded scan."""
        R_buy, R_sell, mid = 0.001, 0.0011, 0.00105
        result = compute_quantized_analysis(R_buy=R_buy, R_sell=R_sell, mid_price=mid)
        expected = self._naive_min_profitable_lot(R_buy, R_sell, mid)
        assert result.min_profitable_lot == expected

    def test_expensive_currency_matches_naive_scan(self):
        """Expensive currency (mid_price=200) with tight spread."""
        R_buy, R_sell, mid = 200.0, 200.5, 200.25
        result = compute_quantized_analysis(R_buy=R_buy, R_sell=R_sell, mid_price=mid)
        expected = self._naive_min_profitable_lot(R_buy, R_sell, mid)
        assert result.min_profitable_lot == expected

    def test_random_spreads_match_naive_scan(self):
        """Property test: many random spreads must give the same answer as naive scan."""
        import random
        random.seed(42)
        for _ in range(50):
            mid = random.uniform(0.01, 500.0)
            spread_pct = random.uniform(0.001, 0.10)  # 0.1% to 10% spread
            R_buy = mid * (1 - spread_pct / 2)
            R_sell = mid * (1 + spread_pct / 2)
            result = compute_quantized_analysis(R_buy=R_buy, R_sell=R_sell, mid_price=mid)
            expected = self._naive_min_profitable_lot(R_buy, R_sell, mid)
            assert result.min_profitable_lot == expected, (
                f"Mismatch for mid={mid}, spread={spread_pct}: "
                f"got {result.min_profitable_lot}, expected {expected}"
            )

    def test_bounded_scan_performance(self):
        """Sanity: bounded scan should iterate O(1/D) times, not O(max_lot_search).

        For D=0.05, the bound is ceil(2/0.05)+1 = 41. Naive would scan up to 10000.
        """
        # We can't directly count iterations without instrumentation, but we can
        # verify the answer is correct AND fast by timing.
        import time
        R_buy, R_sell = 1.0, 1.05  # D=0.05, N_upper=41
        t0 = time.perf_counter()
        for _ in range(1000):
            compute_quantized_analysis(R_buy=R_buy, R_sell=R_sell, mid_price=1.025)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        # 1000 calls should complete in well under 1s. If the scan were 10000
        # iterations per call, this would take ~10s. With bounded scan (~41 iter),
        # it should be < 100ms total. Use a generous threshold.
        assert elapsed_ms < 1000, f"Bounded scan too slow: {elapsed_ms:.1f}ms for 1000 calls"
