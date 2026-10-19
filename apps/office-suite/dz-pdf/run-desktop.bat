@echo off
title DZ-PDF Pro — The Algerian Open-Source Adobe Acrobat Alternative
cd /d "%~dp0"

echo ================================================================
echo DZ-PDF Pro — Open-Source Adobe Acrobat Desktop Alternative
echo Starting local native server on port 3004...
echo ================================================================

:: Start node server in background if not already running on port 3004
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3004 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3004" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3004" || start http://localhost:3004

exit
