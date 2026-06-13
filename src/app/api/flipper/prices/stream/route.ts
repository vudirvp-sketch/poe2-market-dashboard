import { NextRequest } from "next/server";

/**
 * SSE proxy: /api/flipper/prices/stream → FastAPI GET /api/v1/prices/stream
 *
 * Proxies Server-Sent Events from the FastAPI backend to the browser.
 * This route streams the response body directly (no buffering) to
 * preserve the real-time nature of SSE.
 *
 * NOTE: The SSE backend endpoint (routes_sse.py) may not be available
 * if the module is not implemented yet. In that case, this route
 * returns a graceful error event instead of crashing.
 *
 * NOTE: Next.js App Router route handlers support streaming responses
 * natively. We fetch the SSE stream from the backend and forward it
 * chunk-by-chunk to the client.
 */

export const dynamic = "force-dynamic";

const FLIPPER_API_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const thresholdPct = searchParams.get("threshold_pct") || "0.5";

  // Fixed: was /api/prices/stream (missing /v1/ prefix from Phase 4.2)
  const backendUrl = `${FLIPPER_API_URL}/api/v1/prices/stream?threshold_pct=${thresholdPct}`;

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(300_000), // 5 min timeout
    });

    if (!backendResponse.ok) {
      // SSE backend not available — return a graceful error event
      // instead of propagating the error status, so the frontend
      // can handle it as "no live updates" rather than a crash.
      return new Response(
        `event: error\ndata: ${JSON.stringify({ message: `Backend SSE returned ${backendResponse.status}`, unavailable: true })}\n\n`,
        {
          status: 200, // Return 200 so the browser doesn't log console errors
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        }
      );
    }

    // Stream the SSE response from backend to client
    const body = backendResponse.body;
    if (!body) {
      return new Response(
        `event: error\ndata: ${JSON.stringify({ message: "No response body from backend", unavailable: true })}\n\n`,
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        }
      );
    }

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    // Return 200 with error event instead of 503 to avoid console spam
    // and React Query retry storms. The frontend handles SSE errors
    // by falling back to polling.
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: `Backend unreachable: ${message}`, unavailable: true })}\n\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      }
    );
  }
}
