param(
  [string]$OutPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if ($OutPath) {
    node scripts/backup-database.mjs $OutPath
  } else {
    node scripts/backup-database.mjs
  }
} finally {
  Pop-Location
}
