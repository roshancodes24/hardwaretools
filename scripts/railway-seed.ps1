# Run Prisma seed against Railway Postgres (uses service env from `railway link`).
# Prerequisite: `npm install -g @railway/cli`, then `railway login` and `railway link` from repo root.

$ErrorActionPreference = "Stop"
# Repo root (parent of `scripts/`)
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  Write-Host "Railway CLI not found. Install with: npm install -g @railway/cli" -ForegroundColor Red
  exit 1
}

railway whoami 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged in. Run: railway login" -ForegroundColor Yellow
  exit 1
}

Write-Host "Running seed with Railway environment..." -ForegroundColor Cyan
railway run npm run seed
exit $LASTEXITCODE
