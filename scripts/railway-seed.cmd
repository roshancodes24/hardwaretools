@echo off
REM Seed using Railway env. From your PC we need DATABASE_PUBLIC_URL (see railway-seed-inner.ps1).
REM If you see "Multiple services found": run once `railway service link YourWebServiceName`
REM   or set RAILWAY_SERVICE=YourWebServiceName before this script.
cd /d "%~dp0.."
if defined RAILWAY_SERVICE (
  railway run -s "%RAILWAY_SERVICE%" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0railway-seed-inner.ps1"
) else (
  railway run powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0railway-seed-inner.ps1"
)
exit /b %ERRORLEVEL%
