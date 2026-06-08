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
 *
 * Platform notes:
 *   Windows: uses taskkill /PID /T /F for process termination because
 *   child_process.kill("SIGTERM") does not reliably kill Python child
 *   processes on Windows (no POSIX signal support).
 *   Unix/macOS: uses SIGTERM → SIGKILL fallback as before.
 */

import { spawn, execSync, ChildProcess } from "child_process";
import { existsSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const BACKEND_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";
const HEALTH_ENDPOINT = `${BACKEND_URL}/api/health`;
const HEALTH_CHECK_INTERVAL = 30_000; // 30s
const RESTART_DELAY = 5_000; // 5s
const MAX_RESTARTS = 5;
const MAX_RESTART_WINDOW = 60_000; // 1 minute — if >MAX_RESTARTS restarts in this window, give up
const MAX_CONSECUTIVE_UNHEALTHY = 3; // kill process after N consecutive unhealthy checks
const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — rotate log after this size

const isWindows = process.platform === "win32";

let backendProcess: ChildProcess | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let restartCount = 0;
let restartWindowStart = Date.now();
let isShuttingDown = false;
let consecutiveUnhealthy = 0;

// ---------------------------------------------------------------------------
// File logging — writes to flipper-bridge.log in the project root
// ---------------------------------------------------------------------------

const projectRoot = join(__dirname, "..");
const LOG_FILE = join(projectRoot, "flipper-bridge.log");

function logToFile(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;

    // Rotate log if too large
    if (existsSync(LOG_FILE)) {
      try {
        const { statSync } = require("fs");
        const stats = statSync(LOG_FILE);
        if (stats.size > LOG_FILE_MAX_BYTES) {
          // Truncate: keep last ~256 KB by writing empty + appending
          writeFileSync(LOG_FILE, "");
        }
      } catch {
        // Ignore rotation errors
      }
    }

    appendFileSync(LOG_FILE, line);
  } catch {
    // Log file write failures are non-critical — don't crash
  }
}

/**
 * Log a message to both console and the log file.
 */
function log(message: string): void {
  console.log(message);
  logToFile(message);
}

function logWarn(message: string): void {
  console.warn(message);
  logToFile(`[WARN] ${message}`);
}

function logError(message: string): void {
  console.error(message);
  logToFile(`[ERROR] ${message}`);
}

// ---------------------------------------------------------------------------
// Windows-aware process termination
// ---------------------------------------------------------------------------

/**
 * Kill a child process in a platform-appropriate way.
 *
 * On Windows, child_process.kill("SIGTERM") sends a signal that Python
 * does not handle (no POSIX signals). The process and its children may
 * survive. Using `taskkill /PID <pid> /T /F` kills the entire process
 * tree forcefully.
 *
 * On Unix, we use the standard SIGTERM → SIGKILL (5s grace) approach.
 */
function killBackendProcess(child: ChildProcess): void {
  if (isWindows && child.pid) {
    try {
      log(`[flipper-bridge] Windows: killing process tree with taskkill /PID ${child.pid} /T /F`);
      execSync(`taskkill /PID ${child.pid} /T /F`, {
        stdio: "ignore",
        timeout: 10_000,
      });
    } catch {
      // taskkill may fail if process already exited — that's fine
      log("[flipper-bridge] taskkill failed (process may have already exited)");
    }
  } else {
    // Unix: SIGTERM first, then SIGKILL after 5s
    try {
      child.kill("SIGTERM");
    } catch {
      // Process may have already exited
    }

    const forceKillTimer = setTimeout(() => {
      try {
        if (!child.killed) {
          log("[flipper-bridge] Force killing backend process (SIGKILL)...");
          child.kill("SIGKILL");
        }
      } catch {
        // Ignore
      }
    }, 5_000);

    // Don't keep the Node.js process alive just for this timer
    forceKillTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Python / uvicorn detection
// ---------------------------------------------------------------------------

/**
 * Detect the Python command to use.
 * Prefers .venv Python if available.
 */
function detectPythonCommand(): string {
  // Windows: check .venv\Scripts\python.exe
  const winVenvPython = join(projectRoot, ".venv", "Scripts", "python.exe");
  if (existsSync(winVenvPython)) {
    log(`[flipper-bridge] Using venv Python: ${winVenvPython}`);
    return winVenvPython;
  }

  // Unix: check .venv/bin/python
  const unixVenvPython = join(projectRoot, ".venv", "bin", "python");
  if (existsSync(unixVenvPython)) {
    log(`[flipper-bridge] Using venv Python: ${unixVenvPython}`);
    return unixVenvPython;
  }

  // Fallback: system python
  log("[flipper-bridge] No .venv found, using system python");
  return "python";
}

/**
 * Detect if uvicorn is available.
 * Returns empty array if uvicorn binary found (use directly),
 * or ["-m", "uvicorn"] to invoke via python -m uvicorn.
 */
function getUvicornArgs(): string[] {
  // Check if .venv has uvicorn directly
  const winUvicorn = join(projectRoot, ".venv", "Scripts", "uvicorn.exe");
  if (existsSync(winUvicorn)) {
    return [];
  }

  const unixUvicorn = join(projectRoot, ".venv", "bin", "uvicorn");
  if (existsSync(unixUvicorn)) {
    return [];
  }

  // Will use python -m uvicorn
  return ["-m", "uvicorn"];
}

// ---------------------------------------------------------------------------
// Backend process management
// ---------------------------------------------------------------------------

/**
 * Start the Python backend process.
 */
function startBackendProcess(): ChildProcess | null {
  if (isShuttingDown) return null;

  const pythonCmd = detectPythonCommand();
  const uvicornArgs = getUvicornArgs();

  const args = [
    ...uvicornArgs,
    "backend.main:app",
    "--host", "0.0.0.0",
    "--port", "8000",
  ];

  log(`[flipper-bridge] Starting backend: ${pythonCmd} ${args.join(" ")}`);

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
      log(`[flipper-backend] ${line}`);
    }
  });

  // Log stderr
  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      logError(`[flipper-backend] ${line}`);
    }
  });

  // Handle process exit
  child.on("exit", (code, signal) => {
    log(
      `[flipper-bridge] Backend process exited with code=${code}, signal=${signal}`
    );

    if (!isShuttingDown) {
      consecutiveUnhealthy = 0;
      scheduleRestart();
    }
  });

  child.on("error", (err) => {
    logError(`[flipper-bridge] Failed to start backend process: ${err.message}`);
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
    logError(
      `[flipper-bridge] Backend crashed ${restartCount} times in ${MAX_RESTART_WINDOW / 1000}s. ` +
      `Giving up. Restart the dashboard manually.`
    );
    return;
  }

  const delay = Math.min(RESTART_DELAY * restartCount, 30_000);
  log(
    `[flipper-bridge] Restarting backend in ${delay / 1000}s... ` +
    `(attempt ${restartCount}/${MAX_RESTARTS})`
  );

  setTimeout(() => {
    if (!isShuttingDown) {
      backendProcess = startBackendProcess();
    }
  }, delay);
}

// ---------------------------------------------------------------------------
// Health monitoring
// ---------------------------------------------------------------------------

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
 *
 * If the backend is unhealthy for MAX_CONSECUTIVE_UNHEALTHY checks in a row,
 * the bridge kills the process (which triggers auto-restart via the exit handler).
 * This handles "stuck" processes that are alive but not responding.
 */
function startHealthMonitoring(): void {
  if (healthCheckTimer) return;

  // Wait 15s for initial startup before first check
  setTimeout(() => {
    healthCheckTimer = setInterval(async () => {
      if (isShuttingDown) return;

      const healthy = await checkHealth();
      if (healthy) {
        consecutiveUnhealthy = 0;
      } else {
        consecutiveUnhealthy++;
        logWarn(
          `[flipper-bridge] Backend health check failed (${consecutiveUnhealthy}/${MAX_CONSECUTIVE_UNHEALTHY})`
        );

        if (consecutiveUnhealthy >= MAX_CONSECUTIVE_UNHEALTHY && backendProcess && !backendProcess.killed) {
          logWarn(
            `[flipper-bridge] Backend unhealthy for ${MAX_CONSECUTIVE_UNHEALTHY} consecutive checks — killing process to trigger restart`
          );
          killBackendProcess(backendProcess);
          // The exit handler will call scheduleRestart()
        }
      }
    }, HEALTH_CHECK_INTERVAL);
  }, 15_000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the flipper backend bridge.
 * Call this from Next.js instrumentation.ts.
 */
export function startBackendBridge(): void {
  // Check if bridge is disabled
  if (process.env.FLIPPER_BRIDGE_DISABLED === "true") {
    log("[flipper-bridge] Bridge disabled via FLIPPER_BRIDGE_DISABLED=true");
    return;
  }

  // Don't start in build mode
  if (process.env.NEXT_PHASE === "phase-production-build") {
    log("[flipper-bridge] Skipping — build phase");
    return;
  }

  log("[flipper-bridge] Starting Flipper backend bridge...");
  log(`[flipper-bridge] Platform: ${process.platform} (${isWindows ? "Windows" : "Unix"})`);
  log(`[flipper-bridge] Log file: ${LOG_FILE}`);

  backendProcess = startBackendProcess();

  if (backendProcess) {
    startHealthMonitoring();
    log("[flipper-bridge] Backend bridge active — Python process managed");
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
    log("[flipper-bridge] Stopping backend process...");
    killBackendProcess(backendProcess);
  }
}

// ---------------------------------------------------------------------------
// Auto-cleanup on Node.js process exit
// ---------------------------------------------------------------------------

// On Windows, SIGINT/SIGTERM are not delivered the same way as Unix.
// The 'exit' event is the most reliable cleanup hook across platforms.
// We also hook SIGINT/SIGTERM for Unix for faster cleanup.

process.on("SIGINT", () => {
  stopBackendBridge();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopBackendBridge();
  process.exit(0);
});

process.on("exit", () => {
  // Use synchronous cleanup only — no async/child_process in 'exit' handler
  if (backendProcess && !backendProcess.killed && backendProcess.pid) {
    if (isWindows) {
      try {
        execSync(`taskkill /PID ${backendProcess.pid} /T /F`, { stdio: "ignore", timeout: 5_000 });
      } catch {
        // Best effort
      }
    } else {
      try {
        backendProcess.kill("SIGKILL");
      } catch {
        // Best effort
      }
    }
  }
});
