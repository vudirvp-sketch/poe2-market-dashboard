@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM ============================================================
REM  PoE2 Market Dashboard - Launcher
REM
REM  This file MUST use CRLF line endings.
REM  If Git converts it to LF, CMD mis-parses setlocal/if
REM  blocks, producing 'd', 'EM', 'tlocal' errors.
REM  A .gitattributes file enforces CRLF for .bat files.
REM
REM  IMPORTANT: setlocal enabledelayedexpansion is required
REM  because variables (ERRORLEVEL, _BACKEND_OK) set inside
REM  parenthesized if/for blocks must be read with !VAR! syntax.
REM  Without delayed expansion, %VAR% inside blocks expands at
REM  parse time, producing "0 was unexpected at this time" when
REM  the variable is empty or not yet assigned.
REM
REM  Flags:
REM    (default)       — Bridge mode: Next.js manages Python backend
REM    --no-bridge     — Start Python backend separately (legacy)
REM    --dev           — Development mode (no build, uvicorn --reload)
REM    --skip-build    — Skip build, use existing .next
REM    --clean         — Remove .next + node_modules + .venv, reinstall
REM ============================================================

echo ============================================================
echo   PoE2 Market Dashboard - Launcher
echo ============================================================
echo.

REM ---- Check Node.js ----
where.exe node >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo [OK] Node.js found: %NODE_VERSION%
echo.

REM ---- Check npm ----
where.exe npm >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [ERROR] npm is not found.
    echo Node.js is installed but npm is missing.
    echo This can happen with custom Node.js installations.
    echo Please reinstall Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [OK] npm found.
echo.

REM ---- Check for Python / uvicorn (optional) ----
set PYTHON_AVAILABLE=0
set UVICORN_AVAILABLE=0
set PY_CMD=python

REM ---- OOM protection: limit ProcessPoolExecutor workers ----
REM Each worker loads sklearn/numpy/scipy (~300-500 MB). With 600+ currencies,
REM multiple workers cause OOM on systems with <16 GB RAM. Default: 1 worker.
REM Override: set FLIPPER_WORKERS=0 for auto-detect, or a specific number.
if not defined FLIPPER_WORKERS (
    set FLIPPER_WORKERS=1
)

where.exe python >nul 2>&1
if !ERRORLEVEL! equ 0 (
    set PYTHON_AVAILABLE=1
    echo [OK] Python found.
)

REM ---- Set up Python venv ----
REM Creates .venv if it doesn't exist, then uses venv's python/pip.
REM This avoids PEP 668 "externally-managed-environment" errors on
REM modern Linux and keeps deps isolated from the system Python.
set VENV_DIR=%~dp0.venv

if !PYTHON_AVAILABLE! equ 1 (
    if not exist "!VENV_DIR!\Scripts\python.exe" (
        echo [INFO] Creating Python virtual environment ^(.venv^)...
        python -m venv .venv >nul 2>&1
        if exist ".venv\Scripts\python.exe" (
            echo [OK] Virtual environment created.
        ) else (
            echo [WARN] Failed to create venv. Falling back to system Python.
        )
    )

    REM Use venv python if available, otherwise system python
    if exist ".venv\Scripts\python.exe" (
        set PY_CMD=.venv\Scripts\python.exe
        echo [OK] Using venv Python: !PY_CMD!
    )
)

REM Export PYTHON_CMD so the flipper-backend-bridge can find the right Python.
REM Without this, the bridge falls back to "python" which may not be in PATH.
if "!PY_CMD!" neq "" (
    set PYTHON_CMD=!PY_CMD!
)

REM Check uvicorn availability (venv first, then system)
if exist ".venv\Scripts\uvicorn.exe" (
    set UVICORN_AVAILABLE=1
    echo [OK] uvicorn found in venv.
) else (
    where.exe uvicorn >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        set UVICORN_AVAILABLE=1
        echo [OK] uvicorn found.
    )
)

if !UVICORN_AVAILABLE! equ 0 (
    if !PYTHON_AVAILABLE! equ 1 (
        !PY_CMD! -m uvicorn --version >nul 2>&1
        if !ERRORLEVEL! equ 0 (
            set UVICORN_AVAILABLE=1
            echo [OK] uvicorn found via !PY_CMD! -m uvicorn.
        )
    )
)

if !UVICORN_AVAILABLE! equ 0 (
    echo [WARN] uvicorn not found. The Flipper backend will not start.
    echo        Advanced features ^(scoring, triangular arb, forecasts^) will be unavailable.
    if !PYTHON_AVAILABLE! equ 1 (
        echo        Install with: !PY_CMD! -m pip install -r requirements.txt
    ) else (
        echo        Install Python 3 and then: pip install -r requirements.txt
    )
    echo.
)

REM ---- Install Python dependencies ----
if !PYTHON_AVAILABLE! equ 1 (
    echo [INFO] Checking Python dependencies...
    !PY_CMD! -m pip install -q -r requirements.txt 2>nul
    if !ERRORLEVEL! equ 0 (
        echo [OK] Python dependencies ready.
    ) else (
        echo [WARN] Some Python dependencies may be missing.
        echo        Run manually: !PY_CMD! -m pip install -r requirements.txt
    )
    echo.
)

REM ---- Check .env.local ----
REM WS env vars were removed in iter 58 (P0-2 + P1-1 + P1-2) - the frontend
REM now uses SSE for real-time price updates and REST polling for everything
REM else. No NEXT_PUBLIC_FLIPPER_WS_* variables are needed anymore.
if not exist ".env.local" (
    echo [INFO] .env.local not found. Creating with default settings...
    echo # PoE2 API Base URL (iter 103: api.poe2scout.com subdomain is DEAD - use bare domain)> .env.local
    echo POE2_API_BASE_URL=https://poe2scout.com/api>> .env.local
    echo # Flipper backend URL (server-side only)>> .env.local
    echo FLIPPER_API_URL=http://localhost:8000>> .env.local
    echo.
    echo [OK] .env.local created with poe2scout.com/api
    echo.
) else (
    echo [OK] .env.local found.
    REM Verify POE2_API_BASE_URL is NOT the dead api.poe2scout.com subdomain
    findstr /C:"api.poe2scout.com" .env.local >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo [WARN] .env.local uses DEAD api.poe2scout.com subdomain^^!
        echo        The api.poe2scout.com host no longer serves the API and returns 404
        echo        for every endpoint. Replace it with the bare domain:
        echo        POE2_API_BASE_URL=https://poe2scout.com/api
        echo        See STATUS.md KI-15 for details.
        echo.
    )
)

REM ---- Kill any existing servers on ports 3000 and 8000 ----
echo [INFO] Checking for existing server on port 3000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo [INFO] Found process %%a on port 3000. Terminating...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 1 /nobreak >nul
)
echo [OK] Port 3000 is free.

echo [INFO] Checking for existing server on port 8000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo [INFO] Found process %%a on port 8000. Terminating...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 1 /nobreak >nul
)
echo [OK] Port 8000 is free.
echo.

REM ---- Start FastAPI backend ----
REM By default, the backend is managed by Next.js via the flipper-backend-bridge
REM (instrumentation.ts). The bridge auto-starts Python, monitors health, and
REM restarts on crash. This eliminates the "backend dies after startup" problem.
REM
REM Use --no-bridge flag to start backend separately (old behavior).
REM The bridge uses taskkill /PID /T /F on Windows for reliable cleanup.
set USE_BRIDGE=1
if "%~1"=="--no-bridge" (
    set USE_BRIDGE=0
    echo [INFO] --no-bridge flag: backend will be started separately.
)

if !UVICORN_AVAILABLE! equ 1 (
    if !USE_BRIDGE! equ 1 (
        echo [INFO] Flipper backend will be managed by Next.js bridge ^(auto-start + auto-restart^).
        echo        The bridge starts the Python process when Next.js starts.
        echo        If the backend crashes, it will be restarted automatically.
        echo        Bridge logs: console output (Next.js server log)
        echo.
        REM Set FLIPPER_BRIDGE_DISABLED=false explicitly to ensure bridge is enabled
        set FLIPPER_BRIDGE_DISABLED=false
    ) else (
        echo [INFO] Starting FastAPI Flipper backend separately ^(--no-bridge mode^)...
        set PYTHONPATH=%~dp0
        start /b !PY_CMD! -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 > flipper-backend.log 2>&1

        REM Wait for backend to start with retry loop (up to 20 seconds)
        set _BACKEND_OK=0
        for /L %%i in (1,1,20) do (
            if !_BACKEND_OK! equ 0 (
                timeout /t 1 /nobreak >nul
                powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8000/api/health' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
                if !ERRORLEVEL! equ 0 (
                    set _BACKEND_OK=1
                    echo [OK] Flipper backend started on http://localhost:8000 ^(after %%i seconds^)
                )
            )
        )
        if !_BACKEND_OK! equ 0 (
            echo [WARN] Flipper backend may not have started after 20 seconds.
            echo        Check flipper-backend.log for errors.
            echo        The bridge mode ^(default^) is more reliable — try without --no-bridge.
        )
        echo.
        REM Disable bridge since we started backend separately
        set FLIPPER_BRIDGE_DISABLED=true
    )
)
if !UVICORN_AVAILABLE! equ 0 (
    echo [SKIP] Flipper backend not started ^(uvicorn not available^).
    echo        Advanced features ^(scoring, triangular arb, forecasts^) will be unavailable.
    set FLIPPER_BRIDGE_DISABLED=true
    echo.
)

REM ---- Install dependencies if needed ----
if not exist "node_modules\" (
    echo [INFO] node_modules not found. Installing dependencies...
    echo This may take a few minutes on first run
    echo.
    call npm install
    if !ERRORLEVEL! neq 0 (
        echo.
        echo [ERROR] npm install failed!
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependencies installed successfully.
    echo.
) else (
    echo [OK] Dependencies already installed.
    echo.
    REM Verify all dependencies are present (catches cases where package.json was
    REM updated but npm install wasn't re-run, e.g. new fuse.js dependency).
    echo [INFO] Verifying npm dependencies...
    call npm ls --depth=0 --silent >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo [WARN] Some npm dependencies are missing. Running npm install...
        call npm install
        if !ERRORLEVEL! neq 0 (
            echo.
            echo [ERROR] npm install failed!
            echo.
            pause
            exit /b 1
        )
        echo [OK] Missing dependencies installed.
    )
    echo.
)

REM ---- Handle flags ----

REM ---- --clean flag: deep clean ----
if "%~1"=="--clean" (
    echo [INFO] --clean flag: deep cleaning...
    if exist ".next\" (
        rmdir /s /q ".next" 2>nul
        echo [OK] Removed .next\
    )
    if exist "node_modules\" (
        rmdir /s /q "node_modules" 2>nul
        echo [OK] Removed node_modules\
    )
    if exist ".venv\" (
        rmdir /s /q ".venv" 2>nul
        echo [OK] Removed .venv\
    )
    echo [INFO] Reinstalling dependencies...
    call npm install
    if !ERRORLEVEL! neq 0 (
        echo.
        echo [ERROR] npm install failed after --clean!
        echo.
        pause
        exit /b 1
    )
    echo [OK] npm dependencies reinstalled successfully.
    REM Recreate venv and install Python deps
    if !PYTHON_AVAILABLE! equ 1 (
        echo [INFO] Recreating Python venv and installing deps...
        python -m venv .venv >nul 2>&1
        .venv\Scripts\python.exe -m pip install -q -r requirements.txt
        set PY_CMD=.venv\Scripts\python.exe
        echo [OK] Python venv recreated and deps installed.
    )
    echo.
)

if "%~1"=="--dev" (
    echo [INFO] Starting in DEVELOPMENT mode ^(--dev flag^)
    echo.

    REM Start FastAPI with --reload in dev mode
    if !UVICORN_AVAILABLE! equ 1 (
        echo [INFO] Restarting Flipper backend with --reload for dev mode...
        for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
            taskkill /PID %%a /F >nul 2>&1
        )
        timeout /t 1 /nobreak >nul
        set PYTHONPATH=%~dp0
        start /b !PY_CMD! -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 > flipper-backend.log 2>&1
        timeout /t 2 /nobreak >nul
        echo [OK] Flipper backend restarted with --reload
        echo.
    )

    REM Disable bridge in dev mode (uvicorn --reload handles restarts)
    set FLIPPER_BRIDGE_DISABLED=true

    echo ============================================================
    echo   Starting PoE2 Market Dashboard - DEV MODE
    echo   Open your browser: http://localhost:3000
    echo.
    echo   Flipper backend: http://localhost:8000
    echo   Press Ctrl+C to stop the server.
    echo ============================================================
    echo.
    call npm run dev
    goto :cleanup
)

REM ---- Clean .next directory ----
REM Always clean .next to prevent stale chunk hashes from causing 404 errors.
REM This is the #1 fix for "Failed to load resource: 404" errors.
if "%~1"=="--skip-build" (
    echo [INFO] Skipping build and cleanup ^(--skip-build flag^)
    echo.
    goto :build_done
)

echo [INFO] Cleaning .next directory to prevent stale builds...
if exist ".next\" (
    rmdir /s /q ".next" 2>nul
    if exist ".next\" (
        echo [WARN] Could not fully remove .next - some files may be locked.
        echo         Try closing any running Next.js server first.
    )
    if not exist ".next\" (
        echo [OK] .next directory cleaned.
    )
)
if not exist ".next\" (
    echo [OK] .next directory does not exist - clean start.
)
echo.

REM ---- Build project ----
echo [INFO] Building project...
echo This ensures you have the latest code compiled.
echo.
call npm run build
if !ERRORLEVEL! neq 0 (
    echo.
    echo [ERROR] Build failed! Check the errors above.
    echo.
    echo [TIP] You can try:
    echo       1. start.bat --dev       - development mode, no build needed
    echo       2. start.bat --skip-build - skip build, use existing .next
    echo.
    pause
    exit /b 1
)
echo.
echo [OK] Build completed successfully.
echo.

:build_done

REM ---- Verify .next directory exists ----
if not exist ".next\" (
    echo.
    echo [ERROR] .next directory not found after build!
    echo This means the build did not complete properly.
    echo Try running: npm run build
    echo Or use: start.bat --dev
    echo.
    pause
    exit /b 1
)

REM ---- Start the server ----
echo ============================================================
echo   Starting PoE2 Market Dashboard...
echo   Open your browser: http://localhost:3000
echo.
echo   Flipper backend: http://localhost:8000
echo   Bridge logs: console output (Next.js server log)
echo.
echo   IMPORTANT: If you see 404 errors in browser after a rebuild:
echo     1. Hard-refresh: Ctrl+Shift+R ^(^or Ctrl+F5^)
echo     2. Clear browser cache: Ctrl+Shift+Delete
echo     3. Or open DevTools ^> Application ^> Storage ^> Clear site data
echo.
echo   If you see 502/404 errors, edit .env.local and make sure it uses the
echo   bare domain (NOT the dead api. subdomain):
echo     POE2_API_BASE_URL=https://poe2scout.com/api
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================================
echo.

set NODE_ENV=production

REM Start the server - cleanup is handled automatically:
REM When this CMD window closes, Windows terminates
REM the entire process tree including child node processes.
REM We also kill port 3000 at the start of this script.
REM The bridge handles Python process cleanup via taskkill on Windows.
call npm run start

:cleanup
REM ---- Cleanup: kill the Flipper backend ----
echo.
echo [INFO] Cleaning up...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo [INFO] Terminating Flipper backend ^PID %%a^...
    taskkill /PID %%a /F >nul 2>&1
)

REM If next start exits unexpectedly, keep the window open
echo.
echo [INFO] Server has stopped.
echo.
pause
