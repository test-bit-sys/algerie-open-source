@echo off
title DZ-Recorder — Sovereign Screen & Webcam Studio (Camtasia Alternative)
cd /d "%~dp0\apps\video-montage\dz-recorder"

echo ================================================================
echo DZ-Recorder — Sovereign Screen & Webcam Recording Studio
echo Starting local native server on port 3018...
echo ================================================================

:: Start node server in background if not already running on port 3018
powershell -Command "if (!(Get-NetTCPConnection -LocalPort 3018 -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"

:: Wait 1 second for port to bind
timeout /t 1 /nobreak >nul

:: Launch as a Standalone Native Windows Desktop App Window
start "" msedge.exe --app="http://localhost:3018" --window-size=1400,880 || start "" chrome.exe --app="http://localhost:3018" || start http://localhost:3018

exit
