# Stop FinAlly (Windows PowerShell 5.1+). Keeps the finally-data volume, so your data persists.
# Safe to run more than once.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\stop_windows.ps1

$ErrorActionPreference = "Continue"

Set-Location (Split-Path -Parent $PSScriptRoot)

docker compose down
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Host "docker compose down failed (exit $code). Is Docker running?"
    exit $code
}

Write-Host "FinAlly stopped. Your data is kept in the finally-data volume."
exit 0
