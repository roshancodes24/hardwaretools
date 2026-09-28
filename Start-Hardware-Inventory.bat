@echo off
setlocal
title Hardware Inventory System

REM Always run from this .bat's folder (must live in the project root)
cd /d "%~dp0"
if errorlevel 1 (
  echo Could not open folder: %~dp0
  goto :fail
)

echo.
echo Project folder: %CD%
echo.

if not exist "package.json" (
  echo ERROR: package.json not found here.
  echo.
  echo This .bat must stay inside the project folder
  echo ^(same place as package.json and .env^).
  echo.
  echo Do NOT copy the .bat to the Desktop.
  echo Create a Desktop SHORTCUT to this file instead:
  echo   Right-click this .bat - Send to - Desktop ^(create shortcut^)
  echo.
  goto :fail
)

if not exist ".env" (
  echo ERROR: Missing .env in the project folder.
  echo Copy .env.example to .env and set DATABASE_URL.
  echo.
  goto :fail
)

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm was not found.
  echo Install Node.js 20+ and tick "Add to PATH", then restart the PC.
  echo.
  goto :fail
)

echo Starting Hardware Inventory (dev)...
echo   UI:  http://localhost:5173
echo   API: http://localhost:4000
echo.
echo Leave this window open while you use the app.
echo Close it ^(or press Ctrl+C^) to stop the server.
echo.

REM Open browser after a delay so Vite can start
start "" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:5173/"

call npm run dev:all
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" (
  echo Server stopped with error code %EXITCODE%.
) else (
  echo Server stopped.
)
echo.
pause
exit /b %EXITCODE%

:fail
echo.
pause
exit /b 1
