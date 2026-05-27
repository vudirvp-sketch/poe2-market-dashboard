@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM PoE2 Market Dashboard — Auto-start script for Windows
REM ============================================================
REM
REM To auto-start on login:
REM 1. Press Win+R -> type "shell:startup" -> Enter
REM 2. Create a shortcut to this .bat file in that folder
REM 3. Or just double-click this file to run manually
REM
REM To stop: close this window or press Ctrl+C
REM ============================================================

cd /d "%~dp0"

echo ============================================================
echo   PoE2 Market Dashboard - Launcher
echo ============================================================
echo.

REM ----------------------------------------------------------
REM Step 1: Check for Node.js
REM ----------------------------------------------------------
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo [OK] Node.js found: %NODE_VERSION%
echo.

REM ----------------------------------------------------------
REM Step 2: Check for npm
REM ----------------------------------------------------------
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not found.
    echo Please reinstall Node.js with npm included.
    echo.
    pause
    exit /b 1
)

echo [OK] npm found.
echo.

REM ----------------------------------------------------------
REM Step 3: Install dependencies if needed
REM ----------------------------------------------------------
if not exist "node_modules\" (
    echo [INFO] node_modules not found. Installing dependencies...
    echo This may take a few minutes on first run...
    echo.
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] npm install failed! Check the errors above.
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

REM ----------------------------------------------------------
REM Step 4: Build project if needed
REM ----------------------------------------------------------
if not exist ".next\BUILD_ID" (
    echo [INFO] Build not found or incomplete. Building project...
    echo This may take a few minutes on first run...
    echo.
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERROR] Build failed! Check the errors above.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Build completed successfully.
    echo.
) else (
    echo [OK] Build already exists.
    echo.
)

REM ----------------------------------------------------------
REM Step 5: Start the server
REM ----------------------------------------------------------
echo ============================================================
echo   Starting PoE2 Market Dashboard...
echo   Open your browser: http://localhost:3000
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================================
echo.

set NODE_ENV=production
call npx next start -p 3000

REM If next start exits unexpectedly, keep the window open
echo.
echo [INFO] Server has stopped.
echo.
pause
