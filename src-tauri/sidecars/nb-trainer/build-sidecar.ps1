param(
    [switch]$VerifyOnly,
    [string]$BootstrapPython = ""
)

$ErrorActionPreference = 'Stop'
$sidecarRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sidecarsRoot = Split-Path -Parent $sidecarRoot
$distBase = Join-Path $sidecarsRoot 'dist'
$buildBase = Join-Path $sidecarsRoot 'build'
$distRoot = Join-Path $distBase 'nb-trainer'
$trainerExe = Join-Path $distRoot 'nb-trainer.exe'
$packageVenv = Join-Path $sidecarRoot '.venv-package-cu128'
$packagePython = Join-Path $packageVenv 'Scripts\python.exe'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed (exit=$LASTEXITCODE): $Program $($Arguments -join ' ')"
    }
}

function Test-Python312 {
    param([string]$Program, [string[]]$PrefixArguments)
    try {
        & $Program @PrefixArguments '-c' 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)' 2>$null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Read-TrainerCapabilities {
    param([string]$Executable)
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        throw "Bundled trainer does not exist: $Executable"
    }
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Executable
    $startInfo.WorkingDirectory = $sidecarRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    # Prove the frozen runtime is portable instead of accidentally borrowing
    # Python/Conda DLLs from the build machine's PATH or PYTHONPATH.
    $internalRoot = Join-Path (Split-Path -Parent $Executable) '_internal'
    $startInfo.EnvironmentVariables['PATH'] = "$internalRoot;$env:SystemRoot\System32;$env:SystemRoot"
    if ($startInfo.EnvironmentVariables.ContainsKey('PYTHONPATH')) {
        $startInfo.EnvironmentVariables.Remove('PYTHONPATH')
    }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'Failed to start bundled trainer capability probe' }
    $process.StandardInput.WriteLine('{"mode":"capabilities"}')
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(60000)) {
        $process.Kill()
        $process.WaitForExit()
        throw 'Bundled trainer capability probe exceeded 60 seconds'
    }
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $capability = $null
    foreach ($line in ($stdout -split "`r?`n")) {
        if (-not $line.Trim()) { continue }
        try {
            $message = $line | ConvertFrom-Json
            if ($message.type -eq 'runtime_capabilities') { $capability = $message }
        } catch {
            continue
        }
    }
    if ($process.ExitCode -ne 0 -or $null -eq $capability) {
        throw "Bundled trainer failed the capability protocol. stderr: $stderr"
    }
    return $capability
}

function Assert-ReleaseCapabilities {
    param($Capability)
    if (-not $Capability.available -or -not $Capability.imageClassificationAvailable) {
        throw "Bundled trainer cannot run image classification: $($Capability.issues -join '; ')"
    }
    if (-not $Capability.csvRegressionAvailable) {
        throw "Bundled trainer is missing CSV regression dependencies: $($Capability.issues -join '; ')"
    }
    if (-not $Capability.cudaBuildVersion) {
        throw 'Release packaging forbids a CPU-only PyTorch build; rebuild the CUDA runtime'
    }
    Write-Host "Runtime verified: Python $($Capability.pythonVersion), PyTorch $($Capability.torchVersion), CUDA build $($Capability.cudaBuildVersion), CUDA available=$($Capability.cudaAvailable), CSV=$($Capability.csvRegressionAvailable)"
}

if ($VerifyOnly) {
    Assert-ReleaseCapabilities (Read-TrainerCapabilities $trainerExe)
    exit 0
}

if (-not (Test-Path -LiteralPath $packagePython -PathType Leaf)) {
    $bootstrap = $null
    $bootstrapArgs = @()
    if ($BootstrapPython) {
        if (-not (Test-Python312 $BootstrapPython @())) {
            throw "BootstrapPython must point to a working Python 3.12 executable: $BootstrapPython"
        }
        $bootstrap = $BootstrapPython
    } else {
        $candidates = @()
        $pyCommand = Get-Command py -ErrorAction SilentlyContinue
        if ($pyCommand) {
            $candidates += ,@($pyCommand.Source, @('-3.12'))
        }
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if ($pythonCommand) {
            $candidates += ,@($pythonCommand.Source, @())
        }
        foreach ($candidatePath in @(
            (Join-Path $env:USERPROFILE 'anaconda3\python.exe'),
            (Join-Path $env:USERPROFILE 'miniconda3\python.exe')
        )) {
            if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
                $candidates += ,@($candidatePath, @())
            }
        }
        foreach ($candidate in $candidates) {
            if (Test-Python312 $candidate[0] $candidate[1]) {
                $bootstrap = $candidate[0]
                $bootstrapArgs = $candidate[1]
                break
            }
        }
    }
    if (-not $bootstrap) {
        throw 'Python 3.12 was not found on the build machine. End users do not need Python, but sidecar builders do.'
    }
    Invoke-Checked $bootstrap ($bootstrapArgs + @('-m', 'venv', $packageVenv))
}

Invoke-Checked $packagePython @('-m', 'pip', 'install', '--upgrade', 'pip')
Invoke-Checked $packagePython @('-m', 'pip', 'install', '--requirement', (Join-Path $sidecarRoot 'requirements.txt'))
Invoke-Checked $packagePython @('-m', 'pip', 'install', 'pyinstaller==6.21.0')
Invoke-Checked $packagePython @(
    '-c',
    'import pandas, torch, torchvision; assert torch.version.cuda, "CPU-only torch is forbidden for release"; print(torch.__version__, torchvision.__version__, pandas.__version__, torch.version.cuda)'
)
Push-Location $sidecarRoot
try {
    Invoke-Checked $packagePython @(
        '-m', 'PyInstaller', '--noconfirm', '--clean',
        '--distpath', $distBase,
        '--workpath', $buildBase,
        'nb-trainer.spec'
    )
} finally {
    Pop-Location
}
Assert-ReleaseCapabilities (Read-TrainerCapabilities $trainerExe)
