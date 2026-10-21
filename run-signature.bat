@echo off
title DZ-Signature — Sovereign Document Digital Signing & Official Seals
cd /d "%~dp0\apps\office-suite\dz-signature"

echo ================================================================
echo DZ-Signature — Sovereign Document Digital Signing & Official Seals
echo Starting local native server on port 3022...
echo ================================================================

:: Start node server in background if not already running on port 3022
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3022 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window
start "" msedge.exe --app="http://localhost:3022" --window-size=1400,900 || start "" chrome.exe --app="http://localhost:3022" || start http://localhost:3022

exit
