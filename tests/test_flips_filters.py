"""
P2-4 (iter 67) — Extended /flips filter & sort tests.

These tests verify that the new optional query parameters added to
GET /api/v1/arbitrage/flips work correctly with safe defaults:

  - max_score, min_spread, max_spread, cluster, currency, sort_by, sort_dir

Strategy: Patch `_build_flip_opportunities` to return a deterministic list of
FlipOpportunity objects, then call the route handler directly via FastAPI's
TestClient. This avoids depending on the snapshot/provider pipeline.
"""

from __future__ import annotations

import pytest
from unittest.mock import patch, AsyncMock

from backend.models.currency import FlipOpportunity, ClusterLabel


# ---------------------------------------------------------------------------
# Deterministic fixture data
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


# Three opportunities covering different score/spread/cluster/currency
_DEMO_OPPS = [
    _make_opp("divine/exalted", score=0.9, spread=0.05, volume_24h=1000,
              momentum=0.01, volatility=0.02, cluster=ClusterLabel.STABLE),
    _make_opp("chaos/exalted", score=0.5, spread=0.15, volume_24h=500,
              momentum=0.05, volatility=0.10, cluster=ClusterLabel.MODERATE),
    _make_opp("vaal-orb/exalted", score=0.2, spread=0.30, volume_24h=100,
              momentum=0.20, volatility=0.40, cluster=ClusterLabel.VOLATILE_ILLIQUID),
]


# ---------------------------------------------------------------------------
# Helper: patch the snapshot manager + build function for TestClient
# ---------------------------------------------------------------------------

@pytest.fixture
def flips_client():
    """Synchronous FastAPI TestClient with patched _build_flip_opportunities."""
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.api import data_snapshot

    # Make the snapshot manager report as ready so the route does not short-
    # circuit on "snapshot not yet collected".
    class _FakeSnapMgr:
        last_snapshot = object()  # truthy

    fake_mgr = _FakeSnapMgr()

    with patch.object(data_snapshot, "get_snapshot_manager", return_value=fake_mgr), \
         patch("backend.api.routes_arbitrage._build_flip_opportunities",
               new=AsyncMock(return_value=list(_DEMO_OPPS))):
        # Clear pipeline cache so the mock is actually called.
        from backend.data.unified_cache import get_pipeline_cache
        get_pipeline_cache().invalidate()
        with TestClient(app) as client:
            yield client
        get_pipeline_cache().invalidate()


# ===========================================================================
# 1. Backward-compat: existing params still work, defaults unchanged
# ===========================================================================

class TestFlipsBackwardCompat:
    """Verify existing /flips callers get the same behavior as before iter 67."""

    def test_default_params_returns_all_opportunities(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data_available"] is True
        # All three demo opps returned (default limit=50)
        assert data["total"] == 3
        assert len(data["opportunities"]) == 3

    def test_min_score_filter_still_works(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips?min_score=0.6")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["opportunities"][0]["currency"] == "divine/exalted"

    def test_min_volume_filter_still_works(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips?min_volume=600")
        assert resp.status_code == 200
        data = resp.json()
        # Only divine/exalted (volume 1000) passes; chaos/exalted has 500.
        assert data["total"] == 1
        assert data["opportunities"][0]["currency"] == "divine/exalted"

    def test_limit_param_still_works(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips?limit=2")
        assert resp.status_code == 200
        data = resp.json()
        # Total reflects all matches, but returned list is truncated.
        assert data["total"] == 2
        assert len(data["opportunities"]) == 2


# ===========================================================================
# 2. New filter params (P2-4)
# ===========================================================================

class TestFlipsNewFilters:
    """P2-4 iter 67: new filter params added to /flips."""

    def test_max_score_filter(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips?max_score=0.6")
        assert resp.status_code == 200
        data = resp.json()
        # Excludes divine/exalted (0.9); includes chaos (0.5) and vaal (0.2).
        assert data["total"] == 2
        currencies = {o["currency"] for o in data["opportunities"]}
        assert "divine/exalted" not in currencies
        assert "chaos/exalted" in currencies
        assert "vaal-orb/exalted" in currencies

    def test_min_spread_filter(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips?min_spread=0.10")
        assert resp.status_code == 200
        data = resp.json()
        # Only chaos (0.15) and vaal (0.30) pass — divine (0.05) excluded.
        assert data["total"] == 2
        currencies = {o["currency"] for o in data["opportunities"]}
        assert "divine/exalted" not in currencies

    def test_max_spread_filter(self, flips_client):
        resp = flips_client.get("/api/v1/arbitrage/flips?max_spread=0.20")
        assert resp.status_code == 200
        data = resp.json()
        # Only divine (0.05) and chaos (0.15) pass — vaal (0.30) excluded.
        assert data["total"] == 2
        currencies = {o["currency"] for o in data["opportunities"]}
        assert "vaal-orb/exalted" not in currencies

    def test_cluster_filter_exact_match(self, flips_client):
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?cluster=volatile_illiquid"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["opportunities"][0]["currency"] == "vaal-orb/exalted"

    def test_cluster_filter_invalid_returns_empty(self, flips_client):
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?cluster=nonexistent_cluster"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0

    def test_currency_substring_filter_case_insensitive(self, flips_client):
        # Substring "DIV" should match "divine/exalted"
        resp = flips_client.get("/api/v1/arbitrage/flips?currency=DIV")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["opportunities"][0]["currency"] == "divine/exalted"

    def test_currency_substring_matches_either_side(self, flips_client):
        # "exalted" appears as the "to" side in all three demo opps.
        resp = flips_client.get("/api/v1/arbitrage/flips?currency=exalted")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3


# ===========================================================================
# 3. New sort params (P2-4)
# ===========================================================================

class TestFlipsSort:
    """P2-4 iter 67: new sort_by / sort_dir params."""

    def test_sort_by_spread_desc(self, flips_client):
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?sort_by=spread&sort_dir=desc"
        )
        assert resp.status_code == 200
        data = resp.json()
        spreads = [o["spread"] for o in data["opportunities"]]
        assert spreads == sorted(spreads, reverse=True)
        # Largest spread first
        assert data["opportunities"][0]["currency"] == "vaal-orb/exalted"

    def test_sort_by_spread_asc(self, flips_client):
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?sort_by=spread&sort_dir=asc"
        )
        assert resp.status_code == 200
        data = resp.json()
        spreads = [o["spread"] for o in data["opportunities"]]
        assert spreads == sorted(spreads)
        # Smallest spread first
        assert data["opportunities"][0]["currency"] == "divine/exalted"

    def test_sort_by_volume_24h_desc(self, flips_client):
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?sort_by=volume_24h&sort_dir=desc"
        )
        assert resp.status_code == 200
        data = resp.json()
        vols = [o["volume_24h"] for o in data["opportunities"]]
        assert vols == sorted(vols, reverse=True)
        assert data["opportunities"][0]["currency"] == "divine/exalted"

    def test_sort_by_momentum_asc(self, flips_client):
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?sort_by=momentum&sort_dir=asc"
        )
        assert resp.status_code == 200
        data = resp.json()
        moms = [o["momentum"] for o in data["opportunities"]]
        assert moms == sorted(moms)

    def test_sort_by_volatility_desc(self, flips_client):
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?sort_by=volatility&sort_dir=desc"
        )
        assert resp.status_code == 200
        data = resp.json()
        vols = [o["volatility"] for o in data["opportunities"]]
        assert vols == sorted(vols, reverse=True)

    def test_invalid_sort_by_falls_back_to_score(self, flips_client):
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?sort_by=nonexistent"
        )
        assert resp.status_code == 200
        data = resp.json()
        # Falls back to "score" sort, desc by default — same as default behavior.
        assert data["total"] == 3
        scores = [o["score"] for o in data["opportunities"]]
        assert scores == sorted(scores, reverse=True)


# ===========================================================================
# 4. Combined filters + sort (integration-style)
# ===========================================================================

class TestFlipsCombined:
    """P2-4: Multiple filters + sort applied together."""

    def test_max_score_plus_cluster(self, flips_client):
        # max_score=0.6 excludes divine (0.9); cluster=moderate picks chaos only
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?max_score=0.6&cluster=moderate"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["opportunities"][0]["currency"] == "chaos/exalted"

    def test_min_volume_plus_sort_asc(self, flips_client):
        # min_volume=200 excludes vaal (100); sort by score asc
        resp = flips_client.get(
            "/api/v1/arbitrage/flips?min_volume=200&sort_by=score&sort_dir=asc"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        # Score asc → chaos (0.5) first, then divine (0.9)
        assert data["opportunities"][0]["currency"] == "chaos/exalted"
        assert data["opportunities"][1]["currency"] == "divine/exalted"


# ===========================================================================
# 5. Scanner endpoint deprecation signals (P2-4)
# ===========================================================================

class TestScannerDeprecation:
    """P2-4 iter 67: /api/v1/scanner/scan emits deprecation headers."""

    def test_scanner_returns_deprecation_header(self, flips_client):
        resp = flips_client.get("/api/v1/scanner/scan")
        # Scanner may return 200 (with mock data) or 503 if data unavailable —
        # we only care about the deprecation header.
        assert resp.headers.get("deprecation") == "true"
        assert "Sunset" in resp.headers
        # Link header points to the successor endpoint
        link_header = resp.headers.get("link", "")
        assert "/api/v1/arbitrage/flips" in link_header
        assert "successor-version" in link_header

    def test_scanner_still_returns_data(self, flips_client):
        """Scanner must keep working until iter 68 removal."""
        resp = flips_client.get("/api/v1/scanner/scan")
        assert resp.status_code == 200
        data = resp.json()
        # Scanner response shape still present
        assert "league" in data
        assert "opportunities" in data
        assert "scan_params" in data
        assert "data_available" in data
