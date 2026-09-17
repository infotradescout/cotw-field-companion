@echo off
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
node launcher.mjs --open
pause
