@echo off
title DZ-Time — Sovereign Labor Hours & Work Tracking Studio (Toggl Alternative)
cd /d "%~dp0\apps\productivity\dz-time"

echo ================================================================
echo DZ-Time — Sovereign Labor Hours & Work Tracking Studio
echo Conforming to Algerian Labor Law 90-11
echo Starting local native server on port 3023...
echo ================================================================

:: Start node server in background if not already running on port 3023
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3023 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window
start "" msedge.exe --app="http://localhost:3023" --window-size=1400,900 || start "" chrome.exe --app="http://localhost:3023" || start http://localhost:3023

exit
