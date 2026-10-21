@echo off
title DZ-Games — Sovereign Algerian Board Games Suite
cls

:menu
echo ================================================================
echo    DZ-Games Suite — الالعاب التفاعلية والتراثية الجزائرية
echo ================================================================
echo.
echo   [1] DZ-Chess      - الشطرنج الجزائري مع الذكاء الاصطناعي (Port 3012)
echo   [2] DZ-Dama       - الدامة الجزائرية الشعبية (Port 3013)
echo   [3] DZ-Domino     - دومينو المقاهي والبطولات (Port 3014)
echo   [4] DZ-Tawla      - طاولة الزهر / باك غامون (Port 3015)
echo   [5] DZ-Puissance4 - قوة 4 التكتيكية (Port 3016)
echo   [6] DZ-Othello    - أوتيلو / ريفيرسي الاستراتيجية (Port 3017)
echo   [0] خروج
echo.
echo ================================================================
set /p choice="اختر رقم اللعبة لتشغيلها: "

if "%choice%"=="1" (
    set APP_DIR=apps\games-interactive\dz-chess
    set PORT=3012
    set NAME=DZ-Chess
    goto launch
)
if "%choice%"=="2" (
    set APP_DIR=apps\games-interactive\dz-dama
    set PORT=3013
    set NAME=DZ-Dama
    goto launch
)
if "%choice%"=="3" (
    set APP_DIR=apps\games-interactive\dz-domino
    set PORT=3014
    set NAME=DZ-Domino
    goto launch
)
if "%choice%"=="4" (
    set APP_DIR=apps\games-interactive\dz-tawla
    set PORT=3015
    set NAME=DZ-Tawla
    goto launch
)
if "%choice%"=="5" (
    set APP_DIR=apps\games-interactive\dz-puissance4
    set PORT=3016
    set NAME=DZ-Puissance4
    goto launch
)
if "%choice%"=="6" (
    set APP_DIR=apps\games-interactive\dz-othello
    set PORT=3017
    set NAME=DZ-Othello
    goto launch
)
if "%choice%"=="0" exit
goto menu

:launch
cd /d "%~dp0\%APP_DIR%"
echo Starting %NAME% on port %PORT%...
powershell -Command "if (!(Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"
timeout /t 1 /nobreak >nul
start "" msedge.exe --app="http://localhost:%PORT%" --window-size=1200,850 || start "" chrome.exe --app="http://localhost:%PORT%" || start http://localhost:%PORT%
exit
