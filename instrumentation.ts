/**
 * Next.js Instrumentation Hook — runs once when the Next.js server starts.
 *
 * This file starts the Flipper Python backend as a managed child process
 * via the flipper-backend-bridge module. The bridge:
 * - Auto-detects and uses .venv Python if available
 * - Monitors backend health via /api/health
 * - Auto-restarts on crash (up to 5 times in 60s)
 * - Cleans up on Next.js shutdown
 *
 * The backend runs on port 8000 (same as before) but is now managed
 * by the Next.js process instead of start.bat/start.sh.
 *
 * To disable the bridge (e.g., when running backend manually):
 *   Set FLIPPER_BRIDGE_DISABLED=true in .env.local
 *
 * To start backend manually:
 *   PYTHONPATH=. .venv/bin/python -m uvicorn backend.main:app --port 8000
 *
 * NOTE (iter 105, KI-16 long-term fix): the bridge module was moved from
 * scripts/flipper-backend-bridge.ts to src/lib/flipper-backend-bridge.ts
 * so Turbopack bundles it as a regular src module. This permanently
 * eliminates the cosmetic NFT warning that earlier iterations tried to
 * silence with a turbopackIgnore magic comment (which broke the runtime
 * bundle — see KI-16/KI-17 history in STATUS.md).
 */

export async function register() {
  // Only run on the server (not during build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { startBackendBridge } = await import(
        "./src/lib/flipper-backend-bridge"
      );
      startBackendBridge();
    } catch (err) {
      // Bridge is optional — if it fails, dashboard still works
      // (flipper features will be unavailable but other tabs work fine)
      console.warn(
        "[instrumentation] Flipper backend bridge failed to start:",
        err instanceof Error ? err.message : String(err)
      );
      console.warn(
        "[instrumentation] Dashboard will work without analytics. " +
        "To start backend manually: PYTHONPATH=. python -m uvicorn backend.main:app --port 8000"
      );
    }
  }
}
