# Regenerate docs/USER_GUIDE.docx and docs/USER_GUIDE.pdf from docs/USER_GUIDE.md
# Renders Mermaid diagrams to PNG (requires Node + npx), then Pandoc + Chrome.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$md = Join-Path $root "docs\USER_GUIDE.md"
$processed = Join-Path $root "docs\_USER_GUIDE_processed.md"
$docx = Join-Path $root "docs\USER_GUIDE.docx"
$pdf = Join-Path $root "docs\USER_GUIDE.pdf"

if (-not (Test-Path $md)) {
  Write-Error "Not found: $md"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js is required to render Mermaid flowcharts. Install from https://nodejs.org"
}

Write-Host "Rendering Mermaid diagrams to PNG..."
Push-Location $root
try {
  & node "scripts\render-user-guide-mermaid.js" "$md" "$processed"
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

$printHtml = Join-Path $root "docs\_USER_GUIDE_print.html"
Write-Host "Writing HTML for PDF (next to assets so images resolve) ..."
Push-Location $root
try {
  & pandoc $processed -o $printHtml --standalone --embed-resources --metadata title="Hardware Inventory User Guide" --resource-path="docs"
} finally {
  Pop-Location
}

Remove-Item $processed -Force -ErrorAction SilentlyContinue

$chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
  $chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chrome)) {
  Write-Warning "Chrome not found; skipping PDF. Install Google Chrome or print docs/USER_GUIDE.docx to PDF manually."
  Remove-Item $printHtml -Force -ErrorAction SilentlyContinue
  exit 0
}

$url = ([System.Uri]((Resolve-Path $printHtml).Path)).AbsoluteUri
Write-Host "Writing $pdf ..."
& $chrome --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$pdf" $url
Start-Sleep -Seconds 2

Remove-Item $printHtml -Force -ErrorAction SilentlyContinue
Write-Host "Done."
