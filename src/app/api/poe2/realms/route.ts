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
    const status = message.includes("timed out") ? 504 : 502;
    return NextResponse.json(
      { error: message, hint: message.includes("unreachable") ? "Try using a VPN to access poe2scout.com" : undefined },
      { status }
    );
  }
}
