# Regenerate docs/<Name>.docx (and optionally .pdf) from docs/<Name>.md
# Renders Mermaid diagrams to PNG (requires Node + npx), then Pandoc + Chrome.
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/export-doc.ps1 -DocName USER_GUIDE
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/export-doc.ps1 -DocName FRD
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/export-doc.ps1 -DocName FSD
#
# Optional: -Title "Custom Pandoc metadata title"

param(
  [Parameter(Mandatory = $true)]
  [string]$DocName,
  [string]$Title = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$DocName = $DocName.Trim()
if ($DocName -notmatch '^[A-Za-z0-9_-]+$') {
  Write-Error "Invalid -DocName: $DocName"
}

$md = Join-Path $root "docs\$DocName.md"
$processed = Join-Path $root "docs\_${DocName}_processed.md"
$docx = Join-Path $root "docs\$DocName.docx"
$pdf = Join-Path $root "docs\$DocName.pdf"
$assetPrefix = ($DocName.ToLower() -replace '_', '-') + "-flow"

if (-not $Title) {
  $Title = "Hardware Inventory - $DocName"
}

if (-not (Test-Path $md)) {
  Write-Error "Not found: $md"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js is required to render Mermaid flowcharts. Install from https://nodejs.org"
}

Write-Host "Rendering Mermaid diagrams to PNG ($assetPrefix)..."
Push-Location $root
try {
  & node "scripts\render-user-guide-mermaid.js" "$md" "$processed" "$assetPrefix"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Mermaid render failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$pandoc = Get-Command pandoc -ErrorAction SilentlyContinue
if (-not $pandoc) {
  Write-Error "Pandoc not found. Install from https://pandoc.org or: winget install JohnMacFarlane.Pandoc"
}

Write-Host "Writing $docx ..."
Push-Location $root
try {
  & pandoc $processed -o $docx --resource-path="docs"
} finally {
  Pop-Location
}

$printHtml = Join-Path $root "docs\_${DocName}_print.html"
Write-Host "Writing HTML for PDF (next to assets so images resolve) ..."
Push-Location $root
try {
  & pandoc $processed -o $printHtml --standalone --embed-resources --metadata title="$Title" --resource-path="docs"
} finally {
  Pop-Location
}

Remove-Item $processed -Force -ErrorAction SilentlyContinue

$chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
  $chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chrome)) {
  Write-Warning "Chrome not found; skipping PDF. Install Google Chrome or print docs/$DocName.docx to PDF manually."
  Remove-Item $printHtml -Force -ErrorAction SilentlyContinue
  Write-Host "Done (docx only)."
  exit 0
}

$url = ([System.Uri]((Resolve-Path $printHtml).Path)).AbsoluteUri
Write-Host "Writing $pdf ..."
& $chrome --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$pdf" $url
Start-Sleep -Seconds 2

Remove-Item $printHtml -Force -ErrorAction SilentlyContinue
Write-Host "Done."
