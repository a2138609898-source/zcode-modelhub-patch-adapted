@echo off
chcp 65001 >nul
set RES=C:\Users\86158\AppData\Local\Programs\ZCode\resources
echo ============================================
echo  model-hub 补丁 - 还原官方原版
echo  即将自动关闭 ZCode，还原后自动重启
echo ============================================
echo.
taskkill /IM ZCode.exe /F >nul 2>&1
timeout /t 3 /nobreak >nul
copy /y "%RES%\app.asar.modelhub-backup" "%RES%\app.asar.modelhub-restore-tmp"
move /y "%RES%\app.asar.modelhub-restore-tmp" "%RES%\app.asar"
if errorlevel 1 (
  echo.
  echo [x] 还原失败：ZCode 可能仍在运行，请稍后重试本脚本。
  pause
  exit /b 1
)
echo.
echo [√] 已还原官方原版 app.asar（备份保留）。正在启动 ZCode...
start "" "C:\Users\86158\AppData\Local\Programs\ZCode\ZCode.exe"
timeout /t 3 /nobreak >nul
