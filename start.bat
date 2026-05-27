@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

cd /d "%~dp0"

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
echo [OK] Node.js found: %NODE_VERSION%
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

REM ---- Install dependencies if needed ----
if not exist "node_modules\" (
    echo [INFO] node_modules not found. Installing dependencies...
    echo This may take a few minutes on first run...
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

REM ---- Build project (always rebuild) ----
if "%1"=="--skip-build" (
    echo [INFO] Skipping build (--skip-build flag provided).
    echo.
) else (
    echo [INFO] Building project...
    echo This ensures you have the latest code compiled.
    echo.
    call npm run build
    if !ERRORLEVEL! neq 0 (
        echo.
        echo [ERROR] Build failed! Check the errors above.
        echo.
        echo [TIP] If you see TypeScript errors, you can try running with:
        echo       start.bat --skip-build
        echo       and then use 'npm run dev' for development mode instead.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Build completed successfully.
    echo.
)

REM ---- Verify .next directory exists ----
if not exist ".next\" (
    echo.
    echo [ERROR] .next directory not found after build!
    echo This means the build did not complete properly.
    echo Try running 'npm run build' manually to see errors.
    echo.
    pause
    exit /b 1
)

REM ---- Start the server ----
echo ============================================================
echo   Starting PoE2 Market Dashboard...
echo   Open your browser: http://localhost:3000
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================================
echo.

set NODE_ENV=production

REM Use npm run start instead of npx next start for reliability
call npm run start
if !ERRORLEVEL! neq 0 (
    echo.
    echo [ERROR] Server failed to start! Error code: !ERRORLEVEL!
    echo.
    echo [TIP] Common fixes:
    echo   1. Port 3000 may be in use - close other apps or change port
    echo   2. Try running: npm run dev
    echo   3. Delete .next folder and run start.bat again
    echo.
    pause
    exit /b 1
)

REM If next start exits unexpectedly, keep the window open
echo.
echo [INFO] Server has stopped.
echo.
pause
