@echo off
REM Seed using Railway env. From your PC we need DATABASE_PUBLIC_URL (see railway-seed-inner.ps1).
cd /d "%~dp0.."
railway run powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0railway-seed-inner.ps1"
exit /b %ERRORLEVEL%
