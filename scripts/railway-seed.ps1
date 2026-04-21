# Same as railway-seed.cmd; uses -ExecutionPolicy Bypass for the inner seed only.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  Write-Host "Railway CLI not found. Install: npm install -g @railway/cli" -ForegroundColor Red
  exit 1
}
railway whoami 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Run: railway login" -ForegroundColor Yellow
  exit 1
}

Write-Host "Running seed (public DB URL when available)..." -ForegroundColor Cyan
& railway run powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "railway-seed-inner.ps1")
exit $LASTEXITCODE
