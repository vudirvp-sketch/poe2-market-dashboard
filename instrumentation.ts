/**
 * Next.js Instrumentation Hook — runs once when the Next.js server starts.
 *
 * This file starts the Flipper Python backend as a managed child process
 * via the flipper-backend-bridge script. The bridge:
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
 */

export async function register() {
  // Only run on the server (not during build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      // KI-12 (iter 102): the `/* turbopackIgnore: true */` magic comment
      // tells Turbopack's Node File Trace (NFT) to NOT bundle this dynamic
      // import into the serverless build output. Previously, the import
      // chain instrumentation.ts -> scripts/flipper-backend-bridge.ts caused
      // Turbopack to emit a "Encountered unexpected file in NFT list" warning
      // during `next build`. The bridge file is only needed when running
      // `next start` / `next dev` (where it lives on disk), so excluding it
      // from the serverless bundle is safe — serverless deployments would
      // need to run the Python backend as a separate service anyway.
      const { startBackendBridge } = await import(
        /* turbopackIgnore: true */ "./scripts/flipper-backend-bridge"
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
