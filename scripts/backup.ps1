param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'backup.mjs'
& node $scriptPath $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw 'Encrypted backup failed. See docs/BACKEND.md for prerequisites.' }
