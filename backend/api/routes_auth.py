"""
API routes for OAuth2 authentication with GGG's trade API.

Endpoints:
    GET /api/auth/start     — initiates OAuth2 authorization flow
    GET /api/auth/callback  — handles OAuth2 callback, exchanges code for tokens
    GET /api/auth/status    — returns current authentication status
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from backend.data.providers.official import get_token_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/start")
async def start_oauth2():
    """Initiate the OAuth2 authorization flow with GGG.

    Returns a JSON object containing the authorization URL and a state
    parameter. The caller (Next.js proxy) is responsible for:
      1. Storing the state in an httpOnly cookie for CSRF verification
      2. Redirecting the user to auth_url

    Required environment variables:
        GGG_CLIENT_ID — OAuth2 client ID from GGG developer portal
        GGG_CLIENT_SECRET — OAuth2 client secret from GGG developer portal
    """
    manager = get_token_manager()

    try:
        auth_url, state = manager.get_authorization_url()
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail=str(e),
        )

    # Store state internally so we can verify it in the callback.
    # The Next.js proxy layer also stores state in a cookie for
    # defense-in-depth CSRF protection.
    manager.set_pending_state(state)

    logger.info("OAuth2: generated authorization URL with state=%s…", state[:8])

    # Return JSON instead of RedirectResponse so the Next.js proxy
    # can set the state cookie before redirecting the browser.
    return {
        "auth_url": auth_url,
        "state": state,
    }


@router.get("/callback")
async def oauth2_callback(
    code: str = Query(..., description="Authorization code from GGG"),
    state: str = Query(..., description="State parameter for CSRF verification"),
):
    """Handle the OAuth2 callback from GGG.

    Exchanges the authorization code for access and refresh tokens.
    Verifies the state parameter against the pending state stored
    during /auth/start (defense-in-depth CSRF check).

    Args:
        code: Authorization code from GGG
        state: State parameter (should match the one from /auth/start)
    """
    manager = get_token_manager()

    # Verify state against the one we stored at /auth/start
    pending_state = manager.get_pending_state()
    if pending_state is not None and state != pending_state:
        logger.warning(
            "OAuth2: state mismatch! Expected %s…, got %s…",
            pending_state[:8] if pending_state else "None",
            state[:8],
        )
        raise HTTPException(
            status_code=403,
            detail="OAuth2 state verification failed — possible CSRF attack",
        )

    try:
        token_data = await manager.exchange_code(code, state)
        # Clear the pending state after successful exchange
        manager.clear_pending_state()
        return {
            "message": "Authentication successful",
            "expires_in": token_data.get("expires_in"),
            "token_type": token_data.get("token_type", "Bearer"),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("OAuth2: token exchange failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail=f"Token exchange failed: {e}",
        )


@router.get("/status")
async def auth_status():
    """Return current authentication status for the GGG API."""
    manager = get_token_manager()

    config = {}
    from backend.data.providers.official import _get_oauth_config
    oauth_config = _get_oauth_config()
    config["client_id_configured"] = oauth_config["client_id"] is not None
    config["client_secret_configured"] = oauth_config["client_secret"] is not None

    return {
        "authenticated": manager.is_authenticated,
        "has_refresh_token": manager._refresh_token is not None,
        "oauth_config": config,
    }
