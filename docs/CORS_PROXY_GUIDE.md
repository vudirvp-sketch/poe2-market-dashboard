# PoE2 Market Dashboard — CORS Proxy & Resilience Guide

> **Version:** 1.0 | **Date:** 2026-06-08

---

## 1. The Problem

The POE2Scout API (`api.poe2scout.com`) is **blocked from Russian IPs**. Direct requests from servers in Russia result in `ECONNRESET` or `ETIMEDOUT` errors. The dashboard includes multiple resilience mechanisms to handle this and other connectivity issues.

## 2. Frontend Resilience (poe2api.ts)

**Location:** `src/lib/poe2api.ts`

The frontend uses a layered fallback strategy for all POE2Scout API calls:

```
1. Direct API call → api.poe2scout.com/api/...
   ↓ on ECONNRESET / ETIMEDOUT / network error
2. CORS proxy retry → {POE2_CORS_PROXY_URL}/api/...
   ↓ on failure
3. Stale-while-revalidate cache → serve cached response (up to 30 min old)
   ↓ on empty cache
4. Pre-populated cache → cache-snapshot.json (bundled with app)
```

### Circuit Breaker

- **Threshold:** 3 consecutive failures
- **Open duration:** 30 seconds
- **Behavior:** When open, all requests immediately fail with cached/fallback data (no API calls attempted)
- **Reset:** After 30s, allows one request through (half-open). If it succeeds, circuit closes.

### Stale-While-Revalidate Cache

- In-memory `Map<string, { data, timestamp }>`
- TTL: 30 minutes
- On cache hit but expired: serve stale data immediately, trigger background revalidation
- On cache miss: attempt API call, cache result on success

### Cache Pre-populator

**Location:** `src/lib/cache-prepopulator.ts`

On startup, reads `src/data/cache-snapshot.json` and seeds the in-memory cache. This ensures the dashboard has data on first load even when the API is completely unreachable.

**Regeneration:** `npx tsx scripts/generate-cache-snapshot.ts` — fetches fresh data from POE2Scout API for the current league. Must be run when API is accessible.

## 3. Backend Resilience

**Location:** `backend/data/providers/poe2scout.py`

The backend uses a simpler fallback chain:

```
1. Direct API call → https://api.poe2scout.com/api/...
   ↓ on connection error
2. CORS proxy → {cors_proxy_url}/api/...
   ↓ on failure
3. Cached/stale data from SnapshotManager
```

### Backend CORS Proxy Configuration

In `config.yaml`:
```yaml
data:
  cors_proxy_url: ""                        # Set to your Cloudflare Worker URL
  cors_proxy_fallback_enabled: true          # Auto-retry through proxy on failure
```

Or via environment variable (takes precedence):
```bash
export POE2SCOUT_CORS_PROXY_URL="https://poe2scout-proxy.your-account.workers.dev/api"
```

## 4. Cloudflare Worker Setup

**Location:** `cloudflare-worker/`

A ready-to-deploy Cloudflare Worker that proxies requests to the POE2Scout API through Cloudflare's edge network.

### Deployment (5 minutes, free)

```bash
# 1. Register at https://dash.cloudflare.com/sign-up (free, email only)

# 2. Install Wrangler CLI
npm install -g wrangler

# 3. Navigate to worker directory
cd cloudflare-worker

# 4. Login to Cloudflare
wrangler login

# 5. Deploy
wrangler deploy
# Output: https://poe2scout-proxy.your-account.workers.dev
```

### Configure Dashboard

Add to `.env.local` (frontend):
```bash
POE2_CORS_PROXY_URL=https://poe2scout-proxy.your-account.workers.dev/api
```

Or set in `config.yaml` (backend):
```yaml
data:
  cors_proxy_url: "https://poe2scout-proxy.your-account.workers.dev/api"
```

Or via environment variable (backend):
```bash
export POE2SCOUT_CORS_PROXY_URL="https://poe2scout-proxy.your-account.workers.dev/api"
```

### Free Tier Limits

- 100,000 requests/day (sufficient for personal use)
- 10ms CPU time per request
- 1MB script size
- Up to 10 Workers

### How It Works

The worker simply proxies requests:
```
Client → worker.dev/api/Leagues?realm=poe2 → api.poe2scout.com/api/Leagues?realm=poe2
```

No transformation, no caching — just routing through Cloudflare's edge to bypass regional blocking.

## 5. Alternative: Set POE2_API_BASE_URL Directly

If you deploy the worker, you can also route ALL API traffic through Cloudflare (not just fallback):

```bash
# .env.local — ALL requests go through the proxy
POE2_API_BASE_URL=https://poe2scout-proxy.your-account.workers.dev/api
```

When set, `poe2api.ts` uses this URL as the primary base URL instead of `api.poe2scout.com`. No fallback chain needed.

## 6. Alternative: VPN

The simplest option. Connect a VPN on the server and restart the dashboard. No code changes needed.

## 7. Environment Variables Reference

| Variable | Where | Purpose |
|----------|-------|---------|
| `POE2_CORS_PROXY_URL` | Frontend (.env.local) | CORS proxy URL for frontend fallback |
| `POE2_API_BASE_URL` | Frontend (.env.local) | Override primary API base URL (routes all traffic through proxy) |
| `POE2SCOUT_CORS_PROXY_URL` | Backend (env) | CORS proxy URL for backend fallback (takes precedence over config.yaml) |
| `CORS_ORIGINS` | Backend (env) | Comma-separated allowed CORS origins (default: `http://localhost:3000`) |

## 8. Testing Resilience

### Frontend Test

**Location:** `src/__tests__/cors-proxy-fallback.test.ts`

Tests that the CORS proxy fallback mechanism works correctly:
- Direct API call succeeds → no proxy used
- Direct call fails → proxy retry attempted
- Both fail → cached/stale data served

### E2E Test

**Location:** `e2e/cors-proxy-snapshot.spec.ts`

End-to-end test verifying the dashboard works with pre-populated cache data when API is unreachable.

### Backend Test

**Location:** `tests/test_pipeline_cache_degraded.py`

Tests backend behavior in degraded mode when provider is unreachable.
