@echo off
title DZ-Impress Pro — The Algerian Open-Source Presentation Studio & PowerPoint Desktop Alternative
cd /d "%~dp0\apps\office-suite\dz-slides"

echo ================================================================
echo DZ-Impress Pro — Open-Source Presentation Studio (PowerPoint Alternative)
echo Starting local native server on port 3008...
echo ================================================================

:: Start node server in background if not already running on port 3008
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3008 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3008" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3008" || start http://localhost:3008

exit
