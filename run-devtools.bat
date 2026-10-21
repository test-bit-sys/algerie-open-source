@echo off
title DZ-DevTools Pro — The Algerian Open-Source Developer Suite (CyberChef & DevToys Alternative)
cd /d "%~dp0\apps\developer-tools\dz-devtools"

echo ================================================================
echo DZ-DevTools Pro — Sovereign Developer & Algerian Data Suite
echo Starting local native server on port 3009...
echo ================================================================

:: Start node server in background if not already running on port 3009
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3009 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3009" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3009" || start http://localhost:3009

exit
