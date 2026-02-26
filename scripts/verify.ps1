$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
    Write-Host "[1/3] Generating Wails bindings without go.mod sync..."
    wails build -s -nopackage -nosyncgomod -m

    Write-Host "[2/3] Building frontend..."
    npm run build --prefix frontend

    Write-Host "[3/3] Running backend tests..."
    go test ./...

    Write-Host "Done. Bindings generated, frontend build passed, backend tests passed."
} finally {
    Pop-Location
}
