param([int]$Port = 5180)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$variableNames = @('VITE_LOCAL_REDESIGN', 'VITE_REFERENCE_API', 'VITE_PUBLIC_THEME', 'VITE_CACHE_DIR', 'VITE_QUEST_STUDY')
$previousValues = @{}
foreach ($name in $variableNames) { $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
  $env:VITE_LOCAL_REDESIGN = '1'
  $env:VITE_REFERENCE_API = '0'
  $env:VITE_QUEST_STUDY = '1'
  $env:VITE_PUBLIC_THEME = 'reference'
  $env:VITE_CACHE_DIR = Join-Path $projectRoot ".tmp/vite-quest-study-$Port"
  Set-Location $projectRoot
  Write-Host "Archive: http://127.0.0.1:$Port/archive"
  Write-Host "Home: http://127.0.0.1:$Port/"
  Write-Host "Title preview: http://127.0.0.1:$Port/games/movie"
  Write-Host "Club: http://127.0.0.1:$Port/club"
  & node (Join-Path $projectRoot 'node_modules/vite/bin/vite.js') apps/web --mode yandex --host 127.0.0.1 --port $Port --strictPort
  exit $LASTEXITCODE
}
finally {
  foreach ($name in $variableNames) { [Environment]::SetEnvironmentVariable($name, $previousValues[$name], 'Process') }
}
