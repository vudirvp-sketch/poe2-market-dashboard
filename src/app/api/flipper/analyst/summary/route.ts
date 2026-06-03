import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxyToFlipper("/api/analyst/summary");
}
