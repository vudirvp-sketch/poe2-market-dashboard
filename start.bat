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

REM ---- Kill any existing Next.js server on port 3000 ----
echo [INFO] Checking for existing server on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo [INFO] Found process %%a on port 3000. Terminating...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 1 /nobreak >nul
)
echo [OK] Port 3000 is free.
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

REM ---- Build project ----
REM Use --skip-build flag to skip:  start.bat --skip-build
if "%~1"=="--skip-build" (
    echo [INFO] Skipping build ^(--skip-build flag provided^).
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

REM Start the server — cleanup is handled automatically:
REM When this CMD window closes (X button), Windows terminates
REM the entire process tree including child node processes.
REM We also kill port 3000 at the start of this script.
call npm run start

REM If next start exits unexpectedly, keep the window open
echo.
echo [INFO] Server has stopped.
echo.
pause
