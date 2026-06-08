#!/usr/bin/env bash
# ============================================================
#  PoE2 Market Dashboard — Linux/macOS Launcher
#
#  Usage:
#    chmod +x start.sh
#    ./start.sh            # production mode (build + start)
#    ./start.sh --dev      # development mode (no build, hot reload)
#    ./start.sh --skip-build  # skip build, use existing .next
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

# ---- Check Python / uvicorn ----
PYTHON_AVAILABLE=0
UVICORN_AVAILABLE=0

if command -v python3 &>/dev/null; then
    PYTHON_AVAILABLE=1
    info "Python3 found."
elif command -v python &>/dev/null; then
    PYTHON_AVAILABLE=1
    info "Python found."
fi

if command -v uvicorn &>/dev/null; then
    UVICORN_AVAILABLE=1
    info "uvicorn found."
elif [ "$PYTHON_AVAILABLE" -eq 1 ]; then
    # Check via python3 -m uvicorn --version (more reliable than pip show)
    # This catches cases where uvicorn is installed but not in PATH
    PY_CMD="python3"
    if ! command -v python3 &>/dev/null; then
        PY_CMD="python"
    fi
    if $PY_CMD -m uvicorn --version &>/dev/null 2>&1; then
        UVICORN_AVAILABLE=1
        info "uvicorn found via $PY_CMD -m uvicorn."
    elif $PY_CMD -m pip show uvicorn &>/dev/null 2>&1; then
        UVICORN_AVAILABLE=1
        info "uvicorn found via pip show."
    fi
fi

if [ "$UVICORN_AVAILABLE" -eq 0 ]; then
    warn "uvicorn not found. Flipper backend will not start."
    warn "Advanced features (scoring, forecasts, portfolio) will be unavailable."
    warn "Install with: pip install -r requirements.txt"
    echo ""
fi

# ---- Install Python dependencies ----
if [ "$PYTHON_AVAILABLE" -eq 1 ] && [ "$UVICORN_AVAILABLE" -eq 1 ]; then
    info "Checking Python dependencies..."
    PIP_CMD="pip"
    if command -v pip3 &>/dev/null; then
        PIP_CMD="pip3"
    fi
    if $PIP_CMD install -q -r requirements.txt 2>/dev/null; then
        info "Python dependencies ready."
    else
        warn "Some Python dependencies may be missing."
        warn "Run manually: $PIP_CMD install -r requirements.txt"
    fi
    echo ""
fi

# ---- Check .env.local ----
if [ ! -f ".env.local" ]; then
    info "Creating .env.local with default settings..."
    cat > .env.local <<'EOF'
# PoE2 API Base URL
POE2_API_BASE_URL=https://api.poe2scout.com/api
# Flipper backend URL (server-side only, used by API proxy routes)
FLIPPER_API_URL=http://localhost:8000
# Flipper WebSocket URL (client-side, for real-time updates)
# In dev: connects directly to backend on port 8000
# In production behind reverse proxy: set to wss://your-domain.com
NEXT_PUBLIC_FLIPPER_WS_URL=ws://localhost:8000
# Enable Flipper WebSocket integration (set to "true" to enable real-time updates)
NEXT_PUBLIC_FLIPPER_WS_ENABLED=true
EOF
    info ".env.local created with api.poe2scout.com"
    echo ""
else
    info ".env.local found."
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

# ---- Start FastAPI backend ----
FLIPPER_PID=""

if [ "$UVICORN_AVAILABLE" -eq 1 ]; then
    info "Starting FastAPI Flipper backend on port 8000..."
    # Use python3 -m uvicorn to avoid PATH issues (uvicorn may not be in PATH
    # even though it's installed via pip --user)
    PY_CMD="python3"
    if ! command -v python3 &>/dev/null; then
        PY_CMD="python"
    fi
    # PYTHONPATH must include the project root so Python can find the 'backend' package
    # Without this, uvicorn fails with "ModuleNotFoundError: No module named 'backend'"
    PYTHONPATH="$SCRIPT_DIR" $PY_CMD -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 > flipper-backend.log 2>&1 &
    FLIPPER_PID=$!

    # Wait for backend to start with retry loop (up to 30 seconds)
    # The backend may take longer when poe2scout.com is unreachable
    # (it tries to connect, times out, then starts in degraded mode)
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
else
    warn "Flipper backend not started (uvicorn not available)."
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

# ---- Handle flags ----
DEV_MODE=0
SKIP_BUILD=0

for arg in "$@"; do
    case "$arg" in
        --dev) DEV_MODE=1 ;;
        --skip-build) SKIP_BUILD=1 ;;
    esac
done

if [ "$DEV_MODE" -eq 1 ]; then
    info "Starting in DEVELOPMENT mode (--dev flag)"
    echo ""

    # Restart Flipper with --reload in dev mode
    if [ "$UVICORN_AVAILABLE" -eq 1 ]; then
        info "Restarting Flipper backend with --reload for dev mode..."
        if [ -n "$FLIPPER_PID" ]; then
            kill "$FLIPPER_PID" 2>/dev/null || true
            sleep 1
        fi
        PYTHONPATH="$SCRIPT_DIR" $PY_CMD -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 > flipper-backend.log 2>&1 &
        FLIPPER_PID=$!
        sleep 2
        info "Flipper backend restarted with --reload"
        echo ""
    fi

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
echo ""
echo "  Press Ctrl+C to stop all servers."
echo "============================================================"
echo ""

export NODE_ENV=production
npm run start

cleanup
