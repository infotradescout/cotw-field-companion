@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  echo Extract the whole GrindZone installation folder before starting INSTALL.cmd.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0updates\install.mjs" --open
if errorlevel 1 pause
