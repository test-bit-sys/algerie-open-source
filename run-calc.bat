@echo off
title DZ-Calc Pro — The Algerian Open-Source Spreadsheet Studio (Excel Alternative)
cd /d "%~dp0\apps\office-suite\dz-calc"

echo ================================================================
echo DZ-Calc Pro — Sovereign Spreadsheet & Financial Studio
echo Starting local native server on port 3007...
echo ================================================================

:: Start node server in background if not already running on port 3007
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3007 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3007" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3007" || start http://localhost:3007

exit
