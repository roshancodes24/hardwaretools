@echo off
REM Run the API + built web UI on one port (default 4000). Requires Node.js on PATH.
REM Set DATABASE_URL in .env in the project root (or environment) before first use.

cd /d "%~dp0\.."

if not exist "frontend\dist\index.html" (
  echo Build the web app first: npm run build:frontend
  pause
  exit /b 1
)

if not exist ".env" (
  echo Create a .env file in the project root with at least:
  echo   DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/DATABASE
  echo   JWT_SECRET=your-long-random-secret
  pause
  exit /b 1
)

echo Applying database migrations...
call npx prisma migrate deploy
if errorlevel 1 (
  echo migrate deploy failed.
  pause
  exit /b 1
)

echo Starting server (API + web at http://localhost:4000 )...
set NODE_ENV=production
set SERVE_FRONTEND=1
call npx tsx src/server.ts
pause
