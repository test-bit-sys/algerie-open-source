@echo off
title DZ-Calendar — Sovereign Schedule & Appointments Studio (Google Calendar Alternative)
cd /d "%~dp0\apps\collaboration\dz-calendar"

echo ================================================================
echo DZ-Calendar — Sovereign Schedule & Appointments Studio
echo Starting local native server on port 3027...
echo ================================================================

:: Start node server in background if not already running on port 3027
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3027 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window
start "" msedge.exe --app="http://localhost:3027" --window-size=1400,900 || start "" chrome.exe --app="http://localhost:3027" || start http://localhost:3027

exit
