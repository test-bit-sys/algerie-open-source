@echo off
title DZ-Notes — Sovereign Digital Notebook & Smart Canvas (OneNote Alternative)
cd /d "%~dp0\apps\productivity\dz-notes"

echo ================================================================
echo DZ-Notes — Sovereign Digital Notebook & Smart Canvas
echo Starting local native server on port 3020...
echo ================================================================

:: Start node server in background if not already running on port 3020
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3020 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window
start "" msedge.exe --app="http://localhost:3020" --window-size=1400,900 || start "" chrome.exe --app="http://localhost:3020" || start http://localhost:3020

exit
