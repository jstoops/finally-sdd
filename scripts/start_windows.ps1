# Start FinAlly with docker compose (Windows PowerShell 5.1+). Safe to run more than once.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start_windows.ps1 [-Build] [-NoOpen]
#   -Build  (or --build)    rebuild the image even if finally:latest already exists
#   -NoOpen (or --no-open)  do not open the browser
# The -ExecutionPolicy Bypass flag applies to this one invocation only; this script
# never changes the execution policy or any other machine setting.
param(
    [switch]$Build,
    [switch]$NoOpen,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

# Keep Continue: under Stop, a native command writing to stderr throws in PowerShell 5.1.
# Every docker call is checked through $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"

$Url = "http://localhost:8000"
$WaitSeconds = 60

foreach ($arg in $Rest) {
    if ($arg -eq "--build") {
        $Build = $true
    }
    elseif ($arg -eq "--no-open") {
        $NoOpen = $true
    }
    else {
        Write-Host "Unknown option: $arg"
        Write-Host "Usage: scripts\start_windows.ps1 [-Build] [-NoOpen]   (or --build, --no-open)"
        exit 1
    }
}

# Run from the repo root (this script's parent directory), where docker-compose.yml lives.
Set-Location (Split-Path -Parent $PSScriptRoot)

docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker is not running. Start Docker Desktop and try again."
    exit 1
}

# First run: create .env from the template. Never overwrite an existing .env.
if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
    Copy-Item -Path ".env.example" -Destination ".env"
    Write-Host "Created .env from .env.example."
    Write-Host "The market simulator needs no keys. To enable AI chat, set OPENROUTER_API_KEY in .env."
}

if (-not $Build) {
    docker image inspect finally:latest > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        $Build = $true
    }
}

# Build as its own step, so build time never counts against the health timeout.
if ($Build) {
    Write-Host "Building the FinAlly image..."
    docker compose build
    if ($LASTEXITCODE -ne 0) {
        $code = $LASTEXITCODE
        Write-Host "Docker build failed (exit $code). See the output above."
        exit $code
    }
}

Write-Host "Starting FinAlly..."
docker compose up -d --wait --wait-timeout $WaitSeconds
if ($LASTEXITCODE -ne 0) {
    docker compose logs --tail 50 app
    Write-Host "FinAlly did not become healthy within $WaitSeconds seconds. See the logs above."
    exit 1
}

Write-Host "FinAlly is running at $Url"

if (-not $NoOpen) {
    Start-Process $Url
}

exit 0
