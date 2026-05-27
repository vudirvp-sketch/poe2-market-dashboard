import { NextResponse } from "next/server";
import { getRealms } from "@/lib/poe2api";

export async function GET() {
  try {
    const realms = await getRealms();
    return NextResponse.json(realms);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
