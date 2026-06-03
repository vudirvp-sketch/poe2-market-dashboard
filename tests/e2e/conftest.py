"""
End-to-End Test Configuration.

Phase 2 (Spec Section 12): Provides fixtures for testing the full
FastAPI pipeline with a mock POE2Scout provider, avoiding live API calls.

Fixtures:
  - client       : Async HTTP client with mock provider (default)
  - flaky_client : Async HTTP client with FlakyPoe2ScoutProvider
                   (only when --flaky flag is passed)
  - daily_stats_cache : Fresh DailyStatsCache instance for stale-data tests
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch

from backend.data.providers.base import BaseDataProvider
from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
    PriceQuote,
)


# ---------------------------------------------------------------------------
# Custom pytest option: --flaky
# ---------------------------------------------------------------------------

def pytest_addoption(parser: pytest.Parser):
    """Add --flaky command-line flag to enable flaky-provider E2E tests."""
    parser.addoption(
        "--flaky",
        action="store_true",
        default=False,
        help="Run E2E tests with FlakyPoe2ScoutProvider (simulates upstream failure mid-session)",
    )


def pytest_configure(config: pytest.Config):
    """Register the 'flaky' marker so pytest doesn't warn about unknown markers."""
    config.addinivalue_line(
        "markers",
        "flaky: test uses FlakyPoe2ScoutProvider (requires --flaky flag)",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]):
    """Skip @pytest.mark.flaky tests unless --flaky is passed."""
    if config.getoption("--flaky"):
        return  # --flaky given: run all tests including flaky ones
    skip_flaky = pytest.mark.skip(reason="need --flaky option to run")
    for item in items:
        if "flaky" in item.keywords:
            item.add_marker(skip_flaky)


# ---------------------------------------------------------------------------
# FlakyPoe2ScoutProvider — works initially, then breaks on demand
# ---------------------------------------------------------------------------

class FlakyPoe2ScoutProvider(BaseDataProvider):
    """Mock provider that works initially, then fails after break_provider().

    This simulates the real-world scenario where the upstream API
    goes down mid-session. It is used by the `flaky_client` fixture
    and by tests marked with @pytest.mark.flaky.
    """

    def __init__(self):
        self._call_count = 0
        self._broken = False

    def name(self) -> str:
        return "flaky_mock"

    def break_provider(self):
        """Simulate upstream going down."""
        self._broken = True

    async def close(self) -> None:
        pass

    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        return None

    async def get_exchange_rates(self, league: str) -> dict:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        return {
            ("exalted", "chaos"): ExchangeRate(
                currency_from="exalted",
                currency_to="chaos",
                raw_rate=10.0,
                volume_traded=5000,
                stock_value=50000,
                highest_stock=100,
            ),
            ("divine", "exalted"): ExchangeRate(
                currency_from="divine",
                currency_to="exalted",
                raw_rate=220.0,
                volume_traded=1000,
                stock_value=220000,
                highest_stock=50,
            ),
        }

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        return [
            CurrencyInfo(
                api_id="divine",
                text="Divine Orb",
                category_api_id="currency",
                icon_url=None,
                item_id=42,
                currency_item_id=100,
            ),
            CurrencyInfo(
                api_id="exalted",
                text="Exalted Orb",
                category_api_id="currency",
                icon_url=None,
                item_id=43,
                currency_item_id=101,
            ),
        ]

    async def get_historical_prices(
        self, currency: str, days: int = 7
    ) -> list[PricePoint]:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        base_prices = {"divine": 220.0, "exalted": 1.0, "chaos": 0.1}
        price = base_prices.get(currency, 1.0)
        return [
            PricePoint(timestamp=now, price=price * (1 + 0.01 * i), volume=100)
            for i in range(days * 4)
        ]

    async def get_all_currencies_with_prices(self, league: str) -> list[dict]:
        """Return deterministic currency price data.

        Required by DataSnapshot which calls this method for the
        currencies + prices combined endpoint.
        """
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        return [
            {
                "api_id": "divine",
                "text": "Divine Orb",
                "icon_url": "https://web.poecdn.com/gen/image/divine.png",
                "current_price": 220.0,
                "current_quantity": 1000,
                "price_logs": [
                    {"price": 215.0, "time": "2025-01-20T00:00:00Z"},
                    {"price": 218.0, "time": "2025-01-20T06:00:00Z"},
                    {"price": 220.0, "time": "2025-01-20T12:00:00Z"},
                    {"price": 222.0, "time": "2025-01-20T18:00:00Z"},
                    {"price": 220.0, "time": "2025-01-21T00:00:00Z"},
                ],
            },
            {
                "api_id": "exalted",
                "text": "Exalted Orb",
                "icon_url": "https://web.poecdn.com/gen/image/exalted.png",
                "current_price": 1.0,
                "current_quantity": 5000,
                "price_logs": [
                    {"price": 1.0, "time": "2025-01-20T00:00:00Z"},
                    {"price": 1.02, "time": "2025-01-20T06:00:00Z"},
                    {"price": 0.99, "time": "2025-01-20T12:00:00Z"},
                    {"price": 1.01, "time": "2025-01-20T18:00:00Z"},
                    {"price": 1.0, "time": "2025-01-21T00:00:00Z"},
                ],
            },
        ]

    async def get_daily_stats(
        self, league: str, item_id: int, day_count: int = 30, end_date: str | None = None
    ) -> dict | None:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        # Return minimal deterministic daily stats
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        return {
            "item_id": item_id,
            "league": league,
            "days": [
                {
                    "day": (now - timedelta(days=i)).strftime("%Y-%m-%d"),
                    "open": 220.0 + i * 0.5,
                    "high": 225.0 + i * 0.5,
                    "low": 215.0 + i * 0.5,
                    "close": 220.0 + i * 0.5,
                    "volume": 1000 - i * 10,
                }
                for i in range(day_count)
            ],
        }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def client():
    """Async HTTP client for E2E testing against the FastAPI app.

    Uses the real (live) provider — tests should tolerate 503 when
    the upstream API is unavailable.
    """
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def mock_client():
    """Async HTTP client with MockPoe2ScoutProvider patched in.

    Uses deterministic mock data — no live API calls.
    """
    from backend.main import app
    from tests.e2e.mock_provider import MockPoe2ScoutProvider

    mock_provider = MockPoe2ScoutProvider()
    with patch("backend.api.shared.get_provider", return_value=mock_provider):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


@pytest.fixture
async def flaky_client():
    """Async HTTP client with FlakyPoe2ScoutProvider patched in.

    The provider works initially but can be broken on demand via
    provider.break_provider(). Only active when --flaky is passed.

    Returns a tuple of (client, provider) so tests can call break_provider().
    """
    from backend.main import app

    provider = FlakyPoe2ScoutProvider()
    with patch("backend.api.shared.get_provider", return_value=provider):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac, provider


@pytest.fixture
def daily_stats_cache():
    """Fresh DailyStatsCache instance for integration testing.

    Uses a very short TTL (0.1s) so tests can exercise stale-data
    behaviour without waiting. After the test, the cache is invalidated
    to avoid cross-test contamination.

    Usage:
        cache = daily_stats_cache
        result = await cache.get_or_fetch(my_fetch_fn, "runes", "divine", 30)
        assert result.stale is False

        # Wait for TTL expiry, then check stale behaviour
        import time; time.sleep(0.15)
        result = await cache.get_or_fetch(my_fetch_fn, "runes", "divine", 30)
        assert result.stale is True
    """
    from backend.data.daily_stats_cache import DailyStatsCache
    from cachetools import TTLCache

    cache = DailyStatsCache()
    cache._ttl = 0.1  # 100ms TTL for fast test execution
    cache._cache = TTLCache(maxsize=256, ttl=cache._ttl)  # Must recreate TTLCache with new TTL
    yield cache
    cache.invalidate()


@pytest.fixture
def daily_stats_cache_with_flaky_provider(flaky_client):
    """DailyStatsCache wired to FlakyPoe2ScoutProvider for full integration check.

    This fixture combines the flaky_client (which patches the shared provider)
    with a DailyStatsCache so that tests can verify stale-data serving
    through the API endpoints when the provider breaks mid-session.

    Returns (cache, client, provider) tuple.

    Only available when --flaky is passed.
    """
    from backend.data.daily_stats_cache import DailyStatsCache
    from cachetools import TTLCache

    client, provider = flaky_client
    cache = DailyStatsCache()
    cache._ttl = 0.5  # 500ms TTL — fast but not too aggressive for async tests
    cache._cache = TTLCache(maxsize=256, ttl=cache._ttl)  # Must recreate TTLCache with new TTL
    yield cache, client, provider
    cache.invalidate()
