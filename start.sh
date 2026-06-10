#!/usr/bin/env bash
# ============================================================
#  PoE2 Market Dashboard — Linux/macOS Launcher
#
#  Usage:
#    chmod +x start.sh
#    ./start.sh            # production mode (build + start, bridge enabled)
#    ./start.sh --dev      # development mode (no build, hot reload)
#    ./start.sh --skip-build  # skip build, use existing .next
#    ./start.sh --clean    # remove .next + node_modules + .venv, reinstall, build
#    ./start.sh --no-bridge  # start Python backend separately (legacy)
#
#  Bridge mode (default): Next.js manages the Python backend via
#  instrumentation.ts → flipper-backend-bridge.ts. Auto-start, health
#  monitoring, auto-restart on crash, graceful shutdown.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ---- Colors for output ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'  # No Color

info()  { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

echo "============================================================"
echo "  PoE2 Market Dashboard - Launcher (Linux/macOS)"
echo "============================================================"
echo ""

# ---- Parse flags early ----
DEV_MODE=0
SKIP_BUILD=0
CLEAN_MODE=0
NO_BRIDGE=0

for arg in "$@"; do
    case "$arg" in
        --dev) DEV_MODE=1 ;;
        --skip-build) SKIP_BUILD=1 ;;
        --clean) CLEAN_MODE=1 ;;
        --no-bridge) NO_BRIDGE=1 ;;
    esac
done

# ---- Check Node.js ----
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v)
    info "Node.js found: $NODE_VERSION"
else
    error "Node.js is not installed or not in PATH."
    error "Install from https://nodejs.org/"
    exit 1
fi

# ---- Check npm ----
if command -v npm &>/dev/null; then
    info "npm found."
else
    error "npm is not found."
    exit 1
fi

# ---- OOM protection: limit ProcessPoolExecutor workers ----
# Each worker loads sklearn/numpy/scipy (~300-500 MB). With 600+ currencies,
# multiple workers cause OOM on systems with <16 GB RAM. Default: 1 worker.
# Override: set FLIPPER_WORKERS=0 for auto-detect, or a specific number.
if [ -z "${FLIPPER_WORKERS:-}" ]; then
    export FLIPPER_WORKERS=1
fi

# ---- Check Python & set up venv ----
PYTHON_AVAILABLE=0
UVICORN_AVAILABLE=0
VENV_DIR="$SCRIPT_DIR/.venv"
PY_CMD=""  # Will be set to the venv python or system python

if command -v python3 &>/dev/null; then
    PYTHON_AVAILABLE=1
elif command -v python &>/dev/null; then
    PYTHON_AVAILABLE=1
fi

if [ "$PYTHON_AVAILABLE" -eq 1 ]; then
    # Determine the system python command
    SYS_PY="python3"
    if ! command -v python3 &>/dev/null; then
        SYS_PY="python"
    fi

    # Create venv if it doesn't exist
    if [ ! -d "$VENV_DIR" ] || [ ! -f "$VENV_DIR/bin/python" ]; then
        info "Creating Python virtual environment (.venv)..."
        if $SYS_PY -m venv "$VENV_DIR" 2>/dev/null; then
            info "Virtual environment created."
        else
            warn "Failed to create venv. Falling back to system Python."
            VENV_DIR=""
        fi
    fi

    # Set PY_CMD to venv python (preferred) or system python
    if [ -f "$VENV_DIR/bin/python" ]; then
        PY_CMD="$VENV_DIR/bin/python"
        info "Using venv Python: $PY_CMD"
    else
        PY_CMD="$SYS_PY"
        info "Using system Python: $PY_CMD"
    fi

    # Check if uvicorn is available in venv or system
    if [ -f "$VENV_DIR/bin/uvicorn" ]; then
        UVICORN_AVAILABLE=1
        info "uvicorn found in venv."
    elif $PY_CMD -m uvicorn --version &>/dev/null 2>&1; then
        UVICORN_AVAILABLE=1
        info "uvicorn found via $PY_CMD -m uvicorn."
    elif command -v uvicorn &>/dev/null; then
        UVICORN_AVAILABLE=1
        info "uvicorn found in PATH."
    fi
fi

if [ "$UVICORN_AVAILABLE" -eq 0 ]; then
    warn "uvicorn not found. Flipper backend will not start."
    warn "Advanced features (scoring, forecasts, portfolio) will be unavailable."
    if [ "$PYTHON_AVAILABLE" -eq 1 ]; then
        warn "Install with: $PY_CMD -m pip install -r requirements.txt"
    else
        warn "Install Python 3 and then: pip install -r requirements.txt"
    fi
    echo ""
fi

# Export PYTHON_CMD so the flipper-backend-bridge can find the right Python.
# Without this, the bridge falls back to "python" which may not be in PATH.
if [ -n "$PY_CMD" ]; then
    export PYTHON_CMD="$PY_CMD"
fi

# ---- Install Python dependencies into venv ----
if [ "$PYTHON_AVAILABLE" -eq 1 ]; then
    info "Checking Python dependencies..."
    if $PY_CMD -m pip install -q -r requirements.txt 2>&1; then
        info "Python dependencies ready."
    else
        warn "Some Python dependencies may be missing."
        warn "Run manually: $PY_CMD -m pip install -r requirements.txt"
    fi
    echo ""
fi

# ---- Check .env.local ----
# WS env vars are only set when uvicorn is available, because
# the browser cannot reach ws://localhost:8000 without a running
# backend.  This prevents console errors from failed WebSocket
# connections.  (Matches start.bat behavior.)
if [ ! -f ".env.local" ]; then
    info "Creating .env.local with default settings..."
    {
        echo "# PoE2 API Base URL"
        echo "POE2_API_BASE_URL=https://api.poe2scout.com/api"
        echo "# Flipper backend URL (server-side only, used by API proxy routes)"
        echo "FLIPPER_API_URL=http://localhost:8000"
        if [ "$UVICORN_AVAILABLE" -eq 1 ]; then
            echo "# Flipper WebSocket - enabled because uvicorn is available"
            echo "NEXT_PUBLIC_FLIPPER_WS_ENABLED=true"
            echo "NEXT_PUBLIC_FLIPPER_WS_URL=ws://localhost:8000"
        else
            echo "# Flipper WebSocket - disabled (uvicorn not found)"
            echo "NEXT_PUBLIC_FLIPPER_WS_ENABLED=false"
        fi
    } > .env.local
    info ".env.local created with api.poe2scout.com"
    echo ""
else
    info ".env.local found."
    # Verify POE2_API_BASE_URL uses api. subdomain (not bare poe2scout.com)
    if ! grep -q "poe2scout.com/api" .env.local 2>/dev/null; then
        warn ".env.local may have wrong POE2_API_BASE_URL!"
        warn "The URL should include the \"api.\" subdomain:"
        warn "POE2_API_BASE_URL=https://api.poe2scout.com/api"
        warn "Using the bare domain (poe2scout.com) causes ECONNRESET/502 errors."
    fi
    # Ensure NEXT_PUBLIC_FLIPPER_WS_ENABLED exists in .env.local
    if ! grep -q "NEXT_PUBLIC_FLIPPER_WS_ENABLED" .env.local 2>/dev/null; then
        info "Adding NEXT_PUBLIC_FLIPPER_WS_ENABLED to .env.local..."
        if [ "$UVICORN_AVAILABLE" -eq 1 ]; then
            echo "NEXT_PUBLIC_FLIPPER_WS_ENABLED=true" >> .env.local
        else
            echo "NEXT_PUBLIC_FLIPPER_WS_ENABLED=false" >> .env.local
        fi
        info "NEXT_PUBLIC_FLIPPER_WS_ENABLED added."
    fi
    # Only add WS URL if uvicorn is available AND the var is missing
    if [ "$UVICORN_AVAILABLE" -eq 1 ]; then
        if ! grep -q "NEXT_PUBLIC_FLIPPER_WS_URL" .env.local 2>/dev/null; then
            info "Adding NEXT_PUBLIC_FLIPPER_WS_URL to .env.local..."
            echo "NEXT_PUBLIC_FLIPPER_WS_URL=ws://localhost:8000" >> .env.local
            info "NEXT_PUBLIC_FLIPPER_WS_URL added."
        fi
    fi
    echo ""
fi

# ---- Kill existing servers ----
info "Checking for existing servers..."

# Kill port 3000
PIDS_3000=$(lsof -ti:3000 2>/dev/null || true)
if [ -n "$PIDS_3000" ]; then
    info "Killing process on port 3000..."
    echo "$PIDS_3000" | xargs kill -9 2>/dev/null || true
    sleep 1
fi
info "Port 3000 is free."

# Kill port 8000
PIDS_8000=$(lsof -ti:8000 2>/dev/null || true)
if [ -n "$PIDS_8000" ]; then
    info "Killing process on port 8000..."
    echo "$PIDS_8000" | xargs kill -9 2>/dev/null || true
    sleep 1
fi
info "Port 8000 is free."
echo ""

# ---- Backend startup mode ----
FLIPPER_PID=""
export FLIPPER_BRIDGE_DISABLED="false"

if [ "$UVICORN_AVAILABLE" -eq 1 ]; then
    if [ "$NO_BRIDGE" -eq 1 ]; then
        # --no-bridge mode: start Python backend separately (legacy)
        info "Starting FastAPI Flipper backend separately (--no-bridge mode)..."
        PYTHONPATH="$SCRIPT_DIR" $PY_CMD -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 > flipper-backend.log 2>&1 &
        FLIPPER_PID=$!

        # Wait for backend to start with retry loop (up to 30 seconds)
        _BACKEND_OK=0
        for i in $(seq 1 30); do
            sleep 1
            if curl -s --max-time 3 http://localhost:8000/api/health &>/dev/null; then
                _BACKEND_OK=1
                info "Flipper backend started on http://localhost:8000 (after ${i}s)"
                break
            fi
            # Check if the process is still running
            if ! kill -0 "$FLIPPER_PID" 2>/dev/null; then
                warn "Flipper backend process died! Check flipper-backend.log for errors."
                if [ -f "flipper-backend.log" ]; then
                    echo "--- Last 10 lines of flipper-backend.log ---"
                    tail -10 flipper-backend.log
                    echo "---"
                fi
                break
            fi
        done

        if [ "$_BACKEND_OK" -eq 0 ]; then
            if kill -0 "$FLIPPER_PID" 2>/dev/null; then
                warn "Flipper backend is still starting (degraded mode — upstream API may be unreachable)."
                warn "It will become available shortly. Dashboard will work with cached data."
            else
                warn "Flipper backend failed to start. Check flipper-backend.log for errors."
                warn "The dashboard will still work in frontend-only mode (no analytics)."
            fi
        fi
        echo ""

        # Disable bridge since we started backend separately
        export FLIPPER_BRIDGE_DISABLED="true"
    else
        # Bridge mode (default): Next.js manages the Python backend
        info "Flipper backend will be managed by Next.js bridge (auto-start + auto-restart)."
        info "Bridge logs: flipper-bridge.log"
        info "The bridge starts the Python process when Next.js starts."
        info "If the backend crashes, it will be restarted automatically."
        echo ""
        export FLIPPER_BRIDGE_DISABLED="false"
    fi
else
    warn "Flipper backend not started (uvicorn not available)."
    export FLIPPER_BRIDGE_DISABLED="true"
    echo ""
fi

# ---- Install npm dependencies ----
if [ ! -d "node_modules" ]; then
    info "node_modules not found. Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        error "npm install failed!"
        exit 1
    fi
    info "Dependencies installed successfully."
    echo ""
else
    info "Dependencies already installed."
    echo ""
fi

# ---- Cleanup function ----
cleanup() {
    echo ""
    info "Cleaning up..."
    if [ -n "$FLIPPER_PID" ]; then
        kill "$FLIPPER_PID" 2>/dev/null || true
        info "Flipper backend stopped."
    fi
    # Kill any remaining process on port 8000
    PIDS=$(lsof -ti:8000 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill -9 2>/dev/null || true
    fi
    info "Done."
    exit 0
}
trap cleanup SIGINT SIGTERM

# ---- Handle --clean flag ----
if [ "$CLEAN_MODE" -eq 1 ]; then
    info "--clean flag: deep cleaning..."
    rm -rf .next 2>/dev/null || true
    info "Removed .next/"
    rm -rf node_modules 2>/dev/null || true
    info "Removed node_modules/"
    rm -rf .venv 2>/dev/null || true
    info "Removed .venv/"
    info "Reinstalling dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        error "npm install failed after --clean!"
        exit 1
    fi
    info "npm dependencies reinstalled successfully."
    # Recreate venv and install Python deps
    if [ "$PYTHON_AVAILABLE" -eq 1 ]; then
        info "Recreating Python venv and installing deps..."
        $SYS_PY -m venv "$VENV_DIR"
        "$VENV_DIR/bin/python" -m pip install -q -r requirements.txt
        PY_CMD="$VENV_DIR/bin/python"
        info "Python venv recreated and deps installed."
    fi
    echo ""
fi

# ---- Dev mode ----
if [ "$DEV_MODE" -eq 1 ]; then
    info "Starting in DEVELOPMENT mode (--dev flag)"
    echo ""

    # Start Flipper with --reload in dev mode
    if [ "$UVICORN_AVAILABLE" -eq 1 ]; then
        info "Starting Flipper backend with --reload for dev mode..."
        if [ -n "$FLIPPER_PID" ]; then
            kill "$FLIPPER_PID" 2>/dev/null || true
            sleep 1
        fi
        PYTHONPATH="$SCRIPT_DIR" $PY_CMD -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 > flipper-backend.log 2>&1 &
        FLIPPER_PID=$!
        sleep 2
        info "Flipper backend started with --reload"
        echo ""
    fi

    # Disable bridge in dev mode (uvicorn --reload handles restarts)
    export FLIPPER_BRIDGE_DISABLED="true"

    echo "============================================================"
    echo "  Starting PoE2 Market Dashboard - DEV MODE"
    echo "  Open your browser: http://localhost:3000"
    echo ""
    echo "  Flipper backend: http://localhost:8000"
    echo "  Press Ctrl+C to stop all servers."
    echo "============================================================"
    echo ""

    npx next dev
    cleanup
    exit 0
fi

# ---- Clean .next directory ----
if [ "$SKIP_BUILD" -eq 0 ]; then
    info "Cleaning .next directory to prevent stale builds..."
    rm -rf .next 2>/dev/null || true
    info ".next directory cleaned."
    echo ""

    # ---- Build project ----
    info "Building project..."
    npm run build
    if [ $? -ne 0 ]; then
        error "Build failed! Check the errors above."
        echo ""
        echo "[TIP] You can try:"
        echo "      1. ./start.sh --dev          - development mode, no build needed"
        echo "      2. ./start.sh --skip-build   - skip build, use existing .next"
        cleanup
        exit 1
    fi
    info "Build completed successfully."
    echo ""
fi

# ---- Verify .next ----
if [ ! -d ".next" ]; then
    error ".next directory not found after build!"
    error "Try running: npm run build"
    error "Or use: ./start.sh --dev"
    cleanup
    exit 1
fi

# ---- Start the server ----
echo "============================================================"
echo "  Starting PoE2 Market Dashboard..."
echo "  Open your browser: http://localhost:3000"
echo ""
echo "  Flipper backend: http://localhost:8000"
echo "  Bridge logs: flipper-bridge.log"
echo ""
echo "  Press Ctrl+C to stop all servers."
echo "============================================================"
echo ""

export NODE_ENV=production
npm run start

cleanup
