param(
    [switch]$SkipArchive
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$tauriRoot = Join-Path $repoRoot 'src-tauri'
$releaseRoot = Join-Path $tauriRoot 'target\release'
$sidecarSource = Join-Path $tauriRoot 'sidecars\nb-trainer'
$trainerSource = Join-Path $tauriRoot 'sidecars\dist\nb-trainer'
$trainerExe = Join-Path $trainerSource 'nb-trainer.exe'
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$packageName = "NeuroBricks-3D-$($package.version)-windows-x64-portable-$timestamp"
$portableRoot = Join-Path $releaseRoot 'portable'
$stageRoot = Join-Path $portableRoot $packageName
$applicationExe = Join-Path $releaseRoot 'NeuroBricks 3D.exe'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed (exit=$LASTEXITCODE): $Program $($Arguments -join ' ')"
    }
}

function Get-Sha256 {
    param([string]$Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

function Remove-StagedItem {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }

    # Packaging cleanup must never escape the newly-created staging directory.
    $stageBoundary = [System.IO.Path]::GetFullPath($stageRoot) + [System.IO.Path]::DirectorySeparatorChar
    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($stageBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to prune a path outside the portable stage: $resolved"
    }

    $item = Get-Item -LiteralPath $resolved
    if ($item.PSIsContainer) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    } else {
        Remove-Item -LiteralPath $resolved -Force
    }
}

if (-not (Test-Path -LiteralPath $trainerExe -PathType Leaf)) {
    throw 'Verified trainer is missing. Run npm run sidecar:build:windows first.'
}

Push-Location $repoRoot
try {
    Invoke-Checked 'npm.cmd' @('run', 'tauri', '--', 'build')
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $applicationExe -PathType Leaf)) {
    throw "Tauri release executable is missing: $applicationExe"
}

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
Copy-Item -LiteralPath $applicationExe -Destination $stageRoot

$stageSidecarRoot = Join-Path $stageRoot 'sidecars\nb-trainer'
$stageDistRoot = Join-Path $stageRoot 'sidecars\dist'
New-Item -ItemType Directory -Path $stageSidecarRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stageDistRoot -Force | Out-Null
foreach ($name in @('main.py', 'models.py', 'train.py', 'predict.py', 'protocol.py', 'requirements.txt')) {
    Copy-Item -LiteralPath (Join-Path $sidecarSource $name) -Destination $stageSidecarRoot
}
$dataSource = Join-Path $sidecarSource 'data'
if (Test-Path -LiteralPath $dataSource -PathType Container) {
    Copy-Item -LiteralPath $dataSource -Destination $stageSidecarRoot -Recurse
}
Copy-Item -LiteralPath $trainerSource -Destination $stageDistRoot -Recurse

# Keep the offline datasets and runtime features while omitting reproducible
# packaging duplicates and development-only tools. TorchVision reads the
# extracted MNIST IDX files directly, so the downloaded gzip copies are not
# needed. NeuroBricks does not advertise AVIF input support.
$stagedMnistRaw = Join-Path $stageSidecarRoot 'data\MNIST\raw'
if (Test-Path -LiteralPath $stagedMnistRaw -PathType Container) {
    Get-ChildItem -LiteralPath $stagedMnistRaw -Filter '*.gz' -File |
        ForEach-Object { Remove-StagedItem $_.FullName }
}
$stagedRuntimeRoot = Join-Path $stageDistRoot 'nb-trainer\_internal'
Remove-StagedItem (Join-Path $stagedRuntimeRoot 'torch\testing')
Remove-StagedItem (Join-Path $stagedRuntimeRoot 'torch\bin\protoc.exe')
# PyTorch ships a second NVRTC fallback binary alongside the primary DLL.
# NeuroBricks' controlled eager-mode training path does not use torch.compile,
# so retain nvrtc64_120_0.dll and omit only the alternate fallback copy.
Remove-StagedItem (Join-Path $stagedRuntimeRoot 'torch\lib\nvrtc64_120_0.alt.dll')
Get-ChildItem -LiteralPath (Join-Path $stagedRuntimeRoot 'PIL') -Filter '_avif*.pyd' -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-StagedItem $_.FullName }

$runtimeHash = Get-Sha256 (Join-Path $stageDistRoot 'nb-trainer\nb-trainer.exe')
$manifest = [ordered]@{
    schemaVersion = 1
    product = 'NeuroBricks 3D'
    applicationVersion = $package.version
    platform = 'windows-x64'
    packaging = 'portable'
    runtime = [ordered]@{
        python = '3.12.7'
        pytorch = '2.11.0+cu128'
        cudaBuild = '12.8'
        csvRegression = $true
        entrypointSha256 = $runtimeHash
    }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stageRoot 'PACKAGE-MANIFEST.json') -Encoding UTF8

$stageStats = Get-ChildItem -LiteralPath $stageRoot -Recurse -File | Measure-Object Length -Sum
Write-Host "Portable application staged: $stageRoot"
Write-Host ("Uncompressed size: {0:N2} GiB ({1} files)" -f ($stageStats.Sum / 1GB), $stageStats.Count)

if (-not $SkipArchive) {
    $archivePath = Join-Path $portableRoot "$packageName.zip"
    Invoke-Checked 'tar.exe' @('-a', '-cf', $archivePath, '-C', $portableRoot, $packageName)
    $archiveEntries = & tar.exe -tf $archivePath
    if ($LASTEXITCODE -ne 0 -or $archiveEntries -notcontains "$packageName/NeuroBricks 3D.exe") {
        throw 'Portable ZIP verification failed: application executable is missing from the archive.'
    }
    $archive = Get-Item -LiteralPath $archivePath
    $archiveHash = Get-Sha256 $archivePath
    Write-Host "Portable archive: $archivePath"
    Write-Host ("Archive size: {0:N2} GiB" -f ($archive.Length / 1GB))
    Write-Host "SHA256: $archiveHash"
}
