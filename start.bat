@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM ============================================================
REM  Global error trap — keep window open on any crash so the
REM  user can read the error instead of the window vanishing.
REM  NOTE: This file MUST use CRLF line endings. Unix LF will
REM  cause CMD to mis-parse setlocal/if blocks, producing
REM  'd', 'EM', 'tlocal' errors.
REM ============================================================
if not defined _TRAP_SET (
    set _TRAP_SET=1
    cmd /k "%~f0" %*
    exit /b
)

echo ============================================================
echo   PoE2 Market Dashboard - Launcher
echo ============================================================
echo.

REM ---- Check Node.js ----
where node >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo [OK] Node.js found: !NODE_VERSION!
echo.

REM ---- Check npm ----
where npm >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [ERROR] npm is not found.
    echo.
    pause
    exit /b 1
)

echo [OK] npm found.
echo.

REM ---- Check for Python / uvicorn (optional) ----
set PYTHON_AVAILABLE=0
set UVICORN_AVAILABLE=0

where python >nul 2>&1
if !ERRORLEVEL! equ 0 (
    set PYTHON_AVAILABLE=1
    echo [OK] Python found.
)

where uvicorn >nul 2>&1
if !ERRORLEVEL! equ 0 (
    set UVICORN_AVAILABLE=1
    echo [OK] uvicorn found.
)

REM Check uvicorn via python -m only if not found directly AND python is available
if !UVICORN_AVAILABLE! equ 0 (
    if !PYTHON_AVAILABLE! equ 1 (
        python -m pip show uvicorn >nul 2>&1
        if !ERRORLEVEL! equ 0 (
            set UVICORN_AVAILABLE=1
            echo [OK] uvicorn found via python -m.
        )
    )
)

if !UVICORN_AVAILABLE! equ 0 (
    echo [WARN] uvicorn not found. The Flipper backend will not start.
    echo        Advanced features ^(scoring, triangular arb, forecasts^) will be unavailable.
    echo        Install with: pip install -r requirements.txt
    echo.
)

REM ---- Install Python dependencies (if pip and uvicorn available) ----
if !PYTHON_AVAILABLE! equ 1 (
    if !UVICORN_AVAILABLE! equ 1 (
        echo [INFO] Checking Python dependencies...
        pip install -q -r requirements.txt 2>nul
        if !ERRORLEVEL! equ 0 (
            echo [OK] Python dependencies ready.
        ) else (
            echo [WARN] Some Python dependencies may be missing.
            echo        Run manually: pip install -r requirements.txt
        )
        echo.
    )
)

REM ---- Check .env.local ----
if not exist ".env.local" (
    echo [INFO] .env.local not found. Creating with default settings...
    echo # PoE2 API Base URL> .env.local
    echo POE2_API_BASE_URL=https://api.poe2scout.com/api>> .env.local
    echo # Flipper backend URL>> .env.local
    echo FLIPPER_API_URL=http://localhost:8000>> .env.local
    echo.
    echo [OK] .env.local created with api.poe2scout.com
    echo.
) else (
    echo [OK] .env.local found.
    echo.
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

REM ---- Start FastAPI backend (if uvicorn available) ----
set FLIPPER_PID=0

if !UVICORN_AVAILABLE! equ 1 (
    echo [INFO] Starting FastAPI Flipper backend on port 8000...
    start /b uvicorn backend.main:app --host 0.0.0.0 --port 8000 > flipper-backend.log 2>&1
    timeout /t 2 /nobreak >nul

    REM Verify backend started
    set _BACKEND_OK=0
    netstat -aon 2>nul | findstr :8000 | findstr LISTENING >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        set _BACKEND_OK=1
        echo [OK] Flipper backend started on http://localhost:8000
    )
    if !_BACKEND_OK! equ 0 (
        echo [WARN] Flipper backend may not have started. Check flipper-backend.log
    )
    echo.
)
if !UVICORN_AVAILABLE! equ 0 (
    echo [SKIP] Flipper backend not started ^(uvicorn not available^).
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
)

REM ---- Handle flags ----
REM Use --dev flag for dev mode: start.bat --dev
REM Use --skip-build flag to skip: start.bat --skip-build
REM Use --clean flag to clean .next before build: start.bat --clean

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
        start /b uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 > flipper-backend.log 2>&1
        timeout /t 2 /nobreak >nul
        echo [OK] Flipper backend restarted with --reload
        echo.
    )

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
echo.
echo   IMPORTANT: If you see 404 errors in browser after a rebuild:
echo     1. Hard-refresh: Ctrl+Shift+R ^(^or Ctrl+F5^)
echo     2. Clear browser cache: Ctrl+Shift+Delete
echo     3. Or open DevTools ^> Application ^> Storage ^> Clear site data
echo.
echo   If you see 502 errors, try editing .env.local:
echo     POE2_API_BASE_URL=https://api.poe2scout.com/api
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================================
echo.

set NODE_ENV=production

REM Start the server - cleanup is handled automatically:
REM When this CMD window closes, Windows terminates
REM the entire process tree including child node processes.
REM We also kill port 3000 at the start of this script.
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
