@echo off
REM Run Prisma seed with Railway env (after: railway login, railway link from repo root).
cd /d "%~dp0.."
railway run npm run seed
exit /b %ERRORLEVEL%
