[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,
    [int]$TimeoutSeconds = 10
)

$ErrorActionPreference = "Stop"
$targetPath = [IO.Path]::GetFullPath((Join-Path $InstallDir "pi-node.exe"))

function Get-TargetSidecarProcess {
    @(
        Get-CimInstance Win32_Process -Filter "Name = 'pi-node.exe'" |
            Where-Object {
                $_.ExecutablePath -and
                [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $targetPath
            }
    )
}

foreach ($process in Get-TargetSidecarProcess) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
}

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
    $runningProcesses = Get-TargetSidecarProcess
    if ($runningProcesses.Count -eq 0) {
        exit 0
    }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)

throw "Timed out waiting for the PI-AI-Agent sidecar to exit: $targetPath"
