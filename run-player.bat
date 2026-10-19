@echo off
title DZ-Player — The Algerian Open-Source VLC Desktop Alternative
cd /d "%~dp0\apps\multimedia\dz-player"

echo ================================================================
echo DZ-Player — Open-Source VLC Media Player Desktop Alternative
echo Starting local native server on port 3003...
echo ================================================================

:: Start node server in background if not already running on port 3003
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3003 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3003" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3003" || start http://localhost:3003

exit
