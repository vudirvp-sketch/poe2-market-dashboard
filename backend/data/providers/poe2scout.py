"""
Poe2ScoutProvider — primary data provider using the POE2Scout public API.

API base URL: https://api.poe2scout.com/api
Swagger docs: https://api.poe2scout.com/api/swagger

CRITICAL FINDING: The /{Realm} path parameter does NOT use the `value` field
from /Realms (e.g. "poe2/poe2" or "poe2/pc"). Instead it uses a SIMPLIFIED
single-segment identifier. For PoE2 PC, the correct realm path is "poe2".

Key conventions:
- All response fields are PascalCase (alias_generator in schemas.py)
- Decimal fields (Volume, ValueTraded, etc.) come as strings → must convert
- Realm path segment for PoE2: "poe2" (NOT "poe2/pc" or "poe2/poe2")
- Rate limit: ~100 req/min per IP; we use 1 req/s (configurable) via semaphore
- On HTTP 429: exponential backoff, max 3 retries, then return None
- LogCount for price history must be a multiple of 4
- ByCategory endpoints are paginated (max 250 per page)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from backend.config import AppConfig, get_settings
from backend.data.providers.base import BaseDataProvider
from backend.data.schemas import (
    CategoriesResponse,
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
        # CRITICAL: realm must be "poe2" for POE2Scout API path, NOT "poe2/pc"
        # The /Realms endpoint returns value="poe2/poe2" but the actual path
        # parameter uses the simplified segment "poe2".
        raw_realm = self._config.league.realm

        # Instance-level cache for ByCategory data (used as fallback when
        # individual /Currencies/{id} endpoint returns empty PriceLogs).
        # TTL matches cache_ttl_prices_minutes so it stays in sync.
        self._bycategory_cache: list[dict] | None = None
        self._bycategory_cache_ts: float = 0.0
        self._bycategory_cache_ttl: float = (
            self._config.data.cache_ttl_prices_minutes * 60.0
        )
        # Auto-correct common mistake: if someone puts "poe2/pc" or "poe2/poe2",
        # extract the last segment or use "poe2" for poe2 games
        if "/" in raw_realm:
            parts = raw_realm.split("/")
            # For poe2 realms, use just "poe2"
            if "poe2" in parts:
                self._realm = "poe2"
            else:
                # For poe1, use the realm_api_id (e.g. "pc", "xbox", "sony")
                self._realm = parts[-1]
            logger.info(
                "Realm corrected from '%s' to '%s' for API path compatibility",
                raw_realm, self._realm,
            )
        else:
            self._realm = raw_realm
        self._league = self._config.league.league_name
        self._rate_limit = self._config.data.rate_limit_per_second
        self._semaphore = asyncio.Semaphore(max(1, int(self._rate_limit)))
        self._last_request_time: float = 0.0
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=20.0,
                headers={"User-Agent": "PoE2Flipper/0.2"},
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
        """Make a rate-limited request with exponential backoff on 429.

        Enforces a minimum interval between requests based on rate_limit_per_second.
        """
        url = f"{self._base_url}/{path}"
        client = await self._get_client()

        max_retries = 3
        backoff = 1.0

        for attempt in range(max_retries + 1):
            # Rate limiting: ensure minimum interval between requests
            async with self._semaphore:
                now = asyncio.get_event_loop().time()
                min_interval = 1.0 / max(self._rate_limit, 0.1)
                elapsed = now - self._last_request_time
                if elapsed < min_interval and self._last_request_time > 0:
                    await asyncio.sleep(min_interval - elapsed)

                try:
                    self._last_request_time = asyncio.get_event_loop().time()
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
        The rate is derived from relative_price in the pair data, which
        represents the price of each currency relative to the base currency.
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
            if pair.currency_one is None or pair.currency_two is None:
                continue
            c1_id = (pair.currency_one.api_id or "").lower()
            c2_id = (pair.currency_two.api_id or "").lower()

            if (c1_id == curr_from and c2_id == curr_to) or \
               (c1_id == curr_to and c2_id == curr_from):

                # Use relative_price for rate derivation
                # relative_price gives the price of each currency in the pair
                # relative to the base currency (Exalted for PoE2)
                if c1_id == curr_from:
                    my_data = pair.currency_two_data
                    other_data = pair.currency_one_data
                else:
                    my_data = pair.currency_one_data
                    other_data = pair.currency_two_data

                if my_data is None or other_data is None:
                    continue

                # Derive cross-rate from relative_prices:
                # If from_price and to_price are both in base_currency terms,
                # then the rate from→to = to_price / from_price
                from_rel = float(other_data.relative_price) if other_data.relative_price else 0
                to_rel = float(my_data.relative_price) if my_data.relative_price else 0

                if from_rel <= 0 or to_rel <= 0:
                    # Fallback: use volume-based rate derivation
                    vol_self = float(my_data.volume_traded) if my_data.volume_traded else 1
                    vol_other = float(other_data.volume_traded) if other_data.volume_traded else 0
                    if vol_self <= 0:
                        continue
                    raw_rate = vol_other / vol_self
                else:
                    raw_rate = to_rel / from_rel

                # Estimate bid/ask spread from pair data
                # The POE2Scout API doesn't provide explicit bid/ask;
                # we estimate a small spread around the mid rate
                mid_price = raw_rate
                # Use volume data to estimate spread tightness
                vol_self = float(my_data.volume_traded) if my_data.volume_traded else 1
                vol_other = float(other_data.volume_traded) if other_data.volume_traded else 1
                total_vol = vol_self + vol_other
                # Higher volume → tighter spread estimate
                spread_est = max(0.005, min(0.05, 10.0 / max(total_vol, 1)))

                return PriceQuote(
                    pair=currency_pair,
                    bid=mid_price * (1 - spread_est / 2),
                    ask=mid_price * (1 + spread_est / 2),
                    mid_price=mid_price,
                    volume_24h=total_vol,
                    timestamp=datetime.now(timezone.utc),
                )

        logger.info("Pair %s not found in SnapshotPairs", currency_pair)
        return None

    async def get_historical_prices(
        self, currency: str, days: int = 7
    ) -> list[PricePoint]:
        """Get historical prices for a currency.

        Strategy (two-tier fallback):
        1. Try the individual /Currencies/{ApiId} endpoint — fast, single
           request.  However, the POE2Scout API has a known inconsistency
           where this endpoint sometimes returns ``PriceLogs: [null, …]``
           with ``CurrentPrice: null``, while the ByCategory endpoint
           returns complete data for the same currency.
        2. If the individual endpoint returns empty/null PriceLogs, fall
           back to the ByCategory data which consistently contains price
           history.  A short-TTL instance cache avoids re-fetching all
           categories on every call.
        """
        # --- Tier 1: individual endpoint ---
        data = await self._request(
            f"{self._league_path()}/Currencies/{currency}"
        )
        if data is not None:
            try:
                ext = CurrencyItemExtended.model_validate(data)
                points: list[PricePoint] = []
                if ext.price_logs:
                    for log in ext.price_logs:
                        if log is not None:
                            points.append(PricePoint(
                                timestamp=log.time,
                                price=log.price,
                                volume=log.quantity,
                            ))
                if points:
                    return points
            except Exception as e:
                logger.error("Failed to parse currency detail for %s: %s", currency, e)

        # --- Tier 2: ByCategory fallback ---
        # The individual endpoint returned empty PriceLogs (known API bug).
        # ByCategory consistently returns complete data, so we use it as a
        # reliable fallback.  An instance-level cache avoids hammering the
        # API when multiple currencies are queried in quick succession.
        logger.info(
            "Individual /Currencies/%s returned empty PriceLogs — "
            "falling back to ByCategory data",
            currency,
        )
        all_currencies = await self._get_all_currencies_cached()

        for curr in all_currencies:
            if curr.get("api_id", "").lower() == currency.lower():
                price_logs = curr.get("price_logs", [])
                if price_logs:
                    points = []
                    for log in price_logs:
                        time_val = log.get("time")
                        price = log.get("price")
                        quantity = log.get("quantity", 0)
                        if time_val is not None and price is not None:
                            try:
                                if isinstance(time_val, str):
                                    ts = datetime.fromisoformat(
                                        time_val.replace("Z", "+00:00")
                                    )
                                elif isinstance(time_val, datetime):
                                    ts = time_val
                                else:
                                    continue
                                points.append(PricePoint(
                                    timestamp=ts,
                                    price=float(price),
                                    volume=float(quantity) if quantity else 0.0,
                                ))
                            except (ValueError, TypeError) as exc:
                                logger.debug(
                                    "Skipping invalid price log for %s: %s",
                                    currency, exc,
                                )
                    if points:
                        return points
                break  # found the currency but no usable logs — stop searching

        return []

    async def _get_all_currencies_cached(self) -> list[dict]:
        """Return all currencies with prices, using a short-TTL instance cache.

        The cache prevents redundant API calls when
        ``get_historical_prices()`` falls back to ByCategory for several
        currencies in quick succession (e.g. when the dashboard loads
        multiple Flipper tabs simultaneously).
        """
        import time as _time

        now = _time.monotonic()
        if (
            self._bycategory_cache is not None
            and now - self._bycategory_cache_ts < self._bycategory_cache_ttl
        ):
            return self._bycategory_cache

        result = await self.get_all_currencies_with_prices(self._league)
        self._bycategory_cache = result
        self._bycategory_cache_ts = now
        return result

    async def get_exchange_rates(self, league: str) -> dict[str, ExchangeRate]:
        """Get all exchange rates from SnapshotPairs.

        Rates are derived from relative_price fields, which express each
        currency's value in terms of the base currency (Exalted for PoE2).
        This is more reliable than volume-based rate derivation.
        """
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

            # Derive cross-rates from relative_price
            # relative_price = price of this currency in base_currency units
            c1_rel = float(c1_data.relative_price) if c1_data.relative_price else 0
            c2_rel = float(c2_data.relative_price) if c2_data.relative_price else 0

            # Forward rate: 1 unit of c1 → how many c2
            # = c1_rel / c2_rel (c1 is worth c1_rel base, each c2 is worth c2_rel base)
            if c1_rel > 0 and c2_rel > 0:
                forward_rate = c1_rel / c2_rel
            else:
                # Fallback to volume-based derivation
                vol1 = float(c1_data.volume_traded) if c1_data.volume_traded else 1
                vol2 = float(c2_data.volume_traded) if c2_data.volume_traded else 0
                if vol1 <= 0:
                    continue
                forward_rate = vol2 / vol1

            forward_key = f"{c1_id}/{c2_id}"
            rates[forward_key] = ExchangeRate(
                currency_from=c1_id,
                currency_to=c2_id,
                raw_rate=forward_rate,
                volume_traded=int(float(c1_data.volume_traded) if c1_data.volume_traded else 0),
                stock_value=float(c1_data.stock_value) if c1_data.stock_value else 0,
                highest_stock=c1_data.highest_stock,
                timestamp=datetime.now(timezone.utc),
            )

            # Reverse rate
            if c2_rel > 0 and c1_rel > 0:
                reverse_rate = c2_rel / c1_rel
            else:
                vol2 = float(c2_data.volume_traded) if c2_data.volume_traded else 0
                vol1 = float(c1_data.volume_traded) if c1_data.volume_traded else 1
                if vol2 <= 0:
                    continue
                reverse_rate = vol1 / vol2

            reverse_key = f"{c2_id}/{c1_id}"
            rates[reverse_key] = ExchangeRate(
                currency_from=c2_id,
                currency_to=c1_id,
                raw_rate=reverse_rate,
                volume_traded=int(float(c2_data.volume_traded) if c2_data.volume_traded else 0),
                stock_value=float(c2_data.stock_value) if c2_data.stock_value else 0,
                highest_stock=c2_data.highest_stock,
                timestamp=datetime.now(timezone.utc),
            )

        return rates

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        """Get currency metadata from ALL ByCategory endpoints with pagination.

        POE2Scout organizes currencies into categories (currency, fragments,
        runes, etc.). We iterate through all known categories and paginate
        through each to build a complete currency list.
        """
        old_league = self._league
        self._league = league
        result: list[CurrencyInfo] = []

        try:
            # First, get categories to know what's available
            cat_data = await self._request(
                f"{self._league_path()}/Items/Categories"
            )
            categories: list[str] = []
            if cat_data is not None:
                try:
                    cat_resp = CategoriesResponse.model_validate(cat_data)
                    categories = [c.api_id for c in cat_resp.currency_categories if c.api_id]
                except Exception as e:
                    logger.warning("Failed to parse categories, using defaults: %s", e)

            # Fall back to configured categories if none found
            if not categories:
                categories = self._config.league.currency_categories

            # Fetch currencies from each category with pagination
            for category in categories:
                page = 1
                while True:
                    data = await self._request(
                        f"{self._league_path()}/Currencies/ByCategory",
                        params={
                            "Category": category,
                            "Page": str(page),
                            "PerPage": "250",
                        },
                    )
                    if data is None:
                        break

                    try:
                        resp = CurrencyByCategoryResponse.model_validate(data)
                    except Exception as e:
                        logger.error("Failed to parse Currencies/ByCategory(%s page %d): %s", category, page, e)
                        break

                    for item in resp.items:
                        result.append(CurrencyInfo(
                            api_id=item.api_id,
                            text=item.text,
                            category_api_id=item.category_api_id,
                            icon_url=item.icon_url,
                            item_id=item.item_id,
                            currency_item_id=item.currency_item_id,
                        ))

                    # Check if there are more pages
                    if page >= resp.pages or not resp.items:
                        break
                    page += 1
        finally:
            self._league = old_league

        return result

    async def get_gold_chaos_rate(self, league: str) -> float | None:
        """Derive the gold→chaos rate from known game mechanics.

        The gold cost per Chaos Orb is a FIXED game mechanic (160 gold per
        Chaos in the Currency Exchange).  We use the reciprocal as a lower
        bound for the market rate of gold in Chaos terms:

            gold_to_chaos_rate = 1 / gold_cost_per_chaos

        This represents the minimum value of 1 gold coin: you can always
        "spend" 1/160 Chaos worth of gold on exchange fees.  The true market
        rate (what players would pay for gold) is typically lower because gold
        is abundant from mapping (~35-40k per T16 map), but for fee
        calculations the reciprocal is the correct rate — it tells us how much
        Chaos value each gold coin of fees consumes.

        If a fixed rate is configured in config.yaml
        (fees.fixed_gold_to_chaos_rate), callers should prefer that over
        this derived rate.

        Returns:
            Derived gold→chaos rate (e.g. 0.00625 for 160 gold/Chaos),
            or None if the gold cost table is unavailable.
        """
        try:
            from backend.economy.gold_cost_table import get_gold_cost_per_unit
            gold_per_chaos = get_gold_cost_per_unit("chaos")
            if gold_per_chaos > 0:
                rate = 1.0 / gold_per_chaos
                logger.debug(
                    "Derived gold_to_chaos_rate=%.6f from gold_cost_per_chaos=%d",
                    rate, gold_per_chaos,
                )
                return rate
        except Exception as e:
            logger.debug("Could not derive gold_to_chaos_rate: %s", e)

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

    async def get_realms(self) -> list[RealmOption]:
        """Get available realms."""
        data = await self._request("Realms")
        if data is None:
            return []
        try:
            if isinstance(data, list):
                return [RealmOption.model_validate(r) for r in data]
            return []
        except Exception as e:
            logger.error("Failed to parse realms: %s", e)
            return []

    async def get_reference_currencies(self, league: str) -> list[ReferenceCurrency]:
        """Get reference/bridge currencies for a league.

        Returns the base currency (Exalted for PoE2) and bridge currencies
        (Chaos rank 1, Divine rank 2) with their relative prices.
        """
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

    async def get_daily_stats(
        self,
        league: str,
        item_id: int,
        day_count: int = 30,
        end_date: str | None = None,
    ) -> dict | None:
        """Get daily OHLCV stats for an item.

        Returns DailyStatsPoint data: {time, open, high, low, close, average, volume}.
        """
        old_league = self._league
        self._league = league
        try:
            params: dict[str, Any] = {"DayCount": str(day_count)}
            if end_date is not None:
                params["EndDate"] = end_date
            data = await self._request(
                f"{self._league_path()}/Items/{item_id}/DailyStatsHistory",
                params=params,
            )
        finally:
            self._league = old_league

        if data is None:
            return None
        return data

    async def get_price_history(
        self,
        league: str,
        item_id: int,
        log_count: int = 100,
        end_time: str | None = None,
        reference_currency: str | None = None,
    ) -> dict | None:
        """Get price history for an item.

        Note: LogCount MUST be a multiple of 4 per API requirements.
        """
        # Ensure log_count is a multiple of 4
        log_count = max(4, math.ceil(log_count / 4) * 4)

        old_league = self._league
        self._league = league
        try:
            params: dict[str, Any] = {"LogCount": str(log_count)}
            if end_time is not None:
                params["EndTime"] = end_time
            if reference_currency is not None:
                params["ReferenceCurrency"] = reference_currency
            data = await self._request(
                f"{self._league_path()}/Items/{item_id}/History",
                params=params,
            )
        finally:
            self._league = old_league

        if data is None:
            return None
        return data

    async def get_all_currencies_with_prices(self, league: str) -> list[dict]:
        """Fetch all currencies across all categories with their current prices.

        This is a convenience method that paginates through all categories
        and returns currencies with their price_logs for momentum computation.
        """
        old_league = self._league
        self._league = league
        result: list[dict] = []

        try:
            # Get categories
            cat_data = await self._request(
                f"{self._league_path()}/Items/Categories"
            )
            categories: list[str] = []
            if cat_data is not None:
                try:
                    cat_resp = CategoriesResponse.model_validate(cat_data)
                    categories = [c.api_id for c in cat_resp.currency_categories if c.api_id]
                except Exception:
                    pass

            if not categories:
                categories = self._config.league.currency_categories

            for category in categories:
                page = 1
                while True:
                    data = await self._request(
                        f"{self._league_path()}/Currencies/ByCategory",
                        params={
                            "Category": category,
                            "Page": str(page),
                            "PerPage": "250",
                        },
                    )
                    if data is None:
                        break

                    try:
                        resp = CurrencyByCategoryResponse.model_validate(data)
                    except Exception as e:
                        logger.debug("Failed to parse ByCategory(%s p%d): %s", category, page, e)
                        break

                    for item in resp.items:
                        price_logs = []
                        if item.price_logs:
                            for log in item.price_logs:
                                if log is not None:
                                    price_logs.append({
                                        "time": log.time.isoformat() if log.time else None,
                                        "price": log.price,
                                        "quantity": log.quantity,
                                    })

                        result.append({
                            "api_id": item.api_id,
                            "text": item.text,
                            "category_api_id": item.category_api_id,
                            "icon_url": item.icon_url,
                            "item_id": item.item_id,
                            "currency_item_id": item.currency_item_id,
                            "current_price": item.current_price,
                            "current_quantity": item.current_quantity,
                            "price_logs": price_logs,
                        })

                    if page >= resp.pages or not resp.items:
                        break
                    page += 1
        finally:
            self._league = old_league

        return result
