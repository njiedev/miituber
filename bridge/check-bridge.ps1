$ErrorActionPreference = "Stop"

$bridgeDir = $PSScriptRoot
$inbox = Join-Path $bridgeDir "to-codex.md"
$outbox = Join-Path $bridgeDir "to-claude.md"
$log = Join-Path $bridgeDir "watch.log"
$state = Join-Path $bridgeDir ".watch-state.json"

Write-Output "Bridge: $bridgeDir"
Write-Output "Inbox last write: $((Get-Item -LiteralPath $inbox).LastWriteTime)"
Write-Output "Outbox last write: $((Get-Item -LiteralPath $outbox).LastWriteTime)"

if (Test-Path -LiteralPath $state) {
  Write-Output ""
  Write-Output "Last detected change:"
  Get-Content -LiteralPath $state
}

if (Test-Path -LiteralPath $log) {
  Write-Output ""
  Write-Output "Recent watcher log:"
  Get-Content -LiteralPath $log -Tail 10
}
