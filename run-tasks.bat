@echo off
title DZ-Tasks — Sovereign Project & Task Planning Studio (ClickUp Alternative)
cd /d "%~dp0\apps\productivity\dz-tasks"

echo ================================================================
echo DZ-Tasks — Sovereign Project & Task Planning Studio
echo Starting local native server on port 3021...
echo ================================================================

:: Start node server in background if not already running on port 3021
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3021 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window
start "" msedge.exe --app="http://localhost:3021" --window-size=1400,900 || start "" chrome.exe --app="http://localhost:3021" || start http://localhost:3021

exit
