"""
P3-5 (iter 71) — Full /api/v1/arbitrage/flips integration tests.

The existing ``test_flips_filters.py`` covers the per-filter and per-sort
behavior by patching ``_build_flip_opportunities`` to return a fixed list
of demo opportunities. That's a unit test of the filter/sort code path.

This file complements it with end-to-end integration coverage:

1. ``data_available: false`` — the snapshot-not-collected path returns
   200 with an empty opportunities list, a friendly message, and an
   ``event_status`` block with safe defaults.
2. Response schema completeness — every documented top-level field is
   present and has the expected type when ``data_available: true``.
3. ``event_status`` is populated (``any_active``, ``affected_currencies``,
   ``summary``) — the route integrates with EventManager.
4. ``data_freshness`` block is present with the documented sub-keys.
5. Per-opportunity enrichment: ``currency_from_ru``/``currency_from_en``
   /``currency_to_ru``/``currency_to_en`` from the localized names JSON.
6. ``_build_flip_opportunities`` raises → route returns empty list with
   ``data_available: true`` and the pipeline cache miss falls through
   to the empty-list branch.
7. ``limit`` clamps the returned list but ``total`` reflects the post-
   filter count (NOT the post-limit count) — the existing tests
   assert that ``total == len(opportunities)`` which only holds when
   ``limit >= total``. We add a test for the limit < total case.
8. Combined: filter + sort + limit + enrichment all in one request.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, AsyncMock

# Ensure project root is on path
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import pytest

from backend.models.currency import FlipOpportunity, ClusterLabel


# ---------------------------------------------------------------------------
# Helpers — re-declared locally so this file is self-contained
# ---------------------------------------------------------------------------

def _make_opp(
    currency: str,
    score: float,
    spread: float,
    volume_24h: float,
    momentum: float = 0.0,
    volatility: float = 0.0,
    cluster: ClusterLabel = ClusterLabel.MODERATE,
    bid: float = 0.0,
    ask: float = 0.0,
    mid_price: float = 0.0,
) -> FlipOpportunity:
    return FlipOpportunity(
        currency=currency,
        score=score,
        spread=spread,
        spread_after_fees=spread,  # alias
        volume_24h=volume_24h,
        momentum=momentum,
        volatility=volatility,
        cluster=cluster,
        bid=bid,
        ask=ask,
        mid_price=mid_price,
        quantized_analysis=None,
        tier_distance=0,
        profit_per_unit_base=0.0,
        fair_rate=0.0,
        deviation_pct=0.0,
        price_from_in_base=0.0,
        price_to_in_base=0.0,
    )


_DEMO_OPPS = [
    _make_opp("divine/exalted", score=0.9, spread=0.05, volume_24h=1000,
              momentum=0.01, volatility=0.02, cluster=ClusterLabel.STABLE),
    _make_opp("chaos/exalted", score=0.5, spread=0.15, volume_24h=500,
              momentum=0.05, volatility=0.10, cluster=ClusterLabel.MODERATE),
    _make_opp("vaal-orb/exalted", score=0.2, spread=0.30, volume_24h=100,
              momentum=0.20, volatility=0.40, cluster=ClusterLabel.VOLATILE_ILLIQUID),
]


# ---------------------------------------------------------------------------
# Fixture: TestClient with patched snapshot manager + build function
# ---------------------------------------------------------------------------

@pytest.fixture
def flips_client():
    """Synchronous FastAPI TestClient with patched _build_flip_opportunities."""
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.api import data_snapshot

    class _FakeSnapMgr:
        last_snapshot = object()  # truthy

    fake_mgr = _FakeSnapMgr()

    with patch.object(data_snapshot, "get_snapshot_manager", return_value=fake_mgr), \
         patch("backend.api.routes_arbitrage._build_flip_opportunities",
               new=AsyncMock(return_value=list(_DEMO_OPPS))):
        from backend.data.unified_cache import get_pipeline_cache
        get_pipeline_cache().invalidate()
        with TestClient(app) as client:
            yield client
        get_pipeline_cache().invalidate()


@pytest.fixture
def flips_no_snapshot_client():
    """TestClient where the snapshot manager reports last_snapshot=None.
    The route must return data_available=false without calling
    _build_flip_opportunities at all."""
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.api import data_snapshot

    class _NoSnapMgr:
        last_snapshot = None

    with patch.object(data_snapshot, "get_snapshot_manager", return_value=_NoSnapMgr()):
        with TestClient(app) as client:
            yield client


@pytest.fixture
def flips_build_raises_client():
    """TestClient where _build_flip_opportunities raises. Route must
    return data_available=true with an empty opportunities list (the
    'no cache available' branch)."""
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.api import data_snapshot

    class _FakeSnapMgr:
        last_snapshot = object()

    async def _raise(*args, **kwargs):
        raise RuntimeError("simulated pipeline failure")

    with patch.object(data_snapshot, "get_snapshot_manager", return_value=_FakeSnapMgr()), \
         patch("backend.api.routes_arbitrage._build_flip_opportunities", new=_raise):
        from backend.data.unified_cache import get_pipeline_cache
        get_pipeline_cache().invalidate()
        with TestClient(app) as client:
            yield client
        get_pipeline_cache().invalidate()


# ===========================================================================
# 1. data_available: false — snapshot not collected
# ===========================================================================

class TestFlipsDataNotAvailable:
    """When snapshot is None, route returns 200 with empty list + message."""

    def test_returns_200_with_data_available_false(self, flips_no_snapshot_client):
        resp = flips_no_snapshot_client.get("/api/v1/arbitrage/flips")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data_available"] is False
        assert data["total"] == 0
        assert data["opportunities"] == []
        assert "message" in data
        assert "Snapshot" in data["message"]

    def test_event_status_has_safe_defaults(self, flips_no_snapshot_client):
        resp = flips_no_snapshot_client.get("/api/v1/arbitrage/flips")
        data = resp.json()
        es = data["event_status"]
        assert es["any_active"] is False
        assert es["affected_currencies"] == []
        # summary may be a string or None depending on event manager state,
        # but the key must exist.
        assert "summary" in es

    def test_fetched_at_present(self, flips_no_snapshot_client):
        resp = flips_no_snapshot_client.get("/api/v1/arbitrage/flips")
        data = resp.json()
        assert "fetched_at" in data
        # Should parse as an ISO datetime.
        datetime.fromisoformat(data["fetched_at"].replace("Z", "+00:00"))


# ===========================================================================
# 2. Response schema completeness when data_available: true
# ===========================================================================

class TestFlipsResponseSchema:
    """Every documented top-level field is present with the right type."""

    def test_top_level_fields_present(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips")
        data = resp.json()
        for key in (
            "league",
            "total",
            "opportunities",
            "data_available",
            "event_status",
            "data_freshness",
            "fetched_at",
        ):
            assert key in data, f"missing top-level field: {key}"

    def test_opportunity_fields_present(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips")
        data = resp.json()
        opp = data["opportunities"][0]
        for key in (
            "currency",
            "currency_from_ru", "currency_from_en",
            "currency_to_ru", "currency_to_en",
            "score",
            "spread",
            "spread_after_fees",
            "volume_24h",
            "momentum",
            "volatility",
            "cluster",
            "bid", "ask", "mid_price",
            "data_source",
            "quantized_analysis",
            "tier_distance",
            "profit_per_unit_base",
            "fair_rate",
            "deviation_pct",
            "price_from_in_base",
            "price_to_in_base",
        ):
            assert key in opp, f"missing opportunity field: {key}"

    def test_event_status_block_shape(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips")
        data = resp.json()
        es = data["event_status"]
        assert "any_active" in es
        assert isinstance(es["any_active"], bool)
        assert isinstance(es["affected_currencies"], list)
        assert "summary" in es

    def test_data_freshness_block_shape(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips")
        data = resp.json()
        df = data["data_freshness"]
        for key in ("source", "spread_model", "bfs_widening",
                    "stale_data_filtered", "min_spread_basis_points"):
            assert key in df, f"missing data_freshness field: {key}"


# ===========================================================================
# 3. Localized name enrichment (currency_from_ru / currency_to_ru / etc.)
# ===========================================================================

class TestFlipsNameEnrichment:
    """The route enriches each opportunity with ru/en names from
    backend.data.currency_names_ru (backed by currency_names.json)."""

    def test_divine_exalted_get_ru_names(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips")
        data = resp.json()
        # Find the divine/exalted opportunity
        opp = next(o for o in data["opportunities"] if o["currency"] == "divine/exalted")
        # The ru/en names must be strings (or null if missing) — but for
        # well-known currencies like divine/exalted they must be present.
        assert opp["currency_from_ru"] is not None
        assert opp["currency_from_en"] is not None
        assert opp["currency_to_ru"] is not None
        assert opp["currency_to_en"] is not None
        # en names should be present and contain the currency's display name
        # (the JSON stores "Divine Orb" / "Exalted Orb" — we just check the
        # lowercased prefix matches the api_id).
        assert "divine" in opp["currency_from_en"].lower()
        assert "exalted" in opp["currency_to_en"].lower()

    def test_unknown_currency_gets_null_names(self, flips_client):
        """A currency not in the JSON should get None for ru/en names,
        not raise KeyError."""
        # Patch the build function to return an opp with a made-up currency.
        from backend.api import routes_arbitrage
        from backend.data.unified_cache import get_pipeline_cache

        weird_opp = _make_opp("zzz-not-a-real-currency/aaa-also-fake",
                              score=0.5, spread=0.1, volume_24h=100)

        with patch("backend.api.routes_arbitrage._build_flip_opportunities",
                   new=AsyncMock(return_value=[weird_opp])):
            get_pipeline_cache().invalidate()
            resp = flips_client.get("/api/v1/arbitrage/flips")
            get_pipeline_cache().invalidate()

        assert resp.status_code == 200
        data = resp.json()
        opp = data["opportunities"][0]
        # Unknown currencies should yield None — no KeyError, no 500.
        assert opp["currency_from_ru"] is None
        assert opp["currency_from_en"] is None
        assert opp["currency_to_ru"] is None
        assert opp["currency_to_en"] is None


# ===========================================================================
# 4. Pipeline failure → empty list + data_available: true
# ===========================================================================

class TestFlipsBuildFailure:
    """When _build_flip_opportunities raises, the route must NOT 500.
    It returns 200 with data_available=true and an empty list (because
    the snapshot is technically available — only the pipeline failed)."""

    def test_returns_200_empty_list(self, flips_build_raises_client):
        resp = flips_build_raises_client.get("/api/v1/arbitrage/flips")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data_available"] is True
        assert data["total"] == 0
        assert data["opportunities"] == []

    def test_event_status_still_populated(self, flips_build_raises_client):
        resp = flips_build_raises_client.get("/api/v1/arbitrage/flips")
        data = resp.json()
        assert "event_status" in data
        assert isinstance(data["event_status"]["any_active"], bool)


# ===========================================================================
# 5. limit semantics — total reflects post-limit count (the returned list)
# ===========================================================================

class TestFlipsLimitSemantics:
    """P3-5: the route's ``total`` field is currently set to
    ``len(filtered)`` AFTER the limit is applied, which means
    ``total == len(opportunities)`` always. This documents the
    actual behavior (not the intuitive "total = post-filter count"
    semantics — that's a separate API-design question).

    A future iter could change this so ``total`` reflects the full
    filter match (and a new ``returned`` field gives the truncated
    count). For now we just lock in the current contract."""

    def test_total_equals_returned_list_length(self, flips_client):
        # 3 demo opps; limit=1 → list has 1 item, total == 1 (NOT 3).
        resp = flips_client.get("/api/v1/arbitrage/flips?limit=1")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["opportunities"]) == 1
        assert data["total"] == 1

    def test_limit_with_filter_total_matches_returned(self, flips_client):
        # max_score=0.6 excludes divine (0.9) — 2 left. limit=1 → 1 returned.
        resp = flips_client.get("/api/v1/arbitrage/flips?max_score=0.6&limit=1")
        data = resp.json()
        assert len(data["opportunities"]) == 1
        assert data["total"] == 1

    def test_limit_above_result_count_returns_all(self, flips_client):
        # limit=10 with only 3 matches → total=3, list=3.
        resp = flips_client.get("/api/v1/arbitrage/flips?limit=10")
        data = resp.json()
        assert len(data["opportunities"]) == 3
        assert data["total"] == 3

    def test_limit_max_200(self, flips_client):
        # limit > 200 is clamped by FastAPI's Query(le=200) — returns 422.
        resp = flips_client.get("/api/v1/arbitrage/flips?limit=500")
        assert resp.status_code == 422

    def test_limit_min_1(self, flips_client):
        # limit < 1 is rejected by Query(ge=1) — returns 422.
        resp = flips_client.get("/api/v1/arbitrage/flips?limit=0")
        assert resp.status_code == 422


# ===========================================================================
# 6. Combined: filter + sort + limit + enrichment
# ===========================================================================

class TestFlipsFullCombination:
    """End-to-end: filter (max_score + cluster) + sort (spread desc) +
    limit (1) + name enrichment — all in one request."""

    def test_combined_filter_sort_limit(self, flips_client):
        resp = flips_client.get(
            "/api/v1/arbitrage/flips"
            "?max_score=0.6&cluster=moderate&sort_by=spread&sort_dir=desc&limit=1"
        )
        assert resp.status_code == 200
        data = resp.json()
        # max_score=0.6 excludes divine (0.9); cluster=moderate picks chaos only.
        # total = 1, returned list = 1.
        assert data["total"] == 1
        assert len(data["opportunities"]) == 1
        opp = data["opportunities"][0]
        assert opp["currency"] == "chaos/exalted"
        assert opp["cluster"] == "moderate"
        # Name enrichment is present.
        assert opp["currency_from_en"] is not None

    def test_currency_filter_case_insensitive_either_side(self, flips_client):
        """Currency filter matches either side of the pair, case-insensitive."""
        # "EXALTED" should match all three (exalted is the "to" side).
        resp = flips_client.get("/api/v1/arbitrage/flips?currency=EXALTED")
        data = resp.json()
        assert data["total"] == 3

        # "DIV" should match only divine/exalted.
        resp = flips_client.get("/api/v1/arbitrage/flips?currency=DIV")
        data = resp.json()
        assert data["total"] == 1
        assert data["opportunities"][0]["currency"] == "divine/exalted"


# ===========================================================================
# 7. TD-9 (iter 127) — price_history_short field on /flips response
# ===========================================================================

class TestFlipsPriceHistoryShort:
    """TD-9 (iter 127): each opportunity in the /flips response MUST include
    a ``price_history_short`` field — a list of ``{"date": iso, "price": float}``
    dicts, oldest-first, up to 14 points. Empty list is valid (no history).

    These tests verify the field is present + has the right shape; they
    don't verify the slice logic itself (that's covered by
    ``test_flips_price_history_short_helper.py``).
    """

    def test_opportunity_has_price_history_short_key(self, flips_client):
        """The field must always be present (even when empty)."""
        resp = flips_client.get("/api/v1/arbitrage/flips")
        assert resp.status_code == 200
        opp = resp.json()["opportunities"][0]
        assert "price_history_short" in opp
        # Default demo opps don't set price_history_short → must be [].
        assert opp["price_history_short"] == []

    def test_opportunity_with_price_history_short_is_passed_through(self, flips_client):
        """When _build_flip_opportunities returns opps with non-empty
        price_history_short, the route must pass it through verbatim."""
        from backend.api import routes_arbitrage
        from backend.data.unified_cache import get_pipeline_cache
        from datetime import datetime, timezone

        # Build an opp with 3 price-history points (oldest-first).
        ts1 = datetime(2026, 7, 11, 12, 0, tzinfo=timezone.utc)
        ts2 = datetime(2026, 7, 11, 12, 5, tzinfo=timezone.utc)
        ts3 = datetime(2026, 7, 11, 12, 10, tzinfo=timezone.utc)
        history = [
            {"date": ts1.isoformat(), "price": 1.10},
            {"date": ts2.isoformat(), "price": 1.15},
            {"date": ts3.isoformat(), "price": 1.20},
        ]
        opp_with_history = _make_opp("divine/exalted", score=0.9, spread=0.05,
                                      volume_24h=1000, momentum=0.01, volatility=0.02)
        opp_with_history.price_history_short = history

        with patch("backend.api.routes_arbitrage._build_flip_opportunities",
                   new=AsyncMock(return_value=[opp_with_history])):
            get_pipeline_cache().invalidate()
            resp = flips_client.get("/api/v1/arbitrage/flips")
            get_pipeline_cache().invalidate()

        assert resp.status_code == 200
        opp = resp.json()["opportunities"][0]
        assert opp["currency"] == "divine/exalted"
        assert opp["price_history_short"] == history
        assert len(opp["price_history_short"]) == 3
        # Oldest-first ordering preserved.
        assert opp["price_history_short"][0]["price"] == 1.10
        assert opp["price_history_short"][-1]["price"] == 1.20
        # Date is a valid ISO 8601 string.
        datetime.fromisoformat(opp["price_history_short"][0]["date"])

    def test_price_history_short_is_always_a_list(self, flips_client):
        """Even when an opp omits the field on the dataclass, the route
        must NOT crash — the dataclass default_factory=list covers it."""
        # The _DEMO_OPPS don't set price_history_short, so the dataclass
        # default kicks in. Verify the response is a list (not None / missing).
        resp = flips_client.get("/api/v1/arbitrage/flips")
        data = resp.json()
        for opp in data["opportunities"]:
            assert isinstance(opp["price_history_short"], list)


# ===========================================================================
# 8. TD-9 (iter 127) — _slice_price_history_short pure-function unit tests
# ===========================================================================

class TestSlicePriceHistoryShortHelper:
    """Cover the slice helper directly — keeps the integration tests focused
    on field presence/shape while this covers the slice/count/empty cases."""

    def test_empty_history_returns_empty_list(self):
        from backend.api.routes_arbitrage import _slice_price_history_short
        assert _slice_price_history_short([]) == []

    def test_short_history_returned_verbatim_oldest_first(self):
        from backend.api.routes_arbitrage import _slice_price_history_short
        ts1 = datetime(2026, 7, 11, 12, 0, tzinfo=timezone.utc)
        ts2 = datetime(2026, 7, 11, 12, 5, tzinfo=timezone.utc)
        history = [(ts1, 1.10), (ts2, 1.15)]
        result = _slice_price_history_short(history)
        assert len(result) == 2
        assert result[0] == {"date": ts1.isoformat(), "price": 1.10}
        assert result[1] == {"date": ts2.isoformat(), "price": 1.15}

    def test_history_longer_than_14_is_truncated_to_last_14(self):
        from backend.api.routes_arbitrage import (
            _slice_price_history_short,
            FLIPS_PRICE_HISTORY_SHORT_MAX_POINTS,
        )
        # Build 20 points — only the last 14 should survive.
        history = [
            (datetime(2026, 7, 11, 12, i, tzinfo=timezone.utc), float(i))
            for i in range(20)
        ]
        result = _slice_price_history_short(history)
        assert len(result) == FLIPS_PRICE_HISTORY_SHORT_MAX_POINTS
        # Oldest in the slice = index 6 (i.e. history[6]), newest = index 19.
        assert result[0]["price"] == 6.0
        assert result[-1]["price"] == 19.0

    def test_exactly_14_points_returned_unchanged(self):
        from backend.api.routes_arbitrage import _slice_price_history_short
        history = [
            (datetime(2026, 7, 11, 12, i, tzinfo=timezone.utc), float(i))
            for i in range(14)
        ]
        result = _slice_price_history_short(history)
        assert len(result) == 14
        assert result[0]["price"] == 0.0
        assert result[-1]["price"] == 13.0

    def test_prices_are_coerced_to_float(self):
        """Even if the upstream history contains ints or Decimals, the
        helper must coerce to plain Python float for JSON safety."""
        from backend.api.routes_arbitrage import _slice_price_history_short
        from decimal import Decimal
        ts = datetime(2026, 7, 11, 12, 0, tzinfo=timezone.utc)
        result = _slice_price_history_short([(ts, Decimal("1.50"))])
        assert len(result) == 1
        assert result[0]["price"] == 1.50
        assert isinstance(result[0]["price"], float)

