# Regenerate docs/USER_GUIDE.docx and docs/USER_GUIDE.pdf from docs/USER_GUIDE.md
# Thin wrapper around scripts/export-doc.ps1 for backward compatibility.

$ErrorActionPreference = "Stop"
& "$PSScriptRoot\export-doc.ps1" -DocName "USER_GUIDE" -Title "Hardware Inventory User Guide"
