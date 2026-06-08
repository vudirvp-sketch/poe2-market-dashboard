/**
 * Flipper Backend Bridge — manages the Python FastAPI backend lifecycle.
 *
 * This script is used by the Next.js instrumentation hook to start the
 * Python uvicorn process as a child_process, monitor its health, and
 * automatically restart it if it crashes.
 *
 * Usage (from instrumentation.ts):
 *   import { startBackendBridge } from "../scripts/flipper-backend-bridge";
 *   startBackendBridge();
 *
 * Environment variables:
 *   FLIPPER_API_URL  — backend URL (default: http://localhost:8000)
 *   FLIPPER_BRIDGE_DISABLED — set to "true" to skip bridge startup
 *   PYTHON_CMD       — Python command (default: auto-detect .venv)
 */

import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const BACKEND_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";
const HEALTH_ENDPOINT = `${BACKEND_URL}/api/health`;
const HEALTH_CHECK_INTERVAL = 30_000; // 30s
const RESTART_DELAY = 5_000; // 5s
const MAX_RESTARTS = 5;
const MAX_RESTART_WINDOW = 60_000; // 1 minute — if >MAX_RESTARTS restarts in this window, give up

let backendProcess: ChildProcess | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let restartCount = 0;
let restartWindowStart = Date.now();
let isShuttingDown = false;

/**
 * Detect the Python command to use.
 * Prefers .venv Python if available.
 */
function detectPythonCommand(): string {
  const projectRoot = join(__dirname, "..");

  // Windows: check .venv\Scripts\python.exe
  const winVenvPython = join(projectRoot, ".venv", "Scripts", "python.exe");
  if (existsSync(winVenvPython)) {
    console.log(`[flipper-bridge] Using venv Python: ${winVenvPython}`);
    return winVenvPython;
  }

  // Unix: check .venv/bin/python
  const unixVenvPython = join(projectRoot, ".venv", "bin", "python");
  if (existsSync(unixVenvPython)) {
    console.log(`[flipper-bridge] Using venv Python: ${unixVenvPython}`);
    return unixVenvPython;
  }

  // Fallback: system python
  console.log("[flipper-bridge] No .venv found, using system python");
  return "python";
}

/**
 * Detect if uvicorn is available.
 */
function getUvicornArgs(): string[] {
  const projectRoot = join(__dirname, "..");

  // Check if .venv has uvicorn directly
  const winUvicorn = join(projectRoot, ".venv", "Scripts", "uvicorn.exe");
  if (existsSync(winUvicorn)) {
    // Use uvicorn directly — faster than python -m uvicorn
    return [];
  }

  const unixUvicorn = join(projectRoot, ".venv", "bin", "uvicorn");
  if (existsSync(unixUvicorn)) {
    return [];
  }

  // Will use python -m uvicorn
  return ["-m", "uvicorn"];
}

/**
 * Start the Python backend process.
 */
function startBackendProcess(): ChildProcess | null {
  if (isShuttingDown) return null;

  const projectRoot = join(__dirname, "..");
  const pythonCmd = detectPythonCommand();
  const uvicornArgs = getUvicornArgs();

  const args = [
    ...uvicornArgs,
    "backend.main:app",
    "--host", "0.0.0.0",
    "--port", "8000",
  ];

  console.log(`[flipper-bridge] Starting backend: ${pythonCmd} ${args.join(" ")}`);

  const env = {
    ...process.env,
    PYTHONPATH: projectRoot,
  };

  const child = spawn(pythonCmd, args, {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  // Log stdout
  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.log(`[flipper-backend] ${line}`);
    }
  });

  // Log stderr
  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.error(`[flipper-backend] ${line}`);
    }
  });

  // Handle process exit
  child.on("exit", (code, signal) => {
    console.log(
      `[flipper-bridge] Backend process exited with code=${code}, signal=${signal}`
    );

    if (!isShuttingDown) {
      scheduleRestart();
    }
  });

  child.on("error", (err) => {
    console.error(`[flipper-bridge] Failed to start backend process: ${err.message}`);
    if (!isShuttingDown) {
      scheduleRestart();
    }
  });

  return child;
}

/**
 * Schedule a restart with exponential backoff and max-restart protection.
 */
function scheduleRestart(): void {
  if (isShuttingDown) return;

  const now = Date.now();
  if (now - restartWindowStart > MAX_RESTART_WINDOW) {
    // Reset window
    restartCount = 0;
    restartWindowStart = now;
  }

  restartCount++;

  if (restartCount > MAX_RESTARTS) {
    console.error(
      `[flipper-bridge] Backend crashed ${restartCount} times in ${MAX_RESTART_WINDOW / 1000}s. ` +
      `Giving up. Restart the dashboard manually.`
    );
    return;
  }

  const delay = Math.min(RESTART_DELAY * restartCount, 30_000);
  console.log(
    `[flipper-bridge] Restarting backend in ${delay / 1000}s... ` +
    `(attempt ${restartCount}/${MAX_RESTARTS})`
  );

  setTimeout(() => {
    if (!isShuttingDown) {
      backendProcess = startBackendProcess();
    }
  }, delay);
}

/**
 * Check backend health via HTTP.
 */
async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(HEALTH_ENDPOINT, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start periodic health checks.
 */
function startHealthMonitoring(): void {
  if (healthCheckTimer) return;

  // Wait 15s for initial startup before first check
  setTimeout(() => {
    healthCheckTimer = setInterval(async () => {
      if (isShuttingDown) return;

      const healthy = await checkHealth();
      if (!healthy && backendProcess && !backendProcess.killed) {
        console.warn("[flipper-bridge] Backend health check failed — process may be stuck");
        // Don't kill immediately — the process may be recovering
        // Only kill if it's been unhealthy for multiple checks
      }
    }, HEALTH_CHECK_INTERVAL);
  }, 15_000);
}

/**
 * Start the flipper backend bridge.
 * Call this from Next.js instrumentation.ts.
 */
export function startBackendBridge(): void {
  // Check if bridge is disabled
  if (process.env.FLIPPER_BRIDGE_DISABLED === "true") {
    console.log("[flipper-bridge] Bridge disabled via FLIPPER_BRIDGE_DISABLED=true");
    return;
  }

  // Don't start in build mode
  if (process.env.NEXT_PHASE === "phase-production-build") {
    console.log("[flipper-bridge] Skipping — build phase");
    return;
  }

  console.log("[flipper-bridge] Starting Flipper backend bridge...");

  backendProcess = startBackendProcess();

  if (backendProcess) {
    startHealthMonitoring();
    console.log("[flipper-bridge] Backend bridge active — Python process managed");
  }
}

/**
 * Stop the flipper backend bridge.
 * Call this on process exit.
 */
export function stopBackendBridge(): void {
  isShuttingDown = true;

  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }

  if (backendProcess && !backendProcess.killed) {
    console.log("[flipper-bridge] Stopping backend process...");
    backendProcess.kill("SIGTERM");

    // Force kill after 5s if still running
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        console.log("[flipper-bridge] Force killing backend process...");
        backendProcess.kill("SIGKILL");
      }
    }, 5_000);
  }
}

// Auto-cleanup on Node.js process exit
process.on("SIGINT", () => {
  stopBackendBridge();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopBackendBridge();
  process.exit(0);
});

process.on("exit", () => {
  stopBackendBridge();
});
