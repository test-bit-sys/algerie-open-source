@echo off
title DZ-Photo Pro — The Algerian Open-Source Image Editor (Photoshop Alternative)
cd /d "%~dp0\apps\creative-tools\dz-photo"

echo ================================================================
echo DZ-Photo Pro — Sovereign Graphic & Photo Editing Studio
echo Starting local native server on port 3010...
echo ================================================================

:: Start node server in background if not already running on port 3010
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3010 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3010" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3010" || start http://localhost:3010

exit
