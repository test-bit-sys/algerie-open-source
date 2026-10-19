@echo off
title DZ-Impress Pro — The Algerian Open-Source Presentation Studio
cd /d "%~dp0"

echo ================================================================
echo DZ-Impress Pro — Presentation Studio & Slideshow
echo Starting local native server on port 3008...
echo ================================================================

powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3008 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"
timeout /t 1 /nobreak >nul
start "" msedge.exe --app="http://localhost:3008" --window-size=1440,900 || start "" chrome.exe --app="http://localhost:3008" || start http://localhost:3008
exit
