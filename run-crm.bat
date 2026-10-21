@echo off
title DZ-CRM — Sovereign Sales Pipeline & CRM Studio (Salesforce & HubSpot Alternative)
cd /d "%~dp0\apps\business-enterprise\dz-crm"

echo ================================================================
echo DZ-CRM — Sovereign Sales Pipeline & CRM Studio
echo Starting local native server on port 3029...
echo ================================================================

:: Start node server in background if not already running on port 3029
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3029 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window
start "" msedge.exe --app="http://localhost:3029" --window-size=1400,900 || start "" chrome.exe --app="http://localhost:3029" || start http://localhost:3029

exit
