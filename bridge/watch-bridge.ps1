param(
  [string]$BridgeDir = $PSScriptRoot,
  [int]$PollSeconds = 2
)

$ErrorActionPreference = "Stop"

$inbox = Join-Path $BridgeDir "to-codex.md"
$log = Join-Path $BridgeDir "watch.log"
$state = Join-Path $BridgeDir ".watch-state.json"

function Write-BridgeLog {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $log -Value "[$timestamp] $Message"
}

if (!(Test-Path -LiteralPath $inbox)) {
  New-Item -ItemType File -Path $inbox -Force | Out-Null
}

$lastWrite = (Get-Item -LiteralPath $inbox).LastWriteTimeUtc
$lastLength = (Get-Item -LiteralPath $inbox).Length

Write-BridgeLog "Watcher started. inbox=$inbox poll=${PollSeconds}s"

while ($true) {
  Start-Sleep -Seconds $PollSeconds

  $item = Get-Item -LiteralPath $inbox
  if ($item.LastWriteTimeUtc -ne $lastWrite -or $item.Length -ne $lastLength) {
    $lastWrite = $item.LastWriteTimeUtc
    $lastLength = $item.Length

    $stateObject = [ordered]@{
      inbox = $inbox
      lastWriteTimeUtc = $lastWrite.ToString("o")
      length = $lastLength
      noticedAt = (Get-Date).ToString("o")
    }

    $stateObject | ConvertTo-Json | Set-Content -LiteralPath $state
    Write-BridgeLog "Change detected in to-codex.md length=$lastLength"
  }
}
