@echo off
title DZ-Audio Studio — Sovereign Multitrack Audio Workstation & Sound Engineering (Audacity Alternative)
cd /d "%~dp0\apps\multimedia\dz-audio"

echo ================================================================
echo DZ-Audio Studio — Sovereign Multitrack Audio Workstation
echo Starting local native server on port 3019...
echo ================================================================

:: Start node server in background if not already running on port 3019
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3019 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window
start "" msedge.exe --app="http://localhost:3019" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3019" || start http://localhost:3019

exit
