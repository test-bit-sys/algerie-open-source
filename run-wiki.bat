@echo off
title DZ-Wiki — Sovereign Knowledge Base & Wiki Studio (Notion & Obsidian Alternative)
cd /d "%~dp0\apps\productivity\dz-wiki"

echo ================================================================
echo DZ-Wiki — Sovereign Knowledge Base & Wiki Studio
echo Starting local native server on port 3028...
echo ================================================================

:: Start node server in background if not already running on port 3028
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3028 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window
start "" msedge.exe --app="http://localhost:3028" --window-size=1400,900 || start "" chrome.exe --app="http://localhost:3028" || start http://localhost:3028

exit
