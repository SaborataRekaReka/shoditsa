param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Get-WorkspaceSizeMb {
  $total = Get-ChildItem $Root -File -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "\\(node_modules|\.git)\\" } |
    Measure-Object Length -Sum
  return [math]::Round($total.Sum / 1MB, 2)
}

function Move-ToArchive([string]$SourceRelative, [string]$DestinationRelative) {
  $source = Join-Path $Root $SourceRelative
  if (-not (Test-Path $source)) { return }
  $destination = Join-Path $Root $DestinationRelative
  if (Test-Path $destination) {
    throw "Archive destination already exists: $DestinationRelative"
  }
  $parent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Move-Item -Path $source -Destination $destination
  Write-Host "[archive] $SourceRelative -> $DestinationRelative"
}

function Remove-Generated([string]$RelativePath) {
  $target = Join-Path $Root $RelativePath
  if (-not (Test-Path $target)) { return }
  Remove-Item -Path $target -Recurse -Force
  Write-Host "[remove] $RelativePath"
}

$beforeMb = Get-WorkspaceSizeMb

Move-ToArchive "diagnoses.generated.like.movies" "archive/legacy-diagnoses"
Move-ToArchive "data/content-periods.json" "archive/legacy-config/content-periods.json"
Move-ToArchive "data/genre-map.json" "archive/legacy-config/genre-map.json"

Move-ToArchive "tmp/assets-originals" "archive/local/assets/originals"
Move-ToArchive "tmp/extract-hints-sample.mjs" "archive/local/legacy-scripts/extract-hints-sample.mjs"

$musicDocsArchive = Join-Path $Root "archive/local/music-pipeline/docs"
$musicDocPatterns = @(
  "music-factcheck-payload*.json",
  "music-hints-output*.json",
  "music-hints-payload*.json",
  "music-manual-review-*.json",
  "music-merge-*.json",
  "music-music-*.json",
  "music-remaining-*.json"
)
foreach ($pattern in $musicDocPatterns) {
  Get-ChildItem (Join-Path $Root "docs") -File -Filter $pattern -ErrorAction SilentlyContinue | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $musicDocsArchive | Out-Null
    Move-Item $_.FullName -Destination (Join-Path $musicDocsArchive $_.Name)
    Write-Host "[archive] docs/$($_.Name)"
  }
}

$musicLibrary = Join-Path $Root "public/data/libraries/music"
$musicStagesArchive = Join-Path $Root "archive/local/music-pipeline/library-stages"
if (Test-Path $musicLibrary) {
  Get-ChildItem $musicLibrary -File -Filter *.json |
    Where-Object { $_.Name -notin @("items.json", "search-index.json") } |
    ForEach-Object {
      $destination = if ($_.Name -eq "music_artists_merged_dedup.json") {
        Join-Path $Root "archive/local/music-pipeline/source/music_artists_merged_dedup.json"
      } else {
        Join-Path $musicStagesArchive $_.Name
      }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
      Move-Item $_.FullName -Destination $destination
      Write-Host "[archive] public/data/libraries/music/$($_.Name)"
    }
}

Move-ToArchive "data/music/raw" "archive/local/music-pipeline/raw-evidence"
Move-ToArchive "data/kinopoisk-navigator-batch.json" "archive/local/kinopoisk/kinopoisk-navigator-batch.json"
Move-ToArchive "data/kinopoisk-navigator-batch-source.json" "archive/local/kinopoisk/kinopoisk-navigator-batch-source.json"
Move-ToArchive "data/kinopoisk-navigator-movies-missing-ids.json" "archive/local/kinopoisk/kinopoisk-navigator-movies-missing-ids.json"
Move-ToArchive "data/kinopoisk-navigator-skipped-ids.json" "archive/local/kinopoisk/kinopoisk-navigator-skipped-ids.json"

$normalizedDir = Join-Path $Root "data/music/normalized"
$finalBaseline = "music_artists_enriched_first500_merged_retry_batched.resolved.json"
if (Test-Path $normalizedDir) {
  Get-ChildItem $normalizedDir -File -Filter *.json |
    Where-Object { $_.Name -ne $finalBaseline } |
    ForEach-Object {
      Remove-Item $_.FullName -Force
      Write-Host "[remove] data/music/normalized/$($_.Name)"
    }
}

Remove-Generated "data/music/tmp"
Remove-Generated "data/enrichment-agent/music/records"
Remove-Generated "data/enrichment-agent/music/runs"
Remove-Generated "data/enrichment-agent/music/music.enriched.json"
Remove-Generated "data/enrichment-agent/music/state.json"
Remove-Generated "data/kinopoisk-navigator-movies-ids-tail.json"
Remove-Generated "data/kinopoisk-navigator-movies-state-tail.json"
Remove-Generated "data/kinopoisk-navigator-skipped-new.json"
Remove-Generated "docs/music-database-audit.json"
Remove-Generated "tmp/assets-originals-unused"
Remove-Generated "tmp"
Remove-Generated "dist"
Remove-Generated "dist.zip"
Remove-Generated "tsconfig.app.tsbuildinfo"
Remove-Generated "tsconfig.node.tsbuildinfo"

$browserProfile = Join-Path $Root ".tmp/kinopoisk-playwright-profile"
if (Test-Path $browserProfile) {
  Get-ChildItem $browserProfile -Directory -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^(Cache|Code Cache|GPUCache|DawnCache|GrShaderCache|ShaderCache|Crashpad)$" } |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object {
      Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  Write-Host "[clean] Chromium caches (cookies/profile preserved)"
}
Remove-Generated ".tmp/timeweb_github_actions"
Remove-Generated ".tmp/timeweb_github_actions.pub"

$afterMb = Get-WorkspaceSizeMb
Write-Host "Workspace cleanup complete: $beforeMb MB -> $afterMb MB (freed $([math]::Round($beforeMb - $afterMb, 2)) MB)"