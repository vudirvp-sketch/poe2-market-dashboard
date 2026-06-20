"""
End-to-End / regression tests for the analyst endpoints.

P2-11 (partial): adds test coverage for `/api/v1/analyst/summary`.
P0-3 (regression): `test_analyst_24h_change_uses_timestamp` locks in the
fix that replaced `prices[0]` (oldest point in snapshot window) with the
timestamp-aware `_find_price_24h_ago` helper.

Run with:
    pytest tests/e2e/test_analyst.py -v -s
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.api.routes_analyst import _compute_trends
from backend.models.currency import PricePoint


def _ts(hours_ago: float) -> datetime:
    """Return a UTC datetime `hours_ago` hours before now."""
    return datetime.now(timezone.utc) - timedelta(hours=hours_ago)


# ---------------------------------------------------------------------------
# P0-3 regression tests — _compute_trends must use timestamp-aware 24h-ago lookup
# ---------------------------------------------------------------------------

class TestAnalyst24hChangeUsesTimestamp:
    """P0-3 regression: 24h change must use the price ~24h ago, NOT prices[0].

    Before the fix, `_compute_trends` did `price_24h_ago = prices[0]`, which is
    just the OLDEST point in the snapshot window — typically several days old,
    not 24h. These tests pin the new behaviour: 24h-ago is found via
    `_find_price_24h_ago` (±6h drift tolerance).
    """

    def test_analyst_24h_change_uses_timestamp(self):
        """The 24h% must reflect the price ~24h ago, NOT prices[0].

        History layout (3 points, all within 24h±6h drift window):
            - 48h ago  : price 100.0   ← prices[0] (would give WRONG answer)
            - 24h ago  : price 110.0   ← correct 24h-ago price
            - now      : price 121.0   ← current price (= prices[-1])

        OLD (buggy): change_24h_pct = (121 - 100) / 100 * 100 = 21.0%
        NEW (fixed) : change_24h_pct = (121 - 110) / 110 * 100 = 10.0%
        """
        price_histories = {
            "divine": [
                PricePoint(timestamp=_ts(48), price=100.0, volume=10),
                PricePoint(timestamp=_ts(24), price=110.0, volume=10),
                PricePoint(timestamp=_ts(0),  price=121.0, volume=10),
            ],
        }
        trends = _compute_trends(prices_in_base={"divine": 121.0},
                                 price_histories=price_histories)
        assert len(trends) == 1
        trend = trends[0]
        assert trend["api_id"] == "divine"
        assert trend["current_price"] == 121.0
        # The fix picks the 24h-ago price (110.0), not prices[0] (100.0).
        # (121 - 110) / 110 * 100 = 10.0%
        assert trend["change_24h_pct"] == pytest.approx(10.0, abs=0.01)
        assert trend["direction"] == "up"

    def test_analyst_24h_change_none_when_drift_too_large(self):
        """When NO price point is within ±6h of 24h ago, change_24h_pct must be None.

        History layout (all points older than 30h, so drift >6h from 24h-ago):
            - 72h ago : price 100.0   ← prices[0]
            - 48h ago : price 105.0
            - 36h ago : price 110.0   ← closest to 24h ago, but |36-24|=12h > 6h

        OLD (buggy): change_24h_pct = (121 - 100) / 100 * 100 = 21.0%
        NEW (fixed) : change_24h_pct = None  (no point within ±6h of 24h ago)
        """
        price_histories = {
            "divine": [
                PricePoint(timestamp=_ts(72), price=100.0, volume=10),
                PricePoint(timestamp=_ts(48), price=105.0, volume=10),
                PricePoint(timestamp=_ts(36), price=110.0, volume=10),
                PricePoint(timestamp=_ts(0),  price=121.0, volume=10),
            ],
        }
        trends = _compute_trends(prices_in_base={"divine": 121.0},
                                 price_histories=price_histories)
        assert len(trends) == 1
        trend = trends[0]
        # With no acceptable 24h-ago point, change_24h_pct must be None
        # (not a bogus value derived from prices[0]).
        assert trend["change_24h_pct"] is None
        assert trend["direction"] == "unknown"

    def test_analyst_24h_change_skips_far_future_point(self):
        """A point AFTER 24h-ago (e.g., 6h ago) must NOT be picked as 24h-ago.

        History layout:
            - 24h ago : price 110.0   ← correct 24h-ago price (drift = 0)
            - 6h ago  : price 120.0   ← drift = 18h > 6h, must be skipped
            - now     : price 121.0

        OLD (buggy): if prices[0] happened to be the 6h-ago point in some
                     ordering, change_24h_pct would be wrong.
        NEW (fixed) : 24h-ago point (110.0) is selected → 10.0% change.
        """
        price_histories = {
            "divine": [
                PricePoint(timestamp=_ts(24), price=110.0, volume=10),
                PricePoint(timestamp=_ts(6),  price=120.0, volume=10),
                PricePoint(timestamp=_ts(0),  price=121.0, volume=10),
            ],
        }
        trends = _compute_trends(prices_in_base={"divine": 121.0},
                                 price_histories=price_histories)
        assert len(trends) == 1
        trend = trends[0]
        # 24h-ago price (110.0) is the only point within ±6h of 24h-ago.
        # (121 - 110) / 110 * 100 = 10.0%
        assert trend["change_24h_pct"] == pytest.approx(10.0, abs=0.01)


# ---------------------------------------------------------------------------
# E2E test — /api/v1/analyst/summary
# ---------------------------------------------------------------------------

@pytest.mark.e2e
async def test_analyst_summary_endpoint(mock_client):
    """`GET /api/v1/analyst/summary` returns 200 with the expected shape.

    Tolerates 503 if the snapshot has not been populated by the mock provider
    yet (the mock returns data on first call, so 200 is expected after warmup).
    """
    resp = await mock_client.get("/api/v1/analyst/summary")
    assert resp.status_code in (200, 503)
    if resp.status_code == 200:
        data = resp.json()
        assert "league" in data
        assert "summary" in data
        assert "trends" in data
        assert "anomalies" in data
        assert "facts" in data
        assert "data_available" in data
        assert "fetched_at" in data
        # When data is available, summary must have the 6 sub-fields.
        if data.get("data_available"):
            summary = data["summary"]
            for key in ("total_currencies", "total_pairs",
                        "trending_up", "trending_down",
                        "stable", "anomaly_count"):
                assert key in summary, f"summary missing key: {key}"
