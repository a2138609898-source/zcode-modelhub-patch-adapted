@echo off
chcp 65001 >nul
set RES=C:\Users\86158\AppData\Local\Programs\ZCode\resources
echo ============================================
echo  model-hub 补丁适配版 - 最后一步：替换文件
echo  即将自动关闭 ZCode，完成后自动重启
echo ============================================
echo.
taskkill /IM ZCode.exe /F >nul 2>&1
timeout /t 3 /nobreak >nul
move /y "%RES%\app.asar.modelhub-tmp" "%RES%\app.asar"
if errorlevel 1 (
  echo.
  echo [x] 替换失败：ZCode 可能仍在运行，请稍后重试本脚本。
  pause
  exit /b 1
)
del /f /q "%RES%\app.asar.modelhub-new" >nul 2>&1
echo.
echo [√] 补丁安装完成！正在启动 ZCode...
echo     如需卸载：双击桌面「还原补丁.cmd」
start "" "C:\Users\86158\AppData\Local\Programs\ZCode\ZCode.exe"
timeout /t 3 /nobreak >nul
