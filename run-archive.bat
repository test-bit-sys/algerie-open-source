@echo off
title DZ-Archive Pro — The Algerian Open-Source PC Archive & Compression Tool
cd /d "%~dp0\apps\productivity\dz-archive"

echo ================================================================
echo DZ-Archive Pro — WinRAR 1:1 Desktop Alternative
echo Starting local native server on port 3002...
echo ================================================================

:: Start node server in background if not running
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window (without browser URL bar)
start "" msedge.exe --app="http://localhost:3002" --window-size=1280,820 || start "" chrome.exe --app="http://localhost:3002" || start http://localhost:3002

exit
