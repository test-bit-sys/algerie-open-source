@echo off
title DZ-DiskTree — The Algerian Open-Source Disk Space Analyzer
cd /d "%~dp0\apps\productivity\dz-disk-tree"

echo =======================================================
echo DZ-DiskTree — High-Performance PC Disk Space Analyzer
echo Starting local native server on port 3001...
echo =======================================================

:: Start node server in background if not running
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3001" --window-size=1366,850 || start "" chrome.exe --app="http://localhost:3001" || start http://localhost:3001

exit
