@echo off
REM ============================================================
REM PoE2 Market Dashboard — Auto-start script for Windows
REM ============================================================
REM
REM To auto-start on login:
REM 1. Press Win+R → type "shell:startup" → Enter
REM 2. Create a shortcut to this .bat file in that folder
REM 3. Or just double-click this file to run manually
REM
REM To stop: close this window or press Ctrl+C
REM ============================================================

cd /d "%~dp0"

echo Starting PoE2 Market Dashboard...
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM Check if .next build exists
if not exist ".next\" (
    echo Building project (first time)...
    call npm run build
    echo.
)

echo Starting server on http://localhost:3000
echo.
echo Press Ctrl+C to stop the server.
echo.

call npm start
