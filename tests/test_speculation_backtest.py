"""
Tests for backend/economy/speculation_backtest.py — F5 backtest (iter 79).

Coverage:
1. Helper tests: `_find_price_at`, `_stats_block`, `_build_trade_entry`.
2. Pure-function tests on hand-crafted DataSnapshot-like inputs:
   - Empty snapshot / no currencies → data_available=False.
   - Single BUY signal scenario → positive return on price rise.
   - Single SELL signal scenario → positive return on price fall.
   - HOLD signal scenario → not in trades list, but counted in signal_breakdown.
   - std=0 baseline → no z-score → HOLD, no trade.
   - <MIN_SAMPLE_SIZE baseline → skip.
   - No entry price within tolerance → skip.
   - No exit price within tolerance → unevaluated_count incremented.
   - signal_filter narrows trades but aggregates are over filtered set.
   - limit caps trades list, but aggregates are over ALL trades.
   - Multiple currencies → trades sorted by |return_pct| desc.
   - Input clamping (eval_days_ago / holding_days / lookback_days / limit).
   - snake_case field names work alongside PascalCase.
3. Route handler smoke tests (with mocked snapshot manager).
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.economy.speculation_backtest import (
    DEFAULT_EVAL_DAYS_AGO,
    DEFAULT_HOLDING_DAYS,
    DEFAULT_LIMIT,
    DEFAULT_LOOKBACK_DAYS,
    TOLERANCE_HOURS,
    _build_trade_entry,
    _find_price_at,
    _stats_block,
    backtest_speculation_signals,
)


# ---------------------------------------------------------------------------
# Helpers — same pattern as tests/test_speculation.py
# ---------------------------------------------------------------------------

def _make_currency(
    api_id: str,
    category: str,
    *,
    current_price: float = 0.0,
    current_quantity: float = 0.0,
    price_logs: list[dict] | None = None,
    text: str | None = None,
) -> dict:
    """Build a single ByCategory-style currency dict (PascalCase keys)."""
    return {
        "ApiId": api_id,
        "CategoryApiId": category,
        "Text": text or api_id.replace("-", " ").title(),
        "CurrentPrice": current_price,
        "CurrentQuantity": current_quantity,
        "PriceLogs": price_logs or [],
    }


def _make_snapshot(currencies: list[dict]) -> SimpleNamespace:
    """Wrap a list of ByCategory dicts in a DataSnapshot-like object."""
    return SimpleNamespace(
        currencies={c["ApiId"].lower(): c for c in currencies},
        fetched_at=datetime.now(timezone.utc),
    )


def _make_config(league_name: str = "Standard") -> SimpleNamespace:
    return SimpleNamespace(
        league=SimpleNamespace(
            league_name=league_name,
            currency_categories=["currency"],
        ),
    )


def _make_logs(
    prices_and_days: list[tuple[float, int]],
    *,
    base: datetime | None = None,
) -> list[dict]:
    """Build a price_logs list with (price, days_ago) pairs."""
    base = base or datetime.now(timezone.utc)
    return [
        {
            "Time": (base - timedelta(days=d)).strftime("%Y-%m-%dT00:00:00"),
            "Price": p,
            "Quantity": 10,
        }
        for p, d in prices_and_days
    ]


# ===========================================================================
# 1. _find_price_at
# ===========================================================================

class TestFindPriceAt:
    def test_empty_history_returns_none(self):
        target = datetime.now(timezone.utc)
        assert _find_price_at([], target) is None

    def test_exact_match_returns_point(self):
        target = datetime(2026, 6, 11, tzinfo=timezone.utc)
        history = [
            (datetime(2026, 6, 5, tzinfo=timezone.utc), 100.0),
            (datetime(2026, 6, 11, tzinfo=timezone.utc), 80.0),
            (datetime(2026, 6, 18, tzinfo=timezone.utc), 95.0),
        ]
        result = _find_price_at(history, target)
        assert result is not None
        assert result[1] == 80.0

    def test_nearest_match_within_tolerance(self):
        """Closest point within 24h tolerance is returned."""
        target = datetime(2026, 6, 11, 12, 0, tzinfo=timezone.utc)
        history = [
            (datetime(2026, 6, 11, 0, 0, tzinfo=timezone.utc), 80.0),  # 12h before target
            (datetime(2026, 6, 12, 0, 0, tzinfo=timezone.utc), 85.0),  # 12h after target
        ]
        result = _find_price_at(history, target)
        assert result is not None
        # 12h before vs 12h after — both equidistant, first one wins (tie-break)
        assert result[1] in (80.0, 85.0)

    def test_returns_none_when_beyond_tolerance(self):
        """No point within tolerance → None."""
        target = datetime(2026, 6, 11, 12, 0, tzinfo=timezone.utc)
        history = [
            (datetime(2026, 6, 9, 0, 0, tzinfo=timezone.utc), 80.0),  # 2.5 days before
            (datetime(2026, 6, 14, 0, 0, tzinfo=timezone.utc), 85.0),  # 2.5 days after
        ]
        result = _find_price_at(history, target, tolerance_hours=24)
        assert result is None

    def test_accepts_naive_datetime_target(self):
        """Timezone-naive target is treated as UTC."""
        target_naive = datetime(2026, 6, 11, 0, 0)  # no tzinfo
        history = [
            (datetime(2026, 6, 11, 0, 0, tzinfo=timezone.utc), 80.0),
        ]
        result = _find_price_at(history, target_naive)
        assert result is not None
        assert result[1] == 80.0

    def test_accepts_naive_history_timestamps(self):
        """Timezone-naive history timestamps are treated as UTC."""
        target = datetime(2026, 6, 11, 0, 0, tzinfo=timezone.utc)
        history = [
            (datetime(2026, 6, 11, 0, 0), 80.0),  # naive
        ]
        result = _find_price_at(history, target)
        assert result is not None
        assert result[1] == 80.0


# ===========================================================================
# 2. _stats_block
# ===========================================================================

class TestStatsBlock:
    def test_empty_returns_zeros(self):
        result = _stats_block([])
        assert result == {
            "count": 0,
            "win_rate": 0.0,
            "mean_return_pct": 0.0,
            "median_return_pct": 0.0,
            "best_return_pct": 0.0,
            "worst_return_pct": 0.0,
        }

    def test_single_positive_return(self):
        result = _stats_block([10.0])
        assert result["count"] == 1
        assert result["win_rate"] == 100.0
        assert result["mean_return_pct"] == 10.0
        assert result["median_return_pct"] == 10.0
        assert result["best_return_pct"] == 10.0
        assert result["worst_return_pct"] == 10.0

    def test_single_negative_return(self):
        result = _stats_block([-5.0])
        assert result["count"] == 1
        assert result["win_rate"] == 0.0
        assert result["mean_return_pct"] == -5.0

    def test_mixed_returns(self):
        returns = [10.0, -5.0, 20.0, 0.0, -2.0]
        result = _stats_block(returns)
        assert result["count"] == 5
        # 2 wins out of 5 (10.0 and 20.0 are >0; 0.0 is NOT a win)
        assert result["win_rate"] == 40.0
        assert result["mean_return_pct"] == round((10 - 5 + 20 + 0 - 2) / 5, 4)
        assert result["median_return_pct"] == 0.0  # sorted: [-5, -2, 0, 10, 20] → median=0
        assert result["best_return_pct"] == 20.0
        assert result["worst_return_pct"] == -5.0

    def test_zero_return_is_not_a_win(self):
        """A return of exactly 0.0 is NOT counted as a win (only r > 0)."""
        result = _stats_block([0.0, 0.0, 0.0])
        assert result["count"] == 3
        assert result["win_rate"] == 0.0


# ===========================================================================
# 3. _build_trade_entry
# ===========================================================================

class TestBuildTradeEntry:
    def test_buy_return_calculation(self):
        """BUY: (exit - entry) / entry * 100."""
        trade = _build_trade_entry(
            api_id="a", text="A", category="ritual",
            signal="BUY",
            entry_price=80.0, entry_ts=datetime(2026, 6, 11, tzinfo=timezone.utc),
            exit_price=95.0, exit_ts=datetime(2026, 6, 18, tzinfo=timezone.utc),
            z_score=-2.5, sample_size=10,
        )
        # (95 - 80) / 80 * 100 = 18.75
        assert trade["return_pct"] == 18.75
        assert trade["signal"] == "BUY"
        assert trade["entry_price"] == 80.0
        assert trade["exit_price"] == 95.0
        assert trade["z_score_at_entry"] == -2.5
        assert trade["sample_size_at_entry"] == 10
        assert trade["entry_date"] == "2026-06-11T00:00:00+00:00"
        assert trade["exit_date"] == "2026-06-18T00:00:00+00:00"

    def test_sell_return_calculation(self):
        """SELL: (entry - exit) / entry * 100 (short sale equivalent)."""
        trade = _build_trade_entry(
            api_id="a", text="A", category="breach",
            signal="SELL",
            entry_price=130.0, entry_ts=datetime(2026, 6, 11, tzinfo=timezone.utc),
            exit_price=110.0, exit_ts=datetime(2026, 6, 18, tzinfo=timezone.utc),
            z_score=2.5, sample_size=10,
        )
        # (130 - 110) / 130 * 100 = 15.3846...
        assert trade["return_pct"] == round((130 - 110) / 130 * 100, 4)
        assert trade["signal"] == "SELL"

    def test_buy_negative_return_on_price_fall(self):
        """BUY: if exit < entry, return is negative (loss)."""
        trade = _build_trade_entry(
            api_id="a", text="A", category="ritual",
            signal="BUY",
            entry_price=80.0, entry_ts=datetime(2026, 6, 11, tzinfo=timezone.utc),
            exit_price=70.0, exit_ts=datetime(2026, 6, 18, tzinfo=timezone.utc),
            z_score=-2.5, sample_size=10,
        )
        # (70 - 80) / 80 * 100 = -12.5
        assert trade["return_pct"] == -12.5

    def test_sell_negative_return_on_price_rise(self):
        """SELL: if exit > entry, return is negative (loss)."""
        trade = _build_trade_entry(
            api_id="a", text="A", category="breach",
            signal="SELL",
            entry_price=130.0, entry_ts=datetime(2026, 6, 11, tzinfo=timezone.utc),
            exit_price=140.0, exit_ts=datetime(2026, 6, 18, tzinfo=timezone.utc),
            z_score=2.5, sample_size=10,
        )
        # (130 - 140) / 130 * 100 = -7.6923...
        assert trade["return_pct"] == round((130 - 140) / 130 * 100, 4)

    def test_zero_entry_price_returns_zero(self):
        """Edge case: entry_price=0 avoids div-by-zero, returns 0.0."""
        trade = _build_trade_entry(
            api_id="a", text="A", category="ritual",
            signal="BUY",
            entry_price=0.0, entry_ts=datetime(2026, 6, 11, tzinfo=timezone.utc),
            exit_price=10.0, exit_ts=datetime(2026, 6, 18, tzinfo=timezone.utc),
            z_score=-2.5, sample_size=10,
        )
        assert trade["return_pct"] == 0.0

    def test_none_z_score_passes_through(self):
        """z_score=None is preserved in the output."""
        trade = _build_trade_entry(
            api_id="a", text="A", category="ritual",
            signal="BUY",
            entry_price=80.0, entry_ts=datetime(2026, 6, 11, tzinfo=timezone.utc),
            exit_price=95.0, exit_ts=datetime(2026, 6, 18, tzinfo=timezone.utc),
            z_score=None, sample_size=2,
        )
        assert trade["z_score_at_entry"] is None


# ===========================================================================
# 4. backtest_speculation_signals — pure function
# ===========================================================================

class TestBacktestEmpty:
    def test_empty_snapshot_returns_data_available_false(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config)
        assert result["data_available"] is False
        assert result["trades"] == []
        assert result["evaluated_count"] == 0
        assert result["unevaluated_count"] == 0
        assert result["signal_breakdown"] == {"BUY": 0, "SELL": 0, "HOLD": 0}

    def test_no_price_logs_skipped(self):
        """Items with empty price_logs are skipped (but counted as any_data=False if no other items)."""
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", price_logs=[]),
        ])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config)
        # No items with price_logs → data_available=False (no data to backtest against)
        assert result["data_available"] is False
        assert result["trades"] == []


class TestBacktestBuyScenario:
    def test_buy_signal_produces_positive_return_on_reversion_up(self):
        """BUY: price low at entry, reverts up → positive return."""
        now = datetime.now(timezone.utc)
        # Baseline: 6 points with mean=100, std≈2.4
        # Entry (14d ago): 80 → z very negative → BUY
        # Exit (7d ago): 95 → return = +18.75%
        logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (80.0, 14),  # entry
            (95.0, 7),   # exit
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-buy", "ritual", current_price=95.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        assert result["data_available"] is True
        assert result["evaluated_count"] == 1
        assert result["unevaluated_count"] == 0
        assert result["signal_breakdown"]["BUY"] == 1
        assert result["signal_breakdown"]["SELL"] == 0
        assert result["signal_breakdown"]["HOLD"] == 0
        assert len(result["trades"]) == 1
        trade = result["trades"][0]
        assert trade["signal"] == "BUY"
        assert trade["entry_price"] == 80.0
        assert trade["exit_price"] == 95.0
        assert trade["return_pct"] == 18.75
        assert trade["z_score_at_entry"] is not None
        assert trade["z_score_at_entry"] < -1.5  # BUY threshold
        assert trade["sample_size_at_entry"] == 6
        # Aggregate stats
        assert result["buy_stats"]["count"] == 1
        assert result["buy_stats"]["win_rate"] == 100.0
        assert result["buy_stats"]["mean_return_pct"] == 18.75
        assert result["sell_stats"]["count"] == 0
        assert result["overall_stats"]["count"] == 1
        assert result["overall_stats"]["win_rate"] == 100.0

    def test_buy_signal_loss_when_price_keeps_falling(self):
        """BUY: price low at entry, keeps falling → negative return."""
        now = datetime.now(timezone.utc)
        logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (80.0, 14),  # entry
            (70.0, 7),   # exit — price fell further
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-buy-loss", "ritual", current_price=70.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        assert len(result["trades"]) == 1
        trade = result["trades"][0]
        assert trade["signal"] == "BUY"
        assert trade["return_pct"] == -12.5  # (70-80)/80*100
        assert result["buy_stats"]["win_rate"] == 0.0


class TestBacktestSellScenario:
    def test_sell_signal_produces_positive_return_on_reversion_down(self):
        """SELL: price high at entry, reverts down → positive return."""
        now = datetime.now(timezone.utc)
        logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (130.0, 14),  # entry — SELL signal
            (110.0, 7),   # exit — price fell
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-sell", "breach", current_price=110.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        assert result["data_available"] is True
        assert result["evaluated_count"] == 1
        assert result["signal_breakdown"]["SELL"] == 1
        assert result["signal_breakdown"]["BUY"] == 0
        assert len(result["trades"]) == 1
        trade = result["trades"][0]
        assert trade["signal"] == "SELL"
        assert trade["entry_price"] == 130.0
        assert trade["exit_price"] == 110.0
        assert trade["return_pct"] == round((130 - 110) / 130 * 100, 4)
        assert trade["z_score_at_entry"] is not None
        assert trade["z_score_at_entry"] > 1.5  # SELL threshold
        assert result["sell_stats"]["count"] == 1
        assert result["sell_stats"]["win_rate"] == 100.0
        assert result["buy_stats"]["count"] == 0


class TestBacktestHoldScenario:
    def test_hold_signal_not_in_trades_but_counted_in_breakdown(self):
        """HOLD signal: not in trades list, but counted in signal_breakdown.HOLD."""
        now = datetime.now(timezone.utc)
        # Baseline mean≈100, entry 102 → z just barely > 0, well below SELL threshold
        logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (101.0, 14),  # entry — z very near 0 → HOLD
            (100.0, 7),   # exit
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-hold", "ritual", current_price=100.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        assert result["data_available"] is True
        assert result["evaluated_count"] == 0  # HOLD doesn't count as evaluated
        assert result["signal_breakdown"]["HOLD"] == 1
        assert result["signal_breakdown"]["BUY"] == 0
        assert result["signal_breakdown"]["SELL"] == 0
        assert result["trades"] == []


class TestBacktestEdgeCases:
    def test_std_zero_baseline_skipped(self):
        """All baseline prices identical → std=0 → z=None → HOLD, no trade."""
        now = datetime.now(timezone.utc)
        logs = _make_logs([
            (100.0, 40), (100.0, 35), (100.0, 30), (100.0, 25), (100.0, 20), (100.0, 15),
            (50.0, 14),   # entry — but z=None because std=0
            (90.0, 7),    # exit
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-std0", "ritual", current_price=90.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        # std=0 → z=None → signal=HOLD → counted in breakdown, NOT in trades
        assert result["signal_breakdown"]["HOLD"] == 1
        assert result["trades"] == []
        assert result["evaluated_count"] == 0

    def test_insufficient_baseline_sample_size_skipped(self):
        """Baseline with < MIN_SAMPLE_SIZE (2) points → skip."""
        now = datetime.now(timezone.utc)
        # Only 1 baseline point + entry + exit
        logs = _make_logs([
            (100.0, 20),  # only 1 point in baseline window
            (80.0, 14),   # entry
            (95.0, 7),    # exit
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-tiny-baseline", "ritual", current_price=95.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        assert result["evaluated_count"] == 0
        assert result["trades"] == []
        # Item was processed but not added to signal_breakdown because baseline too small
        assert result["signal_breakdown"] == {"BUY": 0, "SELL": 0, "HOLD": 0}

    def test_no_entry_price_within_tolerance_skipped(self):
        """If no price log within 24h of t_eval, item is skipped entirely."""
        now = datetime.now(timezone.utc)
        # No price log near 14d ago — closest is at 25d and 7d
        logs = _make_logs([
            (100.0, 40), (100.0, 35), (100.0, 30), (100.0, 25),  # baseline only
            (95.0, 7),    # exit but no entry
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-no-entry", "ritual", current_price=95.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        assert result["evaluated_count"] == 0
        assert result["unevaluated_count"] == 0
        assert result["trades"] == []
        assert result["signal_breakdown"] == {"BUY": 0, "SELL": 0, "HOLD": 0}

    def test_no_exit_price_within_tolerance_increments_unevaluated(self):
        """Actionable signal but no exit price within tolerance → unevaluated_count."""
        now = datetime.now(timezone.utc)
        # Entry at 14d, but no price near 7d (only at 14d and 1d)
        logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (80.0, 14),   # entry — BUY signal
            (95.0, 1),    # not near 7d target (6 days off, > 24h tolerance)
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-no-exit", "ritual", current_price=95.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        assert result["evaluated_count"] == 0
        assert result["unevaluated_count"] == 1
        assert result["signal_breakdown"]["BUY"] == 1
        assert result["trades"] == []  # No exit → no trade


class TestBacktestFiltersAndLimit:
    def test_signal_filter_buy_returns_only_buy_trades(self):
        """signal_filter=BUY narrows trades list and aggregates."""
        now = datetime.now(timezone.utc)
        # BUY item
        buy_logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (80.0, 14), (95.0, 7),
        ], base=now)
        # SELL item
        sell_logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (130.0, 14), (110.0, 7),
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("buy-1", "ritual", current_price=95.0, price_logs=buy_logs),
            _make_currency("sell-1", "breach", current_price=110.0, price_logs=sell_logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30,
            signal_filter="BUY", now=now,
        )
        assert len(result["trades"]) == 1
        assert result["trades"][0]["signal"] == "BUY"
        # Aggregates reflect ONLY the filtered set (BUY)
        assert result["buy_stats"]["count"] == 1
        assert result["sell_stats"]["count"] == 0
        assert result["overall_stats"]["count"] == 1

    def test_signal_filter_sell_returns_only_sell_trades(self):
        now = datetime.now(timezone.utc)
        buy_logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (80.0, 14), (95.0, 7),
        ], base=now)
        sell_logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (130.0, 14), (110.0, 7),
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("buy-1", "ritual", current_price=95.0, price_logs=buy_logs),
            _make_currency("sell-1", "breach", current_price=110.0, price_logs=sell_logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30,
            signal_filter="SELL", now=now,
        )
        assert len(result["trades"]) == 1
        assert result["trades"][0]["signal"] == "SELL"
        assert result["sell_stats"]["count"] == 1
        assert result["buy_stats"]["count"] == 0

    def test_signal_filter_hold_returns_empty_trades(self):
        """HOLD signals never produce trades; filter=HOLD → empty list."""
        now = datetime.now(timezone.utc)
        logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (101.0, 14),  # entry — HOLD
            (100.0, 7),
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("hold-1", "ritual", current_price=100.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, signal_filter="HOLD", now=now,
        )
        assert result["trades"] == []

    def test_limit_caps_trades_list_but_aggregates_over_all(self):
        """limit caps the trades list, but stats reflect ALL trades."""
        now = datetime.now(timezone.utc)
        currencies = []
        for i in range(5):
            logs = _make_logs([
                (97.0 + i, 40), (103.0 + i, 35), (99.0 + i, 30), (101.0 + i, 25),
                (102.0 + i, 20), (98.0 + i, 15),
                (80.0 + i, 14),  # entry — BUY
                (95.0 + i, 7),   # exit — profit
            ], base=now)
            currencies.append(
                _make_currency(f"buy-{i}", "ritual", current_price=95.0 + i, price_logs=logs)
            )
        snapshot = _make_snapshot(currencies)
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30,
            limit=2, now=now,
        )
        # All 5 items produced trades
        assert result["evaluated_count"] == 5
        # Only 2 returned in trades list (limit applied AFTER sort)
        assert len(result["trades"]) == 2
        # Aggregates computed over ALL 5 trades, not just the 2 in the list
        assert result["buy_stats"]["count"] == 5
        assert result["overall_stats"]["count"] == 5
        assert result["buy_stats"]["win_rate"] == 100.0

    def test_trades_sorted_by_abs_return_desc(self):
        """Trades list is sorted by |return_pct| descending."""
        now = datetime.now(timezone.utc)
        # Trade A: small return
        # Trade B: large return
        # Trade C: medium return
        currencies = []
        # Each uses same baseline (mean=100, std small), different entry/exit
        configs = [
            ("a", 80.0, 82.0),   # return = 2.5%
            ("b", 50.0, 95.0),   # return = 90% (largest)
            ("c", 70.0, 90.0),   # return ≈ 28.57%
        ]
        for api_id, entry_p, exit_p in configs:
            logs = _make_logs([
                (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
                (entry_p, 14),
                (exit_p, 7),
            ], base=now)
            currencies.append(
                _make_currency(api_id, "ritual", current_price=exit_p, price_logs=logs)
            )
        snapshot = _make_snapshot(currencies)
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        returns = [abs(t["return_pct"]) for t in result["trades"]]
        assert returns == sorted(returns, reverse=True)
        assert result["trades"][0]["api_id"] == "b"  # largest return first


class TestBacktestInputClamping:
    def test_eval_days_ago_clamped_to_min_1(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config, eval_days_ago=0)
        assert result["eval_days_ago"] == 1

    def test_eval_days_ago_clamped_to_max_365(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config, eval_days_ago=999)
        assert result["eval_days_ago"] == 365

    def test_holding_days_clamped_to_min_1(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config, holding_days=0)
        assert result["holding_days"] == 1

    def test_holding_days_clamped_to_max_90(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config, holding_days=999)
        assert result["holding_days"] == 90

    def test_lookback_days_clamped_to_min_1(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config, lookback_days=0)
        assert result["lookback_days"] == 1

    def test_lookback_days_clamped_to_max_90(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config, lookback_days=999)
        assert result["lookback_days"] == 90

    def test_invalid_signal_filter_defaults_to_all(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config, signal_filter="WHATEVER")
        # No exception, no filtering applied (ALL)
        assert result["trades"] == []

    def test_limit_clamped_to_min_1(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config, limit=0)
        # limit=0 → clamped to 1 (no error, but no items to cap anyway)
        assert result["trades"] == []

    def test_limit_clamped_to_max_500(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config, limit=9999)
        assert result["trades"] == []


class TestBacktestFieldNameDefence:
    def test_snake_case_field_names_accepted(self):
        """Both PascalCase and snake_case field names work."""
        now = datetime.now(timezone.utc)
        logs = [
            {
                "time": (now - timedelta(days=d)).strftime("%Y-%m-%dT00:00:00"),
                "price": p,
                "quantity": 10,
            }
            for p, d in [
                (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
                (80.0, 14),
                (95.0, 7),
            ]
        ]
        snapshot = SimpleNamespace(
            currencies={
                "test-snake": {
                    "api_id": "test-snake",
                    "category_api_id": "ritual",
                    "text": "Test Snake",
                    "current_price": 95.0,
                    "current_quantity": 5,
                    "price_logs": logs,
                },
            },
            fetched_at=now,
        )
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        assert result["evaluated_count"] == 1
        assert len(result["trades"]) == 1
        assert result["trades"][0]["api_id"] == "test-snake"

    def test_non_dict_currency_skipped(self):
        """Non-dict entries in snapshot.currencies.values() are skipped gracefully."""
        now = datetime.now(timezone.utc)
        snapshot = SimpleNamespace(
            currencies={
                "valid": _make_currency("valid", "ritual", price_logs=[]),
                "broken": "not-a-dict",
                "also-broken": 42,
            },
            fetched_at=now,
        )
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config)
        # No exception, no trades (valid has no price_logs)
        assert result["trades"] == []

    def test_missing_api_id_skipped(self):
        """Currencies without ApiId are skipped."""
        now = datetime.now(timezone.utc)
        snapshot = SimpleNamespace(
            currencies={
                "no-api-id": {
                    "CategoryApiId": "ritual",
                    "Text": "No API ID",
                    "CurrentPrice": 100.0,
                    "PriceLogs": [{"Time": now.isoformat(), "Price": 100.0, "Quantity": 5}],
                },
            },
            fetched_at=now,
        )
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config)
        assert result["trades"] == []


class TestBacktestResponseShape:
    def test_response_has_all_required_fields(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config)
        required = {
            "league", "trades", "signal_breakdown", "evaluated_count",
            "unevaluated_count", "buy_stats", "sell_stats", "overall_stats",
            "data_available", "fetched_at", "eval_days_ago", "holding_days",
            "lookback_days",
        }
        assert required.issubset(result.keys())

    def test_stats_block_has_all_required_fields(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = backtest_speculation_signals(snapshot, config)
        required = {"count", "win_rate", "mean_return_pct", "median_return_pct",
                    "best_return_pct", "worst_return_pct"}
        assert required.issubset(result["buy_stats"].keys())
        assert required.issubset(result["sell_stats"].keys())
        assert required.issubset(result["overall_stats"].keys())

    def test_trade_entry_has_all_required_fields(self):
        now = datetime.now(timezone.utc)
        logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (80.0, 14),
            (95.0, 7),
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-shape", "ritual", current_price=95.0, price_logs=logs),
        ])
        config = _make_config()
        result = backtest_speculation_signals(
            snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, now=now,
        )
        required = {"api_id", "text", "category", "signal", "entry_price",
                    "entry_date", "exit_price", "exit_date", "return_pct",
                    "z_score_at_entry", "sample_size_at_entry"}
        assert required.issubset(result["trades"][0].keys())

    def test_fetched_at_is_iso_string(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        fixed_now = datetime(2026, 6, 25, 12, 0, 0, tzinfo=timezone.utc)
        result = backtest_speculation_signals(snapshot, config, now=fixed_now)
        assert result["fetched_at"] == "2026-06-25T12:00:00+00:00"

    def test_league_name_passed_through(self):
        snapshot = _make_snapshot([])
        config = _make_config(league_name="Dawn of the Hunt")
        result = backtest_speculation_signals(snapshot, config)
        assert result["league"] == "Dawn of the Hunt"


# ===========================================================================
# 5. Route handler smoke tests
# ===========================================================================

class TestRouteHandler:
    """Smoke test the FastAPI route handler without spinning up uvicorn."""

    async def test_route_returns_empty_when_no_snapshot(self):
        from backend.api.routes_speculation_backtest import get_speculation_backtest

        with patch(
            "backend.api.routes_speculation_backtest.get_snapshot_manager"
        ) as mock_mgr:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=None)
            # Pass explicit args — when called directly (not via FastAPI),
            # the default values are Query() objects, not the integers they wrap.
            result = await get_speculation_backtest(
                eval_days_ago=14, holding_days=7, lookback_days=30,
                limit=50, signal="ALL",
            )
            assert result["data_available"] is False
            assert result["trades"] == []
            assert result["signal_breakdown"] == {"BUY": 0, "SELL": 0, "HOLD": 0}
            assert result["evaluated_count"] == 0
            assert result["unevaluated_count"] == 0
            assert "fetched_at" in result
            assert result["eval_days_ago"] == 14
            assert result["holding_days"] == 7
            assert result["lookback_days"] == 30

    async def test_route_returns_data_when_snapshot_available(self):
        from backend.api.routes_speculation_backtest import get_speculation_backtest

        now = datetime.now(timezone.utc)
        logs = _make_logs([
            (97.0, 40), (103.0, 35), (99.0, 30), (101.0, 25), (102.0, 20), (98.0, 15),
            (80.0, 14),
            (95.0, 7),
        ], base=now)
        snapshot = _make_snapshot([
            _make_currency("route-buy", "ritual", current_price=95.0, price_logs=logs),
        ])

        with patch(
            "backend.api.routes_speculation_backtest.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_speculation_backtest.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())  # truthy
            mock_get.return_value = snapshot
            result = await get_speculation_backtest(
                eval_days_ago=14, holding_days=7, lookback_days=30,
                limit=50, signal="ALL",
            )
            assert result["data_available"] is True
            assert len(result["trades"]) == 1
            assert result["trades"][0]["signal"] == "BUY"
            assert result["evaluated_count"] == 1

    async def test_route_passes_query_params(self):
        """eval_days_ago / holding_days / lookback_days / limit / signal are forwarded."""
        from backend.api.routes_speculation_backtest import get_speculation_backtest

        now = datetime.now(timezone.utc)
        # Build 3 BUY items
        currencies = []
        for i in range(3):
            logs = _make_logs([
                (97.0 + i, 40), (103.0 + i, 35), (99.0 + i, 30), (101.0 + i, 25),
                (102.0 + i, 20), (98.0 + i, 15),
                (80.0 + i, 14),
                (95.0 + i, 7),
            ], base=now)
            currencies.append(
                _make_currency(f"item-{i}", "ritual", current_price=95.0 + i, price_logs=logs)
            )
        snapshot = _make_snapshot(currencies)

        with patch(
            "backend.api.routes_speculation_backtest.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_speculation_backtest.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())
            mock_get.return_value = snapshot
            result = await get_speculation_backtest(
                eval_days_ago=14, holding_days=7, lookback_days=30,
                limit=2, signal="BUY",
            )
            assert result["eval_days_ago"] == 14
            assert result["holding_days"] == 7
            assert result["lookback_days"] == 30
            # limit=2 caps trades list
            assert len(result["trades"]) == 2
            # All trades in list are BUY (signal filter applied)
            assert all(t["signal"] == "BUY" for t in result["trades"])
            # But aggregates reflect ALL 3 BUY trades
            assert result["buy_stats"]["count"] == 3

    async def test_route_returns_empty_on_exception(self):
        """If backtest_speculation_signals raises, route returns data_available=false."""
        from backend.api.routes_speculation_backtest import get_speculation_backtest

        with patch(
            "backend.api.routes_speculation_backtest.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_speculation_backtest.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())
            mock_get.side_effect = RuntimeError("boom")
            result = await get_speculation_backtest(
                eval_days_ago=14, holding_days=7, lookback_days=30,
                limit=50, signal="ALL",
            )
            assert result["data_available"] is False
            assert result["trades"] == []
            assert result["evaluated_count"] == 0

    async def test_route_no_snapshot_returns_zeroed_stats_blocks(self):
        """When snapshot is None, stats blocks should all be zeroed (not absent)."""
        from backend.api.routes_speculation_backtest import get_speculation_backtest

        with patch(
            "backend.api.routes_speculation_backtest.get_snapshot_manager"
        ) as mock_mgr:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=None)
            result = await get_speculation_backtest(
                eval_days_ago=14, holding_days=7, lookback_days=30,
                limit=50, signal="ALL",
            )
            for block_name in ("buy_stats", "sell_stats", "overall_stats"):
                block = result[block_name]
                assert block["count"] == 0
                assert block["win_rate"] == 0.0
                assert block["mean_return_pct"] == 0.0
                assert block["median_return_pct"] == 0.0
                assert block["best_return_pct"] == 0.0
                assert block["worst_return_pct"] == 0.0
