@echo off
chcp 65001 > nul
title DZ-Inventory - نظام إدارة المخزون والمستودعات والباركود السيادي
cls
echo ========================================================
echo        📦 DZ-Inventory - منصة إدارة المخزون والمستودعات
echo        Sovereign Stock, Warehouse & SKU Management
echo ========================================================
echo.
echo [1/2] التحقق من بيئة Node.js...
node -v > nul 2>&1
if %errorlevel% neq 0 (
    echo [خطأ] Node.js غير مثبت في النظام!
    pause
    exit /b 1
)

echo [2/2] تشغيل خادم DZ-Inventory المحلي على المنفذ 3030...
echo الرابط: http://localhost:3030
echo.
echo سيتم فتح المتصفح تلقائياً...
start http://localhost:3030

node apps/business-enterprise/dz-inventory/server.js
pause
