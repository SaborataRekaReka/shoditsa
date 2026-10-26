param([string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceSkill = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($Destination)) {
  $skillsRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex/skills' }
  $Destination = Join-Path $skillsRoot 'shoditsa-traffic-audit'
}
$targetSkill = [IO.Path]::GetFullPath($Destination)
if ((Split-Path $targetSkill -Leaf) -ne 'shoditsa-traffic-audit') { throw 'Destination must be the shoditsa-traffic-audit folder.' }
if ($targetSkill -eq $sourceSkill) { throw 'Source and destination must differ.' }
$trackedFiles = @('SKILL.md','agents/openai.yaml','references/measurement.md','scripts/collect-yandex-history.mjs','scripts/audit-core.mjs','scripts/compare-snapshots.mjs','scripts/read-yandex-token.ps1','scripts/install.ps1','scripts/audit-core.test.mjs')
foreach ($relative in $trackedFiles) {
  $sourcePath = Join-Path $sourceSkill $relative
  $targetPath = Join-Path $targetSkill $relative
  New-Item -ItemType Directory -Path (Split-Path $targetPath -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
}
Write-Output "Installed $($trackedFiles.Count) maintained files to $targetSkill. Credentials and unrelated files were not copied or removed."
