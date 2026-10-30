@echo off
rem Double-click: signed AAB for Google Play. APK for your phone: build-android.cmd -Mode DebugApk
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-android.ps1" %*
echo.
pause
