@echo off
chcp 65001 > nul
title DZ-API Studio - بيئة تطوير واختبار واجهات البرمجة السيادية
cls
echo ========================================================
echo        ⚡ DZ-API Studio - منصة واجهات البرمجة السيادية
echo        Sovereign REST & GraphQL API Client (Postman Alternative)
echo ========================================================
echo.
echo [1/2] التحقق من بيئة Node.js...
node -v > nul 2>&1
if %errorlevel% neq 0 (
    echo [خطأ] Node.js غير مثبت في النظام!
    pause
    exit /b 1
)

echo [2/2] تشغيل خادم DZ-API Studio المحلي على المنفذ 3031...
echo الرابط: http://localhost:3031
echo.
echo سيتم فتح المتصفح تلقائياً...
start http://localhost:3031

node apps/developer-tools/dz-api/server.js
pause
