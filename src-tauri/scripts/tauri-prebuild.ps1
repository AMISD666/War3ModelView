$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tauriDir = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $tauriDir

Set-Location $repoRoot
Write-Host "[Prebuild] Building frontend..."
npm run build

Set-Location $tauriDir
Write-Host "[Prebuild] Building sidecar war3copy..."

$target = $env:TAURI_ENV_TARGET_TRIPLE
if ([string]::IsNullOrWhiteSpace($target)) {
    $target = (rustc -vV | Select-String "host:" | ForEach-Object { $_.ToString().Split(":")[1].Trim() })
}

if ([string]::IsNullOrWhiteSpace($target)) {
    throw "Failed to detect target triple"
}

$targetArg = @()
if ($env:TAURI_ENV_TARGET_TRIPLE) {
    $targetArg = @("--target", $env:TAURI_ENV_TARGET_TRIPLE)
}

$targetDir = Join-Path $tauriDir "target"

$env:TAURI_CONFIG = Join-Path $tauriDir "tauri.sidecar.conf.json"
& cargo build --bin war3copy --release @targetArg --target-dir $targetDir
if ($LASTEXITCODE -ne 0) {
    throw "Sidecar build failed (cargo exit code $LASTEXITCODE)"
}
Remove-Item Env:TAURI_CONFIG -ErrorAction SilentlyContinue

$srcCandidates = @()
if ($env:TAURI_ENV_TARGET_TRIPLE) {
    $srcCandidates += (Join-Path $targetDir "$($env:TAURI_ENV_TARGET_TRIPLE)\\release\\war3copy.exe")
}
$srcCandidates += (Join-Path $targetDir "release\\war3copy.exe")

$src = $srcCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $src) {
    Write-Host "[Prebuild] Sidecar candidates not found:"
    $srcCandidates | ForEach-Object { Write-Host " - $_" }
    throw "Sidecar binary not found"
}

$binDir = Join-Path $tauriDir "bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$dst = Join-Path $binDir ("war3copy-$target.exe")
Copy-Item $src $dst -Force

Write-Host "[Prebuild] Sidecar copied to $dst"
