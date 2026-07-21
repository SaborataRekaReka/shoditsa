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

  New-Item -ItemType Directory -Force (Split-Path -Parent $archivePath) | Out-Null
  if (Test-Path $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
  tar -czf $archivePath -C dist .
  if ($LASTEXITCODE -ne 0) { throw "Could not package dist." }

  # Releases are immutable on the server. A commit-only id can point at stale
  # assets when deploying uncommitted UI work from the same HEAD, so include
  # the packaged artifact hash in the default release id.
  $artifactHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant().Substring(0, 12)
  $releaseId = if ($ReleaseId) { $ReleaseId } else { "$commitSha-$artifactHash" }
  if ($releaseId -notmatch '^[0-9A-Za-z._-]+$') { throw "ReleaseId may contain only letters, numbers, dots, underscores, and hyphens." }

  $remote = "{0}@{1}" -f $User, $ServerHost
  $remoteUploadDir = "$DeployRoot/incoming"
  $remoteArchive = "$remoteUploadDir/shoditsa-web-$releaseId.tar.gz"
  $prepareScript = @'
set -euo pipefail
install -d -m 700 "$REMOTE_UPLOAD_DIR"
mkdir -p "$DEPLOY_ROOT/releases"
find "$REMOTE_UPLOAD_DIR" -maxdepth 1 -type f -name 'shoditsa-web-*.tar.gz' -mtime +1 -delete
rm -f "$REMOTE_ARCHIVE"
AVAILABLE_KB="$(df -Pk "$DEPLOY_ROOT" | awk 'NR == 2 { print $4 }')"
if [ "$AVAILABLE_KB" -lt 262144 ]; then
  echo "At least 256 MiB of free space is required before uploading a web release; ${AVAILABLE_KB} KiB available" >&2
  exit 1
fi
# Keep PowerShell's final CRLF on a Bash comment when piping over SSH.
'@
  $prepareScript | ssh -p $Port $remote "DEPLOY_ROOT='$DeployRoot' REMOTE_UPLOAD_DIR='$remoteUploadDir' REMOTE_ARCHIVE='$remoteArchive' bash -s"
  if ($LASTEXITCODE -ne 0) { throw "Could not prepare the release directory." }
  scp -P $Port $archivePath "${remote}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw "Could not upload the release archive." }

  $activationScript = @'
set -euo pipefail
trap 'rm -f "$REMOTE_ARCHIVE"' EXIT
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
LEGACY_ROOT="/opt/repeto/deploy/shoditsa"
CURRENT_ROOT="${DEPLOY_ROOT}/current/web"
if command -v nginx >/dev/null 2>&1; then
  LEGACY_ROOT_ESC="${LEGACY_ROOT//\//\\/}"
  CURRENT_ROOT_ESC="${CURRENT_ROOT//\//\\/}"
  mapfile -t NGINX_CONFIGS < <(grep -RIlE --exclude='*.pre-shoditsa-release-root' "root[[:space:]]+(${CURRENT_ROOT_ESC}|${LEGACY_ROOT_ESC})/?;" /etc/nginx 2>/dev/null || true)
  if [ "${#NGINX_CONFIGS[@]}" -ne 1 ]; then
    echo "Expected exactly one host Nginx config for Shoditsa root (${LEGACY_ROOT} or ${CURRENT_ROOT}), found ${#NGINX_CONFIGS[@]}" >&2
    exit 1
  fi
  NGINX_CONFIG="${NGINX_CONFIGS[0]}"
  NGINX_BACKUP="${NGINX_CONFIG}.pre-shoditsa-release-root"
  cp -a "$NGINX_CONFIG" "$NGINX_BACKUP"
  HOST_NGINX_CHANGED=0
  if grep -Eq "root[[:space:]]+${LEGACY_ROOT_ESC}/?;" "$NGINX_CONFIG"; then
    sed -Ei "s#root[[:space:]]+${LEGACY_ROOT_ESC}/?;#root ${CURRENT_ROOT};#" "$NGINX_CONFIG"
    HOST_NGINX_CHANGED=1
  fi
  if ! grep -Eq 'client_max_body_size[[:space:]]+25m;' "$NGINX_CONFIG"; then
    if grep -Eq 'client_max_body_size[[:space:]]+[0-9]+[kKmM]?;' "$NGINX_CONFIG"; then
      sed -Ei 's/client_max_body_size[[:space:]]+[0-9]+[kKmM]?;/client_max_body_size 25m;/g' "$NGINX_CONFIG"
    else
      sed -Ei "/root[[:space:]]+${CURRENT_ROOT_ESC}\\/?;/a\\    client_max_body_size 25m;" "$NGINX_CONFIG"
    fi
    HOST_NGINX_CHANGED=1
  fi
  if [ "$HOST_NGINX_CHANGED" -eq 1 ]; then
    if ! nginx -t; then
      cp -a "$NGINX_BACKUP" "$NGINX_CONFIG"
      nginx -t
      exit 1
    fi
    systemctl reload nginx
  fi
elif command -v docker >/dev/null 2>&1; then
  mapfile -t NGINX_CONTAINERS < <(
    while IFS= read -r container; do
      mount_source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/www/shoditsa"}}{{.Source}}{{end}}{{end}}' "$container")"
      [ -n "$mount_source" ] && printf '%s\n' "$container"
    done < <(docker ps -q)
  )
  if [ "${#NGINX_CONTAINERS[@]}" -ne 1 ]; then
    echo "Expected exactly one running container with /var/www/shoditsa, found ${#NGINX_CONTAINERS[@]}" >&2
    exit 1
  fi
  NGINX_CONTAINER="${NGINX_CONTAINERS[0]}"
  COMPOSE_FILES="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$NGINX_CONTAINER")"
  COMPOSE_DIR="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$NGINX_CONTAINER")"
  COMPOSE_PROJECT="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$NGINX_CONTAINER")"
  COMPOSE_SERVICE="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$NGINX_CONTAINER")"
  if [ -z "$COMPOSE_FILES" ] || [[ "$COMPOSE_FILES" == *,* ]] || [ ! -f "$COMPOSE_FILES" ] || [ -z "$COMPOSE_DIR" ] || [ -z "$COMPOSE_PROJECT" ] || [ -z "$COMPOSE_SERVICE" ]; then
    echo "Docker Nginx is missing a supported single-file Compose configuration" >&2
    exit 1
  fi
  compose() {
    docker compose --project-directory "$COMPOSE_DIR" --project-name "$COMPOSE_PROJECT" -f "$COMPOSE_FILES" "$@"
  }
  compose config --quiet
  # Docker resolves the target of a symlinked bind mount when the container
  # starts, so a release symlink switch is not visible until Nginx restarts.
  if ! compose up -d --no-deps --force-recreate "$COMPOSE_SERVICE"; then
    exit 1
  fi
  NGINX_CONTAINER="$(compose ps -q "$COMPOSE_SERVICE")"
  if [ -z "$NGINX_CONTAINER" ] || ! docker exec "$NGINX_CONTAINER" nginx -t; then
    exit 1
  fi
  if ! docker exec "$NGINX_CONTAINER" grep -Fq "\"commitSha\": \"${BUILD_SHA}\"" /var/www/shoditsa/build-manifest.json; then
    echo "Docker Nginx does not see build ${BUILD_SHA} from release ${GITHUB_SHA}" >&2
    exit 1
  fi
else
  echo "Neither host Nginx nor Docker is available to activate the web release" >&2
  exit 1
fi
# Keep PowerShell's final CRLF on a Bash comment when piping over SSH.
'@
  $activationScript | ssh -p $Port $remote "DEPLOY_ROOT='$DeployRoot' GITHUB_SHA='$releaseId' BUILD_SHA='$commitSha' REMOTE_ARCHIVE='$remoteArchive' bash -s"
  if ($LASTEXITCODE -ne 0) { throw "Atomic release activation failed." }

  Write-Host "[deploy] Activated $DeployRoot/releases/$releaseId"
}
finally {
  if (Test-Path $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
  Pop-Location
}
