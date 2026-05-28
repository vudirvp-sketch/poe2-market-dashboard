"""
Poe2ScoutProvider — primary data provider using the POE2Scout public API.

API base URL: https://api.poe2scout.com/api
Swagger docs: https://api.poe2scout.com/api/swagger

Key conventions:
- All response fields are PascalCase (alias_generator in schemas.py)
- Decimal fields (Volume, ValueTraded, etc.) come as strings → must convert
- Realm path segment required: e.g. "poe2/pc"
- Rate limit: ~100 req/min per IP; we use 1 req/s (configurable) via semaphore
- On HTTP 429: exponential backoff, max 3 retries, then return None
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from backend.config import AppConfig, get_settings
from backend.data.providers.base import BaseDataProvider
from backend.data.schemas import (
    CurrencyByCategoryResponse,
    CurrencyItem as CurrencyInfoModel,
    CurrencyItemExtended,
    ExchangeSnapshot,
    LeagueInfo,
    PairHistoryResponse,
    RealmOption,
    ReferenceCurrency,
    SnapshotHistoryResponse,
    SnapshotPair,
)
from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
    PriceQuote,
)

logger = logging.getLogger(__name__)


def _normalize_api_id(api_id: str) -> str:
    """Normalize an API ID for gold cost table lookup.
    Lowercase, replace spaces/hyphens with underscores, remove apostrophes.
    """
    return api_id.lower().replace(" ", "_").replace("-", "_").replace("'", "")


class Poe2ScoutProvider(BaseDataProvider):
    """Primary data provider backed by the POE2Scout public API."""

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()
        self._base_url = self._config.data.poe2scout_base_url.rstrip("/")
        self._realm = self._config.league.realm
        self._league = self._config.league.league_name
        self._rate_limit = self._config.data.rate_limit_per_second
        self._semaphore = asyncio.Semaphore(max(1, int(self._rate_limit)))
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=20.0,
                headers={"User-Agent": "PoE2Flipper/0.1"},
            )
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    def name(self) -> str:
        return "poe2scout"

    # ------------------------------------------------------------------
    # Low-level request with retry and rate limiting
    # ------------------------------------------------------------------

    async def _request(
        self, path: str, params: dict | None = None
    ) -> dict | list | None:
        """Make a rate-limited request with exponential backoff on 429."""
        url = f"{self._base_url}/{path}"
        client = await self._get_client()

        max_retries = 3
        backoff = 1.0

        for attempt in range(max_retries + 1):
            async with self._semaphore:
                try:
                    resp = await client.get(url, params=params)

                    if resp.status_code == 429:
                        if attempt < max_retries:
                            logger.warning(
                                "Rate limited on %s, backing off %.1fs (attempt %d)",
                                path, backoff, attempt + 1,
                            )
                            await asyncio.sleep(backoff)
                            backoff *= 2
                            continue
                        else:
                            logger.error("Rate limited on %s after %d retries", path, max_retries)
                            return None

                    resp.raise_for_status()
                    return resp.json()

                except httpx.HTTPStatusError as e:
                    logger.error("HTTP error %d on %s: %s", e.response.status_code, path, e)
                    return None
                except httpx.RequestError as e:
                    logger.error("Request error on %s: %s", path, e)
                    return None

        return None

    # ------------------------------------------------------------------
    # Helpers to build API paths
    # ------------------------------------------------------------------

    def _league_path(self) -> str:
        """Base path for league-scoped endpoints."""
        return f"{self._realm}/Leagues/{self._league}"

    # ------------------------------------------------------------------
    # Public interface implementations
    # ------------------------------------------------------------------

    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        """Get current price for a pair like 'divine/exalted'.

        Uses SnapshotPairs endpoint and finds the matching pair.
        """
        parts = currency_pair.split("/")
        if len(parts) != 2:
            logger.warning("Invalid currency pair format: %s", currency_pair)
            return None

        curr_from, curr_to = parts[0].lower(), parts[1].lower()

        pairs_data = await self._request(
            f"{self._league_path()}/SnapshotPairs"
        )
        if pairs_data is None:
            return None

        # Parse response
        try:
            if isinstance(pairs_data, list):
                pairs = [SnapshotPair.model_validate(p) for p in pairs_data]
            else:
                return None
        except Exception as e:
            logger.error("Failed to parse SnapshotPairs: %s", e)
            return None

        # Find the matching pair
        for pair in pairs:
            c1_id = (pair.currency_one.api_id or "").lower()
            c2_id = (pair.currency_two.api_id or "").lower()

            if (c1_id == curr_from and c2_id == curr_to) or \
               (c1_id == curr_to and c2_id == curr_from):

                # Determine which side is which
                if c1_id == curr_from:
                    # We're buying curr_to with curr_from
                    my_data = pair.currency_two_data  # what we receive
                    other_data = pair.currency_one_data
                else:
                    my_data = pair.currency_one_data
                    other_data = pair.currency_two_data

                if my_data is None or other_data is None:
                    continue

                # Derive pair price: pairPrice = other.volumeTraded / self.volumeTraded
                vol_self = float(my_data.volume_traded) if my_data.volume_traded else 1
                vol_other = float(other_data.volume_traded) if other_data.volume_traded else 0

                if vol_self <= 0:
                    continue

                raw_rate = vol_other / vol_self  # units of curr_to per 1 curr_from

                # Estimate bid/ask from the pair (spread is implicit in the market)
                # For now, use the raw rate as mid_price with a small estimated spread
                mid_price = raw_rate
                # We don't have explicit bid/ask from snapshot pairs;
                # use relative_price as a secondary signal
                rel_price = float(my_data.relative_price) if my_data.relative_price else mid_price

                return PriceQuote(
                    pair=currency_pair,
                    bid=mid_price * 0.99,  # estimated — real bid/ask requires order book
                    ask=mid_price * 1.01,
                    mid_price=mid_price,
                    volume_24h=float(vol_self + vol_other),
                    timestamp=datetime.now(timezone.utc),
                )

        logger.info("Pair %s not found in SnapshotPairs", currency_pair)
        return None

    async def get_historical_prices(
        self, currency: str, days: int = 7
    ) -> list[PricePoint]:
        """Get historical prices for a currency from the ByCategory or detail endpoint."""
        # Try getting the currency detail
        data = await self._request(
            f"{self._league_path()}/Currencies/{currency}"
        )
        if data is None:
            return []

        try:
            ext = CurrencyItemExtended.model_validate(data)
        except Exception as e:
            logger.error("Failed to parse currency detail for %s: %s", currency, e)
            return []

        points = []
        if ext.price_logs:
            for log in ext.price_logs:
                if log is not None:
                    points.append(PricePoint(
                        timestamp=log.time,
                        price=log.price,
                        volume=log.quantity,
                    ))

        return points

    async def get_exchange_rates(self, league: str) -> dict[str, ExchangeRate]:
        """Get all exchange rates from SnapshotPairs."""
        old_league = self._league
        self._league = league
        try:
            pairs_data = await self._request(
                f"{self._league_path()}/SnapshotPairs"
            )
        finally:
            self._league = old_league

        if pairs_data is None:
            return {}

        try:
            if isinstance(pairs_data, list):
                pairs = [SnapshotPair.model_validate(p) for p in pairs_data]
            else:
                return {}
        except Exception as e:
            logger.error("Failed to parse SnapshotPairs: %s", e)
            return {}

        rates: dict[str, ExchangeRate] = {}

        for pair in pairs:
            if pair.currency_one is None or pair.currency_two is None:
                continue
            if pair.currency_one_data is None or pair.currency_two_data is None:
                continue

            c1_id = pair.currency_one.api_id
            c2_id = pair.currency_two.api_id
            c1_data = pair.currency_one_data
            c2_data = pair.currency_two_data

            # Forward rate: 1 unit of c1 → how many c2
            vol1 = float(c1_data.volume_traded) if c1_data.volume_traded else 1
            vol2 = float(c2_data.volume_traded) if c2_data.volume_traded else 0

            if vol1 > 0:
                forward_rate = vol2 / vol1
                forward_key = f"{c1_id}/{c2_id}"
                rates[forward_key] = ExchangeRate(
                    currency_from=c1_id,
                    currency_to=c2_id,
                    raw_rate=forward_rate,
                    volume_traded=int(vol1),
                    stock_value=float(c1_data.stock_value) if c1_data.stock_value else 0,
                    highest_stock=c1_data.highest_stock,
                    timestamp=datetime.now(timezone.utc),
                )

            # Reverse rate
            if vol2 > 0:
                reverse_rate = vol1 / vol2
                reverse_key = f"{c2_id}/{c1_id}"
                rates[reverse_key] = ExchangeRate(
                    currency_from=c2_id,
                    currency_to=c1_id,
                    raw_rate=reverse_rate,
                    volume_traded=int(vol2),
                    stock_value=float(c2_data.stock_value) if c2_data.stock_value else 0,
                    highest_stock=c2_data.highest_stock,
                    timestamp=datetime.now(timezone.utc),
                )

        return rates

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        """Get currency metadata from the ByCategory endpoint."""
        old_league = self._league
        self._league = league
        try:
            data = await self._request(
                f"{self._league_path()}/Currencies/ByCategory",
                params={"PerPage": "250"},
            )
        finally:
            self._league = old_league

        if data is None:
            return []

        try:
            resp = CurrencyByCategoryResponse.model_validate(data)
        except Exception as e:
            logger.error("Failed to parse Currencies/ByCategory: %s", e)
            return []

        result = []
        for item in resp.items:
            result.append(CurrencyInfo(
                api_id=item.api_id,
                text=item.text,
                category_api_id=item.category_api_id,
                icon_url=item.icon_url,
                item_id=item.item_id,
                currency_item_id=item.currency_item_id,
            ))

        return result

    async def get_gold_chaos_rate(self, league: str) -> float | None:
        """Observe the gold→chaos rate from the market.

        POE2Scout doesn't directly provide gold→chaos rates.
        We derive it from the exchange: if 1 Chaos Orb costs X Exalted,
        and we know the approximate gold cost per Chaos Orb, we can estimate.

        For now, this returns None — the rate should be configured manually
        or derived from an external source. See config.yaml fees section.
        """
        # TODO: Implement market-based gold_to_chaos observation
        # For now, rely on config.fees.fixed_gold_to_chaos_rate or user input
        return None

    # ------------------------------------------------------------------
    # Additional convenience methods
    # ------------------------------------------------------------------

    async def get_leagues(self) -> list[LeagueInfo]:
        """Get available leagues for the configured realm."""
        data = await self._request(f"{self._realm}/Leagues")
        if data is None:
            return []
        try:
            if isinstance(data, list):
                return [LeagueInfo.model_validate(l) for l in data]
            return []
        except Exception as e:
            logger.error("Failed to parse leagues: %s", e)
            return []

    async def get_reference_currencies(self, league: str) -> list[ReferenceCurrency]:
        """Get reference/bridge currencies for a league."""
        old_league = self._league
        self._league = league
        try:
            data = await self._request(
                f"{self._league_path()}/ReferenceCurrencies"
            )
        finally:
            self._league = old_league

        if data is None:
            return []
        try:
            if isinstance(data, list):
                return [ReferenceCurrency.model_validate(r) for r in data]
            return []
        except Exception as e:
            logger.error("Failed to parse reference currencies: %s", e)
            return []

    async def get_snapshot_history(
        self, league: str, limit: int = 100, end_epoch: int | None = None
    ) -> SnapshotHistoryResponse | None:
        """Get exchange snapshot history."""
        old_league = self._league
        self._league = league
        try:
            params: dict[str, Any] = {"Limit": str(limit)}
            if end_epoch is not None:
                params["EndEpoch"] = str(end_epoch)
            data = await self._request(
                f"{self._league_path()}/SnapshotHistory", params=params
            )
        finally:
            self._league = old_league

        if data is None:
            return None
        try:
            return SnapshotHistoryResponse.model_validate(data)
        except Exception as e:
            logger.error("Failed to parse snapshot history: %s", e)
            return None

    async def get_pair_history(
        self,
        league: str,
        currency_one_item_id: int,
        currency_two_item_id: int,
        limit: int = 100,
        end_epoch: int | None = None,
    ) -> PairHistoryResponse | None:
        """Get historical data for a specific trading pair."""
        old_league = self._league
        self._league = league
        try:
            params: dict[str, Any] = {"Limit": str(limit)}
            if end_epoch is not None:
                params["EndEpoch"] = str(end_epoch)
            data = await self._request(
                f"{self._league_path()}/Currencies/Pairs/"
                f"{currency_one_item_id}/{currency_two_item_id}/History",
                params=params,
            )
        finally:
            self._league = old_league

        if data is None:
            return None
        try:
            return PairHistoryResponse.model_validate(data)
        except Exception as e:
            logger.error("Failed to parse pair history: %s", e)
            return None
