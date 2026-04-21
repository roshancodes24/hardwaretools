# Invoked only via: railway run powershell ... -File scripts/railway-seed-inner.ps1
# Uses DATABASE_PUBLIC_URL for local seeding when DATABASE_URL is Railway-internal-only.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if ($env:DATABASE_PUBLIC_URL) {
  $env:DATABASE_URL = $env:DATABASE_PUBLIC_URL
}

if ($env:DATABASE_URL -match "railway\.internal") {
  Write-Host @"

Cannot use DATABASE_URL from this PC: it points to postgres.railway.internal
(private Railway network). DNS like that only works inside Railway deployments.

Fix (one-time in Railway dashboard):
  1) Postgres: enable TCP Proxy / public networking (see Railway Postgres settings).
  2) Web service -> Variables -> Add DATABASE_PUBLIC_URL = Variable Reference ->
     your Postgres service -> DATABASE_PUBLIC_URL

Then run scripts\railway-seed.cmd again (or: railway run powershell -NoProfile -ExecutionPolicy Bypass -File scripts\railway-seed-inner.ps1).

"@ -ForegroundColor Yellow
  exit 1
}

npm run seed
exit $LASTEXITCODE
