"""
OfficialTradeProvider — fallback provider using GGG's trade API.

IMPORTANT: This provider is only used when POE2Scout returns no data.
It must NOT be used for bulk polling — only on-demand single-pair queries.

GGG Trade API:
- Base URL: https://www.pathofexile.com/api/trade2/...
- Currency exchange: requires OAuth2 with service:cxapi scope
- Item search: no auth required, but 17-second mandatory sleep between POSTs
- Rate limits documented at: https://www.pathofexile.com/developer/docs

For now, this is a STUB implementation that returns None for all methods.
Full implementation requires OAuth2 credentials which are not available
in this context.
"""

from __future__ import annotations

import logging
from typing import Optional

from backend.data.providers.base import BaseDataProvider
from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
    PriceQuote,
)

logger = logging.getLogger(__name__)


class OfficialTradeProvider(BaseDataProvider):
    """Fallback data provider using GGG's official trade API.

    This is a STUB. Full implementation requires:
    1. OAuth2 credentials with service:cxapi scope
    2. Respecting GGG's 17-second mandatory sleep between POSTs
    3. Strict rate limit compliance

    Only use for on-demand single-pair queries when POE2Scout has no data.
    """

    def __init__(self):
        self._initialized = False

    def name(self) -> str:
        return "official"

    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        """STUB: Not implemented. Returns None."""
        logger.warning(
            "OfficialTradeProvider.get_current_price not implemented. "
            "Pair: %s", currency_pair
        )
        return None

    async def get_historical_prices(
        self, currency: str, days: int
    ) -> list[PricePoint]:
        """STUB: Not implemented. Returns empty list."""
        logger.warning(
            "OfficialTradeProvider.get_historical_prices not implemented. "
            "Currency: %s", currency
        )
        return []

    async def get_exchange_rates(self, league: str) -> dict[str, ExchangeRate]:
        """STUB: Not implemented. Returns empty dict."""
        logger.warning(
            "OfficialTradeProvider.get_exchange_rates not implemented. "
            "League: %s", league
        )
        return {}

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        """STUB: Not implemented. Returns empty list."""
        logger.warning(
            "OfficialTradeProvider.get_currency_metadata not implemented. "
            "League: %s", league
        )
        return []

    async def get_gold_chaos_rate(self, league: str) -> float | None:
        """STUB: Not implemented. Returns None."""
        return None
