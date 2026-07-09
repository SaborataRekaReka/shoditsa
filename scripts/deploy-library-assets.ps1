param(
  [string]$ServerHost = "72.56.240.222",
  [string]$User = "root",
  [int]$Port = 22,
  [string]$TargetDir = "/opt/repeto/deploy/shoditsa"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

try {
  $remote = "{0}@{1}" -f $User, $ServerHost
  $remoteLibrariesRoot = "$TargetDir/data/libraries"
  $archiveLocal = Join-Path $projectRoot "tmp/library-assets.tar.gz"
  $archiveRemote = "/tmp/library-assets.tar.gz"

  Write-Host "[assets] Running backdrop deduplication before packaging..."
  node scripts/dedupe-library-backdrops.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "dedupe script failed with exit code $LASTEXITCODE"
  }

  Write-Host "[assets] Building single tar archive..."
  New-Item -ItemType Directory -Force (Split-Path -Parent $archiveLocal) | Out-Null
  if (Test-Path $archiveLocal) {
    Remove-Item -Force $archiveLocal
  }
  tar -czf $archiveLocal -C public/data/libraries movies series animes games people
  if ($LASTEXITCODE -ne 0) {
    throw "tar create failed with exit code $LASTEXITCODE"
  }

  Write-Host "[assets] Preparing remote directories..."
  ssh -p $Port $remote "rm -rf $remoteLibrariesRoot/movies $remoteLibrariesRoot/series $remoteLibrariesRoot/animes $remoteLibrariesRoot/games $remoteLibrariesRoot/people; mkdir -p $remoteLibrariesRoot"
  if ($LASTEXITCODE -ne 0) {
    throw "ssh prepare failed with exit code $LASTEXITCODE"
  }

  Write-Host "[assets] Uploading single archive..."
  scp -P $Port $archiveLocal "$remote`:$archiveRemote"
  if ($LASTEXITCODE -ne 0) {
    throw "scp upload failed with exit code $LASTEXITCODE"
  }

  Write-Host "[assets] Extracting archive on server..."
  ssh -p $Port $remote "tar -xzf $archiveRemote -C $remoteLibrariesRoot; rm -f $archiveRemote; chmod -R a+rX $TargetDir/data; du -sh $remoteLibrariesRoot; find $remoteLibrariesRoot -maxdepth 2 -type d | head -n 30"
  if ($LASTEXITCODE -ne 0) {
    throw "ssh extract/finalize failed with exit code $LASTEXITCODE"
  }

  Write-Host "[assets] Done."
}
finally {
  Pop-Location
}
