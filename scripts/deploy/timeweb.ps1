param(
  [string]$ServerHost = "72.56.240.222",
  [string]$User = "root",
  [int]$Port = 22,
  [string]$DeployRoot = "/opt/shoditsa",
  [string]$ReleaseId,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$archivePath = Join-Path $projectRoot ".tmp\shoditsa-web-release.tar.gz"
Push-Location $projectRoot

try {
  if (-not $SkipBuild) {
    Write-Host "[deploy] Building project..."
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }
  }

  foreach ($required in @("dist/index.html", "dist/build-manifest.json")) {
    if (-not (Test-Path $required -PathType Leaf)) { throw "$required not found. Run the server build first." }
  }
  if (Test-Path "dist/data") {
    throw "dist/data must not exist in a server release because it contains answer-bearing legacy datasets."
  }

  $commitSha = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $commitSha -notmatch '^[0-9a-f]{40}$') { throw "Could not resolve the Git commit SHA." }
  $releaseId = if ($ReleaseId) { $ReleaseId } else { $commitSha }
  if ($releaseId -notmatch '^[0-9A-Za-z._-]+$') { throw "ReleaseId may contain only letters, numbers, dots, underscores, and hyphens." }

  New-Item -ItemType Directory -Force (Split-Path -Parent $archivePath) | Out-Null
  if (Test-Path $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
  tar -czf $archivePath -C dist .
  if ($LASTEXITCODE -ne 0) { throw "Could not package dist." }

  $remote = "{0}@{1}" -f $User, $ServerHost
  $remoteArchive = "/tmp/shoditsa-web-$releaseId.tar.gz"
  ssh -p $Port $remote "mkdir -p '$DeployRoot/releases'"
  if ($LASTEXITCODE -ne 0) { throw "Could not prepare the release directory." }
  scp -P $Port $archivePath "${remote}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw "Could not upload the release archive." }

  $activationScript = @'
set -euo pipefail
STAGE="${DEPLOY_ROOT}/releases/.stage-${GITHUB_SHA}"
RELEASE="${DEPLOY_ROOT}/releases/${GITHUB_SHA}"
rm -rf "$STAGE"
mkdir -p "$STAGE/web"
tar -xzf "$REMOTE_ARCHIVE" -C "$STAGE/web"
test -f "$STAGE/web/index.html"
test -f "$STAGE/web/build-manifest.json"
test ! -e "$STAGE/web/data"
chmod -R a+rX "$STAGE"
if [ -e "$RELEASE" ]; then rm -rf "$STAGE"; else mv "$STAGE" "$RELEASE"; fi
ln -sfn "$RELEASE" "${DEPLOY_ROOT}/current.next"
mv -Tf "${DEPLOY_ROOT}/current.next" "${DEPLOY_ROOT}/current"
rm -f "$REMOTE_ARCHIVE"
'@
  $activationScript | ssh -p $Port $remote "DEPLOY_ROOT='$DeployRoot' GITHUB_SHA='$releaseId' REMOTE_ARCHIVE='$remoteArchive' bash -s"
  if ($LASTEXITCODE -ne 0) { throw "Atomic release activation failed." }

  Write-Host "[deploy] Activated $DeployRoot/releases/$releaseId"
}
finally {
  if (Test-Path $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
  Pop-Location
}
