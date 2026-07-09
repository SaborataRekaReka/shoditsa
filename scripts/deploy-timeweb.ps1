param(
  [string]$ServerHost = "72.56.240.222",
  [string]$User = "root",
  [int]$Port = 22,
  [string]$TargetDir = "/opt/repeto/deploy/shoditsa",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

try {
  if (-not $SkipBuild) {
    Write-Host "[deploy] Building project..."
    npm run build
  }

  if (-not (Test-Path "dist/index.html")) {
    throw "dist/index.html not found. Run build first or remove -SkipBuild."
  }

  $destination = "{0}@{1}:{2}" -f $User, $ServerHost, $TargetDir
  $remote = "{0}@{1}" -f $User, $ServerHost

  Write-Host "[deploy] Cleaning target directory to avoid stale files..."
  ssh -p $Port $remote "mkdir -p $TargetDir; find $TargetDir -mindepth 1 -maxdepth 1 -exec rm -rf {} +"
  if ($LASTEXITCODE -ne 0) {
    throw "ssh cleanup failed with exit code $LASTEXITCODE"
  }

  Write-Host "[deploy] Uploading dist to $destination ..."
  scp -P $Port -r dist/* $destination
  if ($LASTEXITCODE -ne 0) {
    throw "scp failed with exit code $LASTEXITCODE"
  }

  Write-Host "[deploy] Applying permissions and listing deployed files..."
  ssh -p $Port $remote "chmod -R a+rX $TargetDir; ls -la $TargetDir | head -n 20"
  if ($LASTEXITCODE -ne 0) {
    throw "ssh failed with exit code $LASTEXITCODE"
  }

  Write-Host "[deploy] Done."
}
finally {
  Pop-Location
}
