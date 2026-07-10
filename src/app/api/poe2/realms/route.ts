import { NextResponse } from "next/server";
import { getRealms } from "@/lib/poe2api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const realms = await getRealms();
    return NextResponse.json(realms);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    // getRealms() returns fallback data on its own errors, so this catch
    // is only for truly unexpected errors.
    return NextResponse.json(
      {
        error: message,
        error_type: "upstream_error",
        hint: `The poe2scout.com API is unreachable. The dashboard will use fallback data for realms and leagues. Try: 1) Set POE2_API_BASE_URL=${process.env.POE2_API_BASE_URL || "https://poe2scout.com/api"} in .env.local, 2) Use a VPN, 3) Check your internet connection`,
      },
      { status: 502 }
    );
  }
}
