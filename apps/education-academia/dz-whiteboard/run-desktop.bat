@echo off
title DZ-Whiteboard Pro — The Algerian Open-Source Interactive Whiteboard
cd /d "%~dp0"

echo ================================================================
echo DZ-Whiteboard Pro — Interactive Whiteboard & Classroom Suite
echo Starting local native server on port 3005...
echo ================================================================

:: Start node server in background if not already running on port 3005
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3005 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3005" --window-size=1400,880 || start "" chrome.exe --app="http://localhost:3005" || start http://localhost:3005

exit
