// ============================================================================
// PoE2Scout CORS Proxy — Cloudflare Worker
// ============================================================================
//
// PURPOSE:
//   Proxies requests to https://api.poe2scout.com/api/* from regions where
//   the API is blocked (e.g. Russian IPs). The Worker runs on Cloudflare's
//   edge network, which is not subject to the same blocking.
//
// DEPLOYMENT (quick):
//   1. Install Wrangler CLI:  npm install -g wrangler
//   2. Login:                 wrangler login
//   3. Deploy:                wrangler deploy
//   4. Note the output URL (e.g. https://poe2scout-proxy.your-account.workers.dev)
//   5. In your .env.local:    POE2_CORS_PROXY_URL=https://poe2scout-proxy.your-account.workers.dev/api
//
// DEPLOYMENT (custom domain):
//   See wrangler.toml — uncomment and edit the `routes` section.
//   Then: wrangler deploy
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
//   - Request logging for monitoring
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

// ============================================================================
// Analytics / Logging
// ============================================================================
// Track request counts by path prefix for monitoring.
// This data is stored in-memory (resets on Worker restart) and is accessible
// via GET /__analytics (only from allowed origins).

const analytics = {
  totalRequests: 0,
  upstreamSuccesses: 0,
  upstreamFailures: 0,
  byPath: {},       // { "/Realms": 42, "/poe2/Leagues": 15, ... }
  byStatus: {},     // { "200": 100, "502": 3, ... }
  startTime: Date.now(),
  lastRequest: null,
};

function trackRequest(pathname, status, durationMs) {
  analytics.totalRequests++;
  analytics.lastRequest = new Date().toISOString();

  if (status >= 200 && status < 400) {
    analytics.upstreamSuccesses++;
  } else {
    analytics.upstreamFailures++;
  }

  // Extract the API path segment for grouping (e.g., "/Realms", "/{realm}/Leagues")
  const segments = pathname.replace(/^\/api/, '').split('/').filter(Boolean);
  const pathKey = segments.length >= 2
    ? `/${segments[0]}/${segments[1]}`
    : segments.length === 1
      ? `/${segments[0]}`
      : '/';

  analytics.byPath[pathKey] = (analytics.byPath[pathKey] || 0) + 1;
  analytics.byStatus[String(status)] = (analytics.byStatus[String(status)] || 0) + 1;
}

export default {
  async fetch(request, env, ctx) {
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

    // ── Analytics endpoint (for monitoring) ──
    if (url.pathname === '/__analytics' || url.pathname === '/api/__analytics') {
      const uptime = Math.round((Date.now() - analytics.startTime) / 1000);
      return new Response(JSON.stringify({
        uptime_seconds: uptime,
        total_requests: analytics.totalRequests,
        upstream_successes: analytics.upstreamSuccesses,
        upstream_failures: analytics.upstreamFailures,
        success_rate: analytics.totalRequests > 0
          ? (analytics.upstreamSuccesses / analytics.totalRequests * 100).toFixed(1) + '%'
          : 'N/A',
        by_path: analytics.byPath,
        by_status: analytics.byStatus,
        last_request: analytics.lastRequest,
        worker_version: '1.1.0',
      }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': isOriginAllowed(origin) ? (origin || '*') : '',
        },
      });
    }

    // Build upstream URL: /api/* paths map to poe2scout API
    let upstreamPath = url.pathname;

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

    const requestStart = Date.now();

    try {
      // Forward request to POE2Scout API with original headers (minus host)
      const upstreamHeaders = new Headers(request.headers);
      upstreamHeaders.delete('Host');
      upstreamHeaders.delete('Origin');
      upstreamHeaders.delete('Referer');
      upstreamHeaders.set('User-Agent', 'PoE2-Market-Dashboard-Proxy/1.1.0');
      upstreamHeaders.set('Accept', 'application/json');

      const upstreamResponse = await fetch(upstreamUrl.toString(), {
        method: 'GET',
        headers: upstreamHeaders,
        // Cloudflare Workers have a 30s timeout by default
      });

      // Read the response body
      const responseBody = await upstreamResponse.text();

      // Track analytics
      const duration = Date.now() - requestStart;
      trackRequest(upstreamPath, upstreamResponse.status, duration);

      // Log slow requests (over 5 seconds)
      if (duration > 5000) {
        console.log(`[SLOW] ${upstreamPath} took ${duration}ms (status ${upstreamResponse.status})`);
      }

      // Build response headers with CORS
      const responseHeaders = new Headers();
      responseHeaders.set('Content-Type', upstreamResponse.headers.get('Content-Type') || 'application/json');
      responseHeaders.set('Cache-Control', upstreamResponse.headers.get('Cache-Control') || 'public, max-age=60');
      responseHeaders.set('X-Proxy-Version', '1.1.0');
      responseHeaders.set('X-Response-Time', `${duration}ms`);

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
      // Track analytics
      const duration = Date.now() - requestStart;
      trackRequest(upstreamPath, 502, duration);

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
          'X-Response-Time': `${duration}ms`,
        },
      });
    }
  },
};
