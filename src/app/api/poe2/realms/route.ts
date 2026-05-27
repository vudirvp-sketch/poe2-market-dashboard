import { NextResponse } from "next/server";
import { getRealms, getHealth } from "@/lib/poe2api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const realms = await getRealms();
    return NextResponse.json(realms);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("timed out") ? 504 : 502;

    // Check if API is reachable at all
    let apiStatus = "unknown";
    try {
      const health = await getHealth();
      apiStatus = health.status;
    } catch {
      apiStatus = "unreachable";
    }

    return NextResponse.json(
      {
        error: message,
        apiStatus,
        hint: message.includes("unreachable") || message.includes("Cannot reach")
          ? "The poe2scout.com API is unreachable from your server. Try: 1) Set POE2_API_BASE_URL=https://api.poe2scout.com/api in .env.local, 2) Use a VPN, 3) Check your internet connection"
          : message.includes("403")
          ? "Your IP may be blocked. Try using a VPN or set POE2_API_BASE_URL=https://api.poe2scout.com/api in .env.local"
          : undefined,
      },
      { status }
    );
  }
}
