/**
 * Flipper Backend Bridge — manages the Python FastAPI backend lifecycle.
 *
 * This module is used by the Next.js instrumentation hook to start the
 * Python uvicorn process as a child process, monitor its health, and
 * automatically restart it if it crashes.
 *
 * Usage (from instrumentation.ts):
 *   const { startBackendBridge } = await import("./src/lib/flipper-backend-bridge");
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
 *
 * KI-16-deep fix (iter 106): this module deliberately avoids all
 * filesystem and path-module APIs, AND avoids passing dynamic (env-var
 * or function-return) commands to `spawn`/`spawnSync`. Turbopack's NFT
 * flags `spawn(variable)` / `spawnSync(variable)` because the variable
 * could hold any executable path, potentially tracing the whole project.
 *
 * The fix uses `exec` / `execSync` (shell-based) instead of `spawn` /
 * `spawnSync` for any command that is not a literal string. NFT does not
 * flag `exec(dynamicString)` because the shell is the literal program
 * being executed — the command string is just an argument to the shell.
 *
 * Additional changes:
 *   - Project root: `process.cwd()` directly (no path-module join).
 *   - Venv detection: `execSync` with quoted candidate path.
 *   - Disk logging: REMOVED. All log output goes to console only. Next.js
 *     captures console output in its server log. To persist logs to a file,
 *     redirect the Next.js server output:
 *       `npm run start > flipper-bridge.log 2>&1`  (Unix)
 *       `start.bat > flipper-bridge.log 2>&1`       (Windows)
 *
 * Location history: this file lived at scripts/flipper-backend-bridge.ts
 * through iter 104. In iter 105 it was moved to src/lib/. In iter 106
 * (KI-16-deep) all disk and path-module operations were removed, and
 * dynamic spawn calls were replaced with exec.
 */

import { exec, execSync, ChildProcess } from "child_process";

const BACKEND_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";
const HEALTH_ENDPOINT = `${BACKEND_URL}/api/v1/health/ping`; // Use /ping — ultra-lightweight, plain-text "ok", responds in <1ms even during heavy computation. Prevents false-positive "unhealthy" detections from GIL contention during Bellman-Ford. NOTE: Updated to /api/v1/ prefix (Phase 4.2 API versioning).
const HEALTH_CHECK_INTERVAL = 45_000; // 45s — increased from 30s: the backend may be busy with O(n³) cross-rate validation or snapshot refresh, which can take 10-20s even with async offloading. 30s was too aggressive, causing false-positive kills during normal operation.
const RESTART_DELAY = 5_000; // 5s
const MAX_RESTARTS = 5;
const MAX_RESTART_WINDOW = 60_000; // 1 minute — if >MAX_RESTARTS restarts in this window, give up
const MAX_CONSECUTIVE_UNHEALTHY = 5; // kill process after N consecutive unhealthy checks — increased from 3: the backend may be temporarily unresponsive during heavy computation (cross-rate validation with 600+ currencies). 3 consecutive failures at 45s intervals = 3:45 before kill, which gives enough headroom for transient overload.

const isWindows = process.platform === "win32";

let backendProcess: ChildProcess | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let restartCount = 0;
let restartWindowStart = Date.now();
let isShuttingDown = false;
let consecutiveUnhealthy = 0;

// ---------------------------------------------------------------------------
// Logging — console only (disk logging removed in KI-16-deep; see header)
// ---------------------------------------------------------------------------

/**
 * Log a message to the console. Next.js captures console output in its
 * server log, so messages are still accessible for debugging.
 */
function log(message: string): void {
  console.log(message);
}

function logWarn(message: string): void {
  console.warn(message);
}

function logError(message: string): void {
  console.error(message);
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
 * Prefers .venv Python if available (checked via execSync). Falls back to
 * PYTHON_CMD env var, then to system `python`.
 *
 * Uses `execSync` (shell-based) instead of `spawnSync` because NFT flags
 * `spawnSync(variable)` — see KI-16-deep header.
 */
function detectPythonCommand(): string {
  // 1. Check PYTHON_CMD env var — set by start.bat / start.sh
  if (process.env.PYTHON_CMD) {
    log(`[flipper-bridge] Using PYTHON_CMD from env: ${process.env.PYTHON_CMD}`);
    return process.env.PYTHON_CMD;
  }

  // 2. Check .venv Python — path built with string concat (no path-module
  //    join) so that Turbopack NFT does not flag this module.
  const venvPython = isWindows
    ? process.cwd() + "/.venv/Scripts/python.exe"
    : process.cwd() + "/.venv/bin/python";

  // Test if the venv python exists by running it with --version.
  // Use execSync (shell-based) — NFT does not flag execSync(dynamicString).
  try {
    const quoted = isWindows ? `"${venvPython}"` : `'${venvPython}'`;
    execSync(`${quoted} --version`, { stdio: "ignore", timeout: 5_000 });
    log(`[flipper-bridge] Using venv Python: ${venvPython}`);
    return venvPython;
  } catch {
    // venv python doesn't exist or can't be executed — fall through
  }

  // 3. Fallback: system python (may fail with ENOENT if not in PATH)
  log("[flipper-bridge] No .venv found and PYTHON_CMD not set, falling back to system python");
  return "python";
}

// ---------------------------------------------------------------------------
// Backend process management
// ---------------------------------------------------------------------------

/**
 * Start the Python backend process.
 *
 * Uses `exec` (shell-based) instead of `spawn` because NFT flags
 * `spawn(variable)` — see KI-16-deep header. The command string is
 * properly quoted so paths with spaces work correctly.
 */
function startBackendProcess(): ChildProcess | null {
  if (isShuttingDown) return null;

  const pythonCmd = detectPythonCommand();
  const projectRoot = process.cwd();

  // Build the shell command string. Quote the python command in case it
  // contains spaces (e.g., Windows paths like "C:\Program Files\...").
  const quotedCmd = isWindows ? `"${pythonCmd}"` : `'${pythonCmd}'`;
  const shellCommand = `${quotedCmd} -m uvicorn backend.main:app --host 0.0.0.0 --port 8000`;

  log(`[flipper-bridge] Starting backend: ${shellCommand}`);

  const env = {
    ...process.env,
    PYTHONPATH: projectRoot,
  };

  const child = exec(shellCommand, {
    cwd: projectRoot,
    env,
    // No maxBuffer limit — we read streams, not the buffered result.
    // Setting maxBuffer to a very large value prevents the process from
    // being killed if output exceeds the default 1 MB buffer.
    maxBuffer: 1024 * 1024 * 1024, // 1 GB — effectively unlimited
    timeout: 0, // no timeout — the backend runs until killed
  });

  if (!child) {
    logError("[flipper-bridge] Failed to spawn backend process (exec returned null)");
    return null;
  }

  // Log stdout
  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      log(`[flipper-backend] ${line}`);
    }
  });

  // Log stderr — parse Python log level to avoid tagging all stderr as ERROR.
  // uvicorn logs to stderr by default; INFO/DEBUG/WARNING lines should not
  // be tagged as errors, only actual ERROR/CRITICAL lines.
  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (/\b(ERROR|CRITICAL|TRACEBACK|Traceback)\b/i.test(line)) {
        logError(`[flipper-backend] ${line}`);
      } else {
        log(`[flipper-backend] ${line}`);
      }
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
    // 15s timeout — increased from 10s. Although /api/health/ping responds
    // in <1ms normally, during ProcessPoolExecutor process spawn (cold start
    // of worker processes) the event loop may briefly stall. 15s gives ample
    // headroom without risking "stuck process" false detections.
    const timeout = setTimeout(() => controller.abort(), 15_000);

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

  // Wait 30s for initial startup before first check — increased from 15s:
  // The backend needs time to fetch all ByCategory pages (15+ API calls)
  // and compute the initial snapshot before it can respond to health checks.
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
 *
 * This function is synchronous — all operations (exec, health monitoring)
 * run in the background after it returns. Errors are caught by the caller's
 * try/catch in instrumentation.ts.
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
  log(`[flipper-bridge] Project root: ${process.cwd()}`);

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
