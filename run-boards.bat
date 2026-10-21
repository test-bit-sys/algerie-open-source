@echo off
title DZ-Boards Pro — The Algerian Open-Source Kanban Studio (Trello & Jira Alternative)
cd /d "%~dp0\apps\collaboration\dz-boards"

echo ================================================================
echo DZ-Boards Pro — Open-Source Project & Kanban Platform
echo Starting local native server on port 3011...
echo ================================================================

:: Start node server in background if not already running on port 3011
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3011 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3011" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3011" || start http://localhost:3011

exit
