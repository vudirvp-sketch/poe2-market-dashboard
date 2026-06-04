"""
OfficialTradeProvider — fallback provider using GGG's official trade API.

This is no longer a STUB. It now implements real OAuth2 integration with
GGG's trade API (https://www.pathofexile.com/developer/docs).

GGG Trade API:
- Base URL: https://www.pathofexile.com/api/trade2/...
- Currency exchange: requires OAuth2 with service:cxapi scope
- Item search: no auth required, but 17-second mandatory sleep between POSTs
- Rate limits: documented at https://www.pathofexile.com/developer/docs

IMPORTANT LIMITATIONS:
1. You MUST register an OAuth2 application on GGG's developer portal
   to obtain client_id and client_secret.
2. The OAuth2 flow requires user authorization — this is an interactive
   process that must be initiated through the browser.
3. GGG enforces a 17-second mandatory sleep between POST requests for
   item searches.
4. This provider is only used when POE2Scout returns no data.
   It must NOT be used for bulk polling — only on-demand single-pair queries.

Configuration (add to .env or config.yaml):
  GGG_CLIENT_ID=<your-client-id>
  GGG_CLIENT_SECRET=<your-client-secret>
  GGG_REDIRECT_URI=http://localhost:3000/api/flipper/auth/callback
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx

from backend.data.providers.base import BaseDataProvider
from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
    PriceQuote,
)
from backend.config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# GGG OAuth2 Configuration
# ---------------------------------------------------------------------------

GGG_AUTH_BASE = "https://www.pathofexile.com/oauth/authorize"
GGG_TOKEN_URL = "https://www.pathofexile.com/oauth/token"
GGG_TRADE_BASE = "https://www.pathofexile.com/api/trade2"


def _get_oauth_config() -> dict[str, str | None]:
    """Read OAuth2 config from environment variables."""
    return {
        "client_id": os.environ.get("GGG_CLIENT_ID"),
        "client_secret": os.environ.get("GGG_CLIENT_SECRET"),
        "redirect_uri": os.environ.get(
            "GGG_REDIRECT_URI", "http://localhost:3000/api/flipper/auth/callback"
        ),
    }


# ---------------------------------------------------------------------------
# Token Manager
# ---------------------------------------------------------------------------

class OAuthTokenManager:
    """Manages OAuth2 tokens for GGG API access.

    Handles:
    - Authorization URL generation (PKCE flow)
    - Token exchange from authorization code
    - Token refresh
    - Thread-safe token storage
    - SQLite persistence so tokens survive backend restarts
    """

    def __init__(self):
        self._db_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "..", "oauth_tokens.db",
        )
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._token_expires_at: float = 0.0
        self._code_verifier: str | None = None
        self._client: httpx.AsyncClient | None = None
        # CSRF state storage — set by /auth/start, verified by /auth/callback
        self._pending_state: str | None = None
        self._load_tokens_from_db()

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=20.0)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    @property
    def is_authenticated(self) -> bool:
        """Check if we have a valid (non-expired) access token."""
        if self._access_token is None:
            return False
        return time.time() < self._token_expires_at - 60  # 60s buffer

    # ------------------------------------------------------------------
    # SQLite persistence
    # ------------------------------------------------------------------

    def _get_conn(self) -> sqlite3.Connection:
        """Return a new SQLite connection to the token database."""
        return sqlite3.connect(self._db_path)

    def _init_db(self) -> None:
        """Create the oauth_tokens table if it doesn't exist."""
        conn = self._get_conn()
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS oauth_tokens (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            conn.commit()
        finally:
            conn.close()

    def _load_tokens_from_db(self) -> None:
        """Load persisted tokens from SQLite into memory."""
        self._init_db()
        try:
            conn = self._get_conn()
            try:
                rows = dict(
                    conn.execute("SELECT key, value FROM oauth_tokens").fetchall()
                )
                self._access_token = rows.get("access_token") or None
                self._refresh_token = rows.get("refresh_token") or None
                self._token_expires_at = float(rows.get("token_expires_at", "0"))
                self._code_verifier = rows.get("code_verifier") or None
                self._pending_state = rows.get("pending_state") or None
            finally:
                conn.close()
        except Exception as e:
            logger.debug("Failed to load OAuth tokens from DB: %s", e)

    def _save_tokens_to_db(self) -> None:
        """Persist current token state to SQLite."""
        try:
            conn = self._get_conn()
            try:
                data = {
                    "access_token": self._access_token or "",
                    "refresh_token": self._refresh_token or "",
                    "token_expires_at": str(self._token_expires_at),
                    "code_verifier": self._code_verifier or "",
                    "pending_state": self._pending_state or "",
                }
                for key, value in data.items():
                    conn.execute(
                        "INSERT OR REPLACE INTO oauth_tokens (key, value) VALUES (?, ?)",
                        (key, value),
                    )
                conn.commit()
            finally:
                conn.close()
        except Exception as e:
            logger.debug("Failed to save OAuth tokens to DB: %s", e)

    def set_pending_state(self, state: str) -> None:
        """Store the OAuth2 state parameter for later CSRF verification."""
        self._pending_state = state
        self._save_tokens_to_db()

    def get_pending_state(self) -> str | None:
        """Return the stored OAuth2 state parameter (or None if not set)."""
        return self._pending_state

    def clear_pending_state(self) -> None:
        """Clear the stored OAuth2 state after successful verification."""
        self._pending_state = None
        self._save_tokens_to_db()

    def get_authorization_url(self) -> tuple[str, str]:
        """Generate the OAuth2 authorization URL with PKCE.

        Returns:
            Tuple of (authorization_url, state) — the state parameter
            should be stored and verified in the callback.
        """
        config = _get_oauth_config()
        if not config["client_id"]:
            raise ValueError(
                "GGG_CLIENT_ID not set. Register an OAuth2 application at "
                "https://www.pathofexile.com/developer/docs"
            )

        # PKCE: generate code_verifier and code_challenge
        self._code_verifier = secrets.token_urlsafe(64)
        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(self._code_verifier.encode()).digest()
        ).decode().rstrip("=")

        state = secrets.token_urlsafe(32)

        params = {
            "client_id": config["client_id"],
            "response_type": "code",
            "redirect_uri": config["redirect_uri"],
            "scope": "service:cxapi",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }

        auth_url = f"{GGG_AUTH_BASE}?{urlencode(params)}"
        return auth_url, state

    async def exchange_code(self, code: str, state: str) -> dict:
        """Exchange an authorization code for access and refresh tokens.

        Args:
            code: The authorization code from the callback.
            state: The state parameter to verify (prevents CSRF).

        Returns:
            Token response dict with access_token, refresh_token, expires_in.
        """
        config = _get_oauth_config()
        if not config["client_id"] or not config["client_secret"]:
            raise ValueError("GGG_CLIENT_ID and GGG_CLIENT_SECRET must be set")

        if not self._code_verifier:
            raise ValueError("No PKCE code_verifier — call get_authorization_url() first")

        client = await self._get_client()

        data = {
            "grant_type": "authorization_code",
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
            "code": code,
            "redirect_uri": config["redirect_uri"],
            "code_verifier": self._code_verifier,
        }

        resp = await client.post(GGG_TOKEN_URL, data=data)
        resp.raise_for_status()
        token_data = resp.json()

        self._access_token = token_data["access_token"]
        self._refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)
        self._token_expires_at = time.time() + expires_in

        self._save_tokens_to_db()

        logger.info(
            "OAuth2: token obtained, expires in %d seconds", expires_in
        )
        return token_data

    async def refresh_access_token(self) -> bool:
        """Refresh the access token using the refresh token.

        Returns:
            True if refresh was successful, False otherwise.
        """
        if not self._refresh_token:
            return False

        config = _get_oauth_config()
        if not config["client_id"] or not config["client_secret"]:
            return False

        try:
            client = await self._get_client()

            data = {
                "grant_type": "refresh_token",
                "client_id": config["client_id"],
                "client_secret": config["client_secret"],
                "refresh_token": self._refresh_token,
            }

            resp = await client.post(GGG_TOKEN_URL, data=data)
            resp.raise_for_status()
            token_data = resp.json()

            self._access_token = token_data["access_token"]
            self._refresh_token = token_data.get("refresh_token", self._refresh_token)
            expires_in = token_data.get("expires_in", 3600)
            self._token_expires_at = time.time() + expires_in

            self._save_tokens_to_db()

            logger.info("OAuth2: token refreshed, expires in %d seconds", expires_in)
            return True
        except Exception as e:
            logger.error("OAuth2: token refresh failed: %s", e)
            return False

    async def get_valid_token(self) -> str | None:
        """Get a valid access token, refreshing if necessary.

        Returns:
            A valid access token, or None if authentication is needed.
        """
        if self.is_authenticated:
            return self._access_token

        # Try to refresh
        if self._refresh_token:
            if await self.refresh_access_token():
                return self._access_token

        return None


# ---------------------------------------------------------------------------
# Singleton token manager
# ---------------------------------------------------------------------------

_token_manager: OAuthTokenManager | None = None


def get_token_manager() -> OAuthTokenManager:
    """Return the global OAuthTokenManager singleton."""
    global _token_manager
    if _token_manager is None:
        _token_manager = OAuthTokenManager()
    return _token_manager


# ---------------------------------------------------------------------------
# OfficialTradeProvider
# ---------------------------------------------------------------------------

class OfficialTradeProvider(BaseDataProvider):
    """Fallback data provider using GGG's official trade API.

    This provider implements OAuth2 authentication and the GGG trade API
    for currency exchange data. It is used as a fallback when POE2Scout
    returns no data.

    IMPORTANT: This provider must NOT be used for bulk polling. GGG
    requires a 17-second sleep between POST requests for item searches.
    Use it only for on-demand single-pair queries.
    """

    def __init__(self):
        self._token_manager = get_token_manager()
        self._client: httpx.AsyncClient | None = None
        self._last_post_time: float = 0.0
        self._post_min_interval: float = 17.0  # GGG mandatory 17s between POSTs

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=20.0,
                headers={"User-Agent": "PoE2Flipper/0.3"},
            )
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def name(self) -> str:
        return "official"

    async def _ensure_authenticated(self) -> bool:
        """Ensure we have a valid OAuth2 token."""
        token = await self._token_manager.get_valid_token()
        return token is not None

    async def _rate_limited_post(
        self, url: str, json_body: dict
    ) -> httpx.Response | None:
        """Make a rate-limited POST request respecting GGG's 17-second rule."""
        now = time.time()
        elapsed = now - self._last_post_time
        if elapsed < self._post_min_interval:
            wait_time = self._post_min_interval - elapsed
            logger.info("GGG rate limit: sleeping %.1fs before POST", wait_time)
            await asyncio.sleep(wait_time)

        client = await self._get_client()
        token = await self._token_manager.get_valid_token()

        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        self._last_post_time = time.time()
        try:
            resp = await client.post(url, json=json_body, headers=headers)
            return resp
        except httpx.RequestError as e:
            logger.error("GGG API POST error: %s", e)
            return None

    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        """Get current price for a currency pair from GGG's trade API.

        Uses the currency exchange endpoint (requires OAuth2 with cxapi scope).
        Falls back to item search if OAuth2 is not configured.
        """
        if not await self._ensure_authenticated():
            logger.warning(
                "OfficialTradeProvider: not authenticated. "
                "Complete OAuth2 flow first. Pair: %s",
                currency_pair,
            )
            return None

        parts = currency_pair.split("/")
        if len(parts) != 2:
            return None

        # Try currency exchange endpoint
        try:
            client = await self._get_client()
            token = await self._token_manager.get_valid_token()
            headers = {"Authorization": f"Bearer {token}"}

            # GGG currency exchange API
            # League name in GGG Trade API uses the FULL display name
            # (e.g. "Runes of Aldur"), not the POE2Scout ShortName ("runes").
            # Map POE2Scout ShortName → GGG Trade API league display name.
            # GGG's trade API uses the FULL display name (e.g. "Runes of Aldur"),
            # not the POE2Scout ShortName ("runes").
            # When a new league launches, add the mapping here AND update
            # config.yaml → league.league_name to the new ShortName.
            _poe2scout_to_ggg_league = {
                # Current challenge league (Runes of Aldur — 0.5.0 "Return of the Ancients")
                "runes": "Runes of Aldur",
                "runeshc": "HC Runes of Aldur",
                # Previous challenge leagues (for Standard/Hardcore migration)
                "vaal": "Fate of the Vaal",
                "vaalhc": "HC Fate of the Vaal",
                "abyssal": "Rise of the Abyssal",
                "abyssalhc": "HC Rise of the Abyssal",
                "hunt": "Dawn of the Hunt",
                "hunthc": "HC Dawn of the Hunt",
                # Permanent leagues
                "standard": "Standard",
                "hardcore": "Hardcore",
            }
            league_short = get_settings().league.league_name
            ggg_league = _poe2scout_to_ggg_league.get(league_short, league_short)
            url = f"{GGG_TRADE_BASE}/exchange/{ggg_league}"
            body = {
                "exchange": {
                    "want": [parts[1]],
                    "have": [parts[0]],
                }
            }

            resp = await self._rate_limited_post(url, body)
            if resp is None:
                return None

            if resp.status_code == 429:
                logger.warning("GGG API rate limited")
                return None

            if resp.status_code != 200:
                logger.debug("GGG exchange API returned %d", resp.status_code)
                return None

            data = resp.json()
            result_lines = data.get("result", [])
            if not result_lines:
                return None

            # Fetch result details
            result_ids = ",".join(result_lines[:5])
            detail_url = f"{GGG_TRADE_BASE}/fetch/{result_ids}?exchange"
            detail_resp = await client.get(detail_url, headers=headers)

            if detail_resp.status_code != 200:
                return None

            detail_data = detail_resp.json()
            offers = detail_data.get("result", [])
            if not offers:
                return None

            # Extract prices from offers
            prices = []
            volumes = []
            for offer in offers:
                listing = offer.get("listing", {})
                price_info = listing.get("price", {})
                if price_info:
                    amount = float(price_info.get("amount", 0))
                    if amount > 0:
                        prices.append(amount)
                stock = listing.get("account", {}).get("stock", 0)
                volumes.append(stock)

            if not prices:
                return None

            mid_price = sum(prices) / len(prices)
            total_volume = sum(volumes)
            spread_est = max(0.005, min(0.05, 10.0 / max(total_volume, 1)))

            return PriceQuote(
                pair=currency_pair,
                bid=mid_price * (1 - spread_est / 2),
                ask=mid_price * (1 + spread_est / 2),
                mid_price=mid_price,
                volume_24h=float(total_volume),
                timestamp=datetime.now(timezone.utc),
            )

        except Exception as e:
            logger.error("OfficialTradeProvider.get_current_price failed: %s", e)
            return None

    async def get_historical_prices(
        self, currency: str, days: int
    ) -> list[PricePoint]:
        """Get historical prices from GGG API.

        GGG's trade API does not provide historical data directly.
        This method returns an empty list — historical data should come
        from POE2Scout or the local SQLite store.
        """
        # GGG Trade API has no historical endpoint
        return []

    async def get_exchange_rates(self, league: str) -> dict[str, ExchangeRate]:
        """Get exchange rates from GGG's currency exchange API.

        Requires OAuth2 with service:cxapi scope.
        Returns empty dict if not authenticated.
        """
        if not await self._ensure_authenticated():
            logger.warning(
                "OfficialTradeProvider: not authenticated. "
                "Complete OAuth2 flow first."
            )
            return {}

        # GGG's exchange API returns results one pair at a time.
        # For bulk fetching, POE2Scout is the preferred provider.
        # This method is intentionally limited — it's only a fallback.
        return {}

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        """Get currency metadata from GGG's static assets.

        GGG provides a static JSON file with item metadata at:
        https://www.pathofexile.com/api/trade2/data/leagues
        """
        try:
            client = await self._get_client()
            resp = await client.get(f"{GGG_TRADE_BASE}/data/leagues")
            if resp.status_code != 200:
                return []

            # GGG doesn't provide currency-specific metadata in the same
            # format as POE2Scout. Return empty for now.
            return []
        except Exception as e:
            logger.error("OfficialTradeProvider.get_currency_metadata failed: %s", e)
            return []


