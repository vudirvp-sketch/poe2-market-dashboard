import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/events → proxies to FastAPI GET /api/events */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyToFlipper("/api/events", searchParams);
}

/** POST /api/flipper/events → proxies to FastAPI POST /api/events */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return proxyToFlipper("/api/events", undefined, "POST", body);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
}
