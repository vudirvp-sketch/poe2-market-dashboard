// ============================================================================
// PoE2Scout CORS Proxy — Cloudflare Worker
// ============================================================================
//
// PURPOSE:
//   Proxies requests to https://api.poe2scout.com/api/* from regions where
//   the API is blocked (e.g. Russian IPs). The Worker runs on Cloudflare's
//   edge network, which is not subject to the same blocking.
//
// DEPLOYMENT:
//   1. Install Wrangler CLI:  npm install -g wrangler
//   2. Login:                 wrangler login
//   3. Deploy:                wrangler deploy
//   4. Note the output URL (e.g. https://poe2scout-proxy.your-account.workers.dev)
//   5. In your .env.local:    POE2_API_BASE_URL=https://poe2scout-proxy.your-account.workers.dev/api
//
// RATE LIMITS (Free Tier):
//   - 100,000 requests/day
//   - 10ms CPU time per request
//   - Up to 10 Workers
//
// SECURITY:
//   - Only proxies to api.poe2scout.com (no open proxy)
//   - Passes through all query parameters
//   - Preserves original response status codes and headers
//   - Adds CORS headers for browser compatibility
// ============================================================================

const UPSTREAM_BASE = 'https://api.poe2scout.com/api';

// Allowed origin patterns for CORS (adjust to your deployment domain)
const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/.*\.chatglm\.site$/,           // z.ai preview domains
  /^https:\/\/.*\.vercel\.app$/,             // Vercel deployments
  /^https:\/\/poe2scout\.com$/,              // poe2scout itself
  /^https?:\/\/.*\.local(:\d+)?$/,           // local network
];

function isOriginAllowed(origin) {
  if (!origin) return true; // Non-browser requests don't have origin
  return ALLOWED_ORIGINS.some(pattern => pattern.test(origin));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // Handle CORS preflight (OPTIONS) requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': isOriginAllowed(origin) ? origin : '',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept, User-Agent',
          'Access-Control-Max-Age': '86400', // Cache preflight for 24h
        },
      });
    }

    // Build upstream URL: /api/* paths map to poe2scout API
    // The worker serves at https://worker.dev/api/... so the path already
    // includes /api. We strip the /api prefix and forward the rest.
    let upstreamPath = url.pathname;

    // If the worker is deployed at /, the path is /api/Realms, /api/poe2/Leagues, etc.
    // We need to forward the full path to the upstream (which already has /api base).
    // So we just pass the path as-is to the upstream.
    const upstreamUrl = new URL(upstreamPath + url.search, UPSTREAM_BASE);

    // Only allow GET requests (the POE2Scout API is read-only)
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Security check: ensure the constructed URL is still under poe2scout.com
    if (upstreamUrl.hostname !== 'api.poe2scout.com') {
      return new Response(JSON.stringify({ error: 'Forbidden: upstream host mismatch' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Forward request to POE2Scout API with original headers (minus host)
      const upstreamHeaders = new Headers(request.headers);
      upstreamHeaders.delete('Host');
      upstreamHeaders.delete('Origin');
      upstreamHeaders.delete('Referer');
      upstreamHeaders.set('User-Agent', 'PoE2-Market-Dashboard-Proxy/1.0');
      upstreamHeaders.set('Accept', 'application/json');

      const upstreamResponse = await fetch(upstreamUrl.toString(), {
        method: 'GET',
        headers: upstreamHeaders,
        // Cloudflare Workers have a 30s timeout by default
      });

      // Read the response body
      const responseBody = await upstreamResponse.text();

      // Build response headers with CORS
      const responseHeaders = new Headers();
      responseHeaders.set('Content-Type', upstreamResponse.headers.get('Content-Type') || 'application/json');
      responseHeaders.set('Cache-Control', upstreamResponse.headers.get('Cache-Control') || 'public, max-age=60');
      responseHeaders.set('X-Proxy-Version', '1.0.0');

      // Add CORS headers if origin is allowed
      if (isOriginAllowed(origin)) {
        responseHeaders.set('Access-Control-Allow-Origin', origin);
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Accept, User-Agent');
      }

      return new Response(responseBody, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      // Upstream fetch failed (network error, timeout, etc.)
      return new Response(JSON.stringify({
        error: 'Upstream fetch failed',
        detail: err.message || 'Unknown error',
        upstream: upstreamUrl.toString(),
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': isOriginAllowed(origin) ? (origin || '*') : '',
        },
      });
    }
  },
};
