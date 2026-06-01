import { proxyWithFallback } from '@/lib/flipper-proxy';

export async function GET() {
  return proxyWithFallback('/api/tiers', {
    offlineFallback: {
      tiers: [],
      boundaries: { t0Min: 50, t1Min: 10, t2Min: 1, t3Min: 0.1, t4Min: 0.01 },
      dataAvailable: false,
    },
    insufficientDataFallback: {
      tiers: [],
      boundaries: { t0Min: 50, t1Min: 10, t2Min: 1, t3Min: 0.1, t4Min: 0.01 },
      dataAvailable: false,
    },
  });
}
