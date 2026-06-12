import { NextRequest } from "next/server";

/**
 * SSE proxy: /api/flipper/prices/stream → FastAPI GET /api/prices/stream
 *
 * Proxies Server-Sent Events from the FastAPI backend to the browser.
 * This route streams the response body directly (no buffering) to
 * preserve the real-time nature of SSE.
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

  const backendUrl = `${FLIPPER_API_URL}/api/prices/stream?threshold_pct=${thresholdPct}`;

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
      return new Response(
        `event: error\ndata: ${JSON.stringify({ message: `Backend returned ${backendResponse.status}` })}\n\n`,
        {
          status: backendResponse.status,
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
        `event: error\ndata: ${JSON.stringify({ message: "No response body from backend" })}\n\n`,
        {
          status: 502,
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
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: `Backend unreachable: ${message}` })}\n\n`,
      {
        status: 503,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      }
    );
  }
}
