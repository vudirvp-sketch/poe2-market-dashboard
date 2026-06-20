"""
Regression tests for `backend.economy.pricing` — unified pricing helpers.

P0-5 (iter 57): These tests pin the behaviour of:
  - `compute_transitive_prices` — BFS over the pair graph. Previously
    `backend/scheduler.py:collect_price_snapshot` used a 5-iteration
    relaxation loop, which silently missed currencies whose shortest
    path from the base currency exceeded 5 hops. The BFS does not have
    a depth limit.
  - `find_price_24h_ago` — timestamp-aware ±6h-drift lookup, extracted
    here from `routes_arbitrage.py` so both `routes_arbitrage` and
    `routes_analyst` import the same canonical helper.

Why a new test file?
    The existing `tests/e2e/test_analyst.py` already covers the
    behaviour of `_find_price_24h_ago` indirectly (via `_compute_trends`).
    But `_find_price_24h_ago` is now `find_price_24h_ago` in
    `backend.economy.pricing` — we want a unit test that targets the
    helper directly, so that a future refactor of `_compute_trends`
    cannot accidentally regress the 24h-ago logic.

    `compute_transitive_prices` had NO test coverage at all before
    iter 57 — the 5-iteration relaxation bug in `scheduler.py` was
    never caught because no test exercises a >5-hop pair chain.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest

from backend.economy.pricing import compute_transitive_prices, find_price_24h_ago


# ---------------------------------------------------------------------------
# Lightweight ExchangeRate-like stub — compute_transitive_prices only reads
# `currency_from`, `currency_to`, `raw_rate`. Using a real ExchangeRate would
# pull in extra required fields and make the test fixtures noisier.
# ---------------------------------------------------------------------------

@dataclass
class _Rate:
    currency_from: str
    currency_to: str
    raw_rate: float


# ---------------------------------------------------------------------------
# compute_transitive_prices — BFS depth-agnostic
# ---------------------------------------------------------------------------

class TestComputeTransitivePricesBFS:
    """Verify the BFS finds prices for arbitrarily-deep chains."""

    def test_direct_rates_unchanged(self):
        """Currencies with a direct rate to the base keep that price."""
        base = "exalted"
        prices_in_base = {base: 1.0, "chaos": 0.1}  # direct: 10 chaos = 1 exa
        rates = {
            "exalted/chaos": _Rate("exalted", "chaos", 10.0),
        }
        compute_transitive_prices(prices_in_base, rates, base)
        # Direct rate wins; transitive step finds nothing new.
        assert prices_in_base["exalted"] == 1.0
        assert prices_in_base["chaos"] == 0.1
        assert set(prices_in_base.keys()) == {"exalted", "chaos"}

    def test_one_hop_transitive(self):
        """A currency priced through a single intermediate."""
        base = "exalted"
        prices_in_base = {base: 1.0, "chaos": 0.1}  # 10 chaos = 1 exa
        rates = {
            "exalted/chaos": _Rate("exalted", "chaos", 10.0),
            # 1 chaos = 2 wisdoms → 1 wisdom = 0.5 chaos = 0.05 exa
            "chaos/wisdom": _Rate("chaos", "wisdom", 2.0),
        }
        compute_transitive_prices(prices_in_base, rates, base)
        assert prices_in_base["wisdom"] == pytest.approx(0.05)

    def test_seven_hop_chain_bfs_finds_it(self):
        """The bug: 5-iteration relaxation missed chains deeper than 5 hops.

        Layout (base = A0, chain A0 → A1 → A2 → ... → A7).
        Each edge has rate 2.0, meaning "1 unit of currency_from = 2 units
        of currency_to". So each next currency is worth HALF as much as
        its predecessor in the base numeraire:
            A0 = 1.0                    (base, depth 0)
            A1 = A0 / 2 = 0.5           (1 hop)
            A2 = A1 / 2 = 0.25          (2 hops)
            A3 = A2 / 2 = 0.125         (3 hops)
            A4 = A3 / 2 = 0.0625        (4 hops)
            A5 = A4 / 2 = 0.03125       (5 hops — relaxation got here)
            A6 = A5 / 2 = 0.015625      (6 hops — relaxation MISSED this)
            A7 = A6 / 2 = 0.0078125     (7 hops — relaxation MISSED this)

        Old behaviour (5-iter relaxation): A6 and A7 never appear in
        prices_in_base, so scheduler would fall back to `rate.raw_rate`
        as the price_in_base — a silently wrong value (2.0 instead of
        0.015625 / 0.0078125).

        New behaviour (BFS): all reachable currencies get a price.
        """
        base = "A0"
        prices_in_base = {base: 1.0}  # only the base; BFS finds everything else
        rates = {
            "A0/A1": _Rate("A0", "A1", 2.0),
            "A1/A2": _Rate("A1", "A2", 2.0),
            "A2/A3": _Rate("A2", "A3", 2.0),
            "A3/A4": _Rate("A3", "A4", 2.0),
            "A4/A5": _Rate("A4", "A5", 2.0),
            "A5/A6": _Rate("A5", "A6", 2.0),
            "A6/A7": _Rate("A6", "A7", 2.0),
        }
        compute_transitive_prices(prices_in_base, rates, base)

        expected = {
            "A0": 1.0,
            "A1": 0.5,
            "A2": 0.25,
            "A3": 0.125,
            "A4": 0.0625,
            "A5": 0.03125,
            "A6": 0.015625,
            "A7": 0.0078125,
        }
        for currency, expected_price in expected.items():
            assert currency in prices_in_base, (
                f"BFS should reach {currency}, "
                f"but prices_in_base only has: {sorted(prices_in_base.keys())}"
            )
            assert prices_in_base[currency] == pytest.approx(expected_price), (
                f"{currency}: expected {expected_price}, got {prices_in_base[currency]}"
            )

    def test_reverse_direction_edges(self):
        """Edges where the base-adjacent currency is the `currency_to`.

        Rate convention (matches `ExchangeRate.raw_rate`):
            rate(c1 → c2) = R means 1 unit of c1 = R units of c2.
        So if 1 divine = 220 exalted (rate div→exa = 220), then
        1 exalted = 1/220 divine, and 1 divine is worth 220 exalted.
        We pre-seed divine = 0.0045 (i.e. 1 divine = 0.0045 exalted,
        ~220 exalted per divine). Then 1 wisdom = 1/50 divine =
        0.0045/50 = 0.00009 exalted.
        """
        base = "exalted"
        prices_in_base = {base: 1.0, "divine": 0.0045}  # ~220 exa per divine
        rates = {
            # 1 divine = 220 exalted
            "divine/exalted": _Rate("divine", "exalted", 220.0),
            # 1 divine = 50 wisdoms → 1 wisdom = 1/50 divine = 0.0045/50 exa
            "divine/wisdom": _Rate("divine", "wisdom", 50.0),
        }
        compute_transitive_prices(prices_in_base, rates, base)
        assert prices_in_base["wisdom"] == pytest.approx(0.0045 / 50.0)

    def test_negative_rate_skipped(self):
        """Edges with non-positive raw_rate must be ignored."""
        base = "exalted"
        prices_in_base = {base: 1.0}
        rates = {
            "exalted/bad": _Rate("exalted", "bad", -1.0),
            "exalted/zero": _Rate("exalted", "zero", 0.0),
            "exalted/good": _Rate("exalted", "good", 5.0),
        }
        compute_transitive_prices(prices_in_base, rates, base)
        assert "good" in prices_in_base
        assert "bad" not in prices_in_base
        assert "zero" not in prices_in_base

    def test_disconnected_currency_never_priced(self):
        """A currency with no path to the base is left alone."""
        base = "exalted"
        prices_in_base = {base: 1.0, "chaos": 0.1}
        rates = {
            "exalted/chaos": _Rate("exalted", "chaos", 10.0),
            # 'stray' only pairs with itself (impossible but tests robustness)
            "stray/stray": _Rate("stray", "stray", 1.0),
        }
        compute_transitive_prices(prices_in_base, rates, base)
        assert "stray" not in prices_in_base

    def test_existing_prices_not_overwritten_by_transitive(self):
        """Transitive step must NOT overwrite a direct price (direct wins)."""
        base = "exalted"
        # Direct: 1 exa = 10 chaos → chaos = 0.1
        # But we pre-seed chaos = 99.0 (a deliberate sentinel)
        prices_in_base = {base: 1.0, "chaos": 99.0}
        rates = {
            "exalted/chaos": _Rate("exalted", "chaos", 10.0),
        }
        compute_transitive_prices(prices_in_base, rates, base)
        # Direct entry wins; sentinel survives.
        assert prices_in_base["chaos"] == 99.0


# ---------------------------------------------------------------------------
# find_price_24h_ago — extracted from routes_arbitrage._find_price_24h_ago
# ---------------------------------------------------------------------------

def _ts(hours_ago: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=hours_ago)


class TestFindPrice24hAgo:
    """Verify the 24h-ago lookup with drift tolerance."""

    def test_empty_history_returns_none(self):
        assert find_price_24h_ago([]) is None

    def test_exact_24h_match(self):
        """A point exactly 24h ago is returned."""
        history = [(_ts(24), 100.0)]
        assert find_price_24h_ago(history) == 100.0

    def test_picks_closest_to_24h(self):
        """With multiple points, the one closest to 24h ago wins."""
        history = [
            (_ts(48), 50.0),
            (_ts(26), 80.0),
            (_ts(24), 100.0),  # closest
            (_ts(22), 120.0),
            (_ts(0), 200.0),
        ]
        assert find_price_24h_ago(history) == 100.0

    def test_drift_within_tolerance_accepted(self):
        """A point 29h ago is within the ±6h default tolerance (drift = 5h).

        We use 29h (not 30h) to stay safely inside the 6h boundary — at
        exactly 30h the drift is 6h and the strict `>` check makes the
        boundary time-sensitive (a microsecond delay between test
        setup and the function call pushes drift past 6h).
        """
        history = [(_ts(29), 110.0)]
        assert find_price_24h_ago(history) == 110.0

    def test_drift_outside_tolerance_rejected(self):
        """A point 36h ago is OUTSIDE the ±6h default tolerance (drift = 12h)."""
        history = [(_ts(36), 110.0)]
        assert find_price_24h_ago(history) is None

    def test_custom_max_drift_hours(self):
        """Caller can widen the drift window."""
        history = [(_ts(36), 110.0)]
        assert find_price_24h_ago(history, max_drift_hours=15.0) == 110.0

    def test_naive_timestamps_treated_as_utc(self):
        """Timezone-naive timestamps are interpreted as UTC for comparison."""
        naive_24h_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
        history = [(naive_24h_ago, 75.0)]
        assert find_price_24h_ago(history) == 75.0

    def test_picks_closest_even_when_all_within_drift(self):
        """When every point is within drift, the closest one wins."""
        history = [
            (_ts(20), 50.0),
            (_ts(23), 90.0),  # closest to 24h ago
            (_ts(28), 130.0),
        ]
        assert find_price_24h_ago(history) == 90.0
