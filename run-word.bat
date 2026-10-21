@echo off
title DZ-Word Pro — The Algerian Open-Source Word Processor (Microsoft Word Alternative)
cd /d "%~dp0\apps\office-suite\dz-word"

echo ================================================================
echo DZ-Word Pro — Sovereign Document Studio & Word Processor
echo Starting local native server on port 3006...
echo ================================================================

:: Start node server in background if not already running on port 3006
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3006 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3006" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3006" || start http://localhost:3006

exit
