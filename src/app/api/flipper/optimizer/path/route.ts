import { NextRequest, NextResponse } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const fromCurrency = searchParams.get("from_currency") || "";
  const toCurrency = searchParams.get("to_currency") || "";

  if (!fromCurrency || !toCurrency) {
    return NextResponse.json(
      { error: "Missing required parameters: from_currency and to_currency", error_type: "insufficient_data" },
      { status: 400 }
    );
  }

  const amount = searchParams.get("amount") || "1";
  const maxHops = searchParams.get("max_hops") || "5";

  const params = new URLSearchParams();
  params.set("from_currency", fromCurrency);
  params.set("to_currency", toCurrency);
  params.set("amount", amount);
  params.set("max_hops", maxHops);

  return proxyToFlipper("/api/v1/optimizer/path", params);
}
