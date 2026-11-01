@echo off
REM Double-click to start Maestro on Windows.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Maestro needs Node.js ^(free^). Opening the download page...
  echo Install the LTS version, then double-click "Start Maestro" again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node bin\maestro.js start
pause
