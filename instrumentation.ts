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
 * NOTE (iter 106, KI-16-deep fix): the bridge module no longer contains any
 * filesystem or path-module operations — they were removed entirely so
 * Turbopack's Node File Trace (NFT) no longer flags the instrumentation
 * import graph. The bridge uses only `child_process` (spawn/execSync/spawnSync)
 * and `process.cwd()`. File logging was removed (console only — Next.js
 * captures it in the server log). See KI-16-deep in STATUS.md for history.
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
