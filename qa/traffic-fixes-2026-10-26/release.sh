#!/usr/bin/env bash
# Prepared for root review. Executes only with an explicit --apply and committed SHA.
# Upload the complete verified artifact directory before invoking this script.
set -Eeuo pipefail
umask 077
[[ "${1:-}" == --apply ]] || { echo 'Usage: bash release.sh --apply <release SHA>'; exit 2; }
SHA="${2:?release SHA required}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
EXPECTED_WEB=/opt/shoditsa/releases/a3fcf6169b128aabf49883832f48a52326064dd5
BASE_SHA=9a16e7e59e0fe7ab2f7c49e4faa7f161b626dd2f
BASE_IMAGE="shoditsa-api:$BASE_SHA"
IMAGE="shoditsa-api:$SHA"
ROOT=/opt/shoditsa
STAGE="$ROOT/incoming/traffic-fixes-$SHA"
RELEASE="$ROOT/releases/$SHA"
BACKUP="$ROOT/backups/traffic-fixes-$SHA"
COMPOSE=/opt/repeto/deploy/shoditsa-api/docker-compose.yml
ENV_FILE=/opt/repeto/deploy/shoditsa-api/.env
NGINX_CONFIG=/opt/repeto/deploy/nginx.ssl.conf
api_compose() { docker compose --project-directory /opt/repeto/deploy/shoditsa-api --project-name shoditsa-api -f "$COMPOSE" "$@"; }
nginx_compose() { docker compose --project-directory /opt/repeto --project-name repeto -f /opt/repeto/docker-compose.prod.yml "$@"; }
guard_current() {
  [[ "$(readlink -f "$ROOT/current")" == "$EXPECTED_WEB" ]]
  [[ "$(docker inspect shoditsa-api-shoditsa-api-1 --format '{{.Config.Image}}')" == "$BASE_IMAGE" ]]
  [[ "$(docker inspect shoditsa-api-shoditsa-worker-1 --format '{{.Config.Image}}')" == "$BASE_IMAGE" ]]
}
exec 9>"$ROOT/.svoyak-release.lock"
exec 8>"$ROOT/.web-release.lock"
exec 7>"$ROOT/direct-release.lock"
flock -n 9 && flock -n 8 && flock -n 7 || { echo 'Another release holds a lock'; exit 1; }
guard_current
[[ ! -e "$RELEASE" && ! -L "$RELEASE" && ! -e "$BACKUP" && ! -L "$BACKUP" ]]
! docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo 'Release image tag already exists; inspect before retry'; exit 1; }
[[ "$(readlink -f "$STAGE")" == "$STAGE" && -d "$STAGE" && ! -L "$STAGE" ]]
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 2097152 ]] || { echo 'Less than 2 GiB free'; exit 1; }
python3 - "$STAGE" "$SHA" "$BASE_SHA" <<'PY'
import hashlib,json,pathlib,sys
stage=pathlib.Path(sys.argv[1]); sha=sys.argv[2]; base=sys.argv[3]
manifest=json.loads((stage/'artifact-manifest.json').read_text())
assert manifest['releaseSha']==sha and isinstance(manifest['files'],dict)
for relative,digest in manifest['files'].items():
 p=stage/relative
 assert not pathlib.Path(relative).is_absolute() and '..' not in pathlib.Path(relative).parts
 assert relative.startswith(('web/','api-dist/')) or relative in ('Dockerfile.api-overlay','Dockerfile.api-overlay.dockerignore','verify-web-parity.py','source-invariants.json')
 assert p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(stage)
 assert hashlib.sha256(p.read_bytes()).hexdigest()==digest,relative
for sub in ('web','api-dist'):
 for p in (stage/sub).rglob('*'):
  assert not p.is_symlink()
  if p.is_file(): assert str(p.relative_to(stage)) in manifest['files'],str(p)
inv=json.loads((stage/'source-invariants.json').read_text())
assert inv['releaseSha']==sha and inv['apiBaseSha']==base
assert inv['expectedWebSha']=='a3fcf6169b128aabf49883832f48a52326064dd5'
assert inv['dependenciesUnchanged'] and inv['migrationsUnchanged'] and inv['packageChangesLimitedToScripts']
assert json.loads((stage/'web/build-manifest.json').read_text())['commitSha']==sha
assert (stage/'api-dist/server.js').is_file() and (stage/'api-dist/worker.js').is_file()
PY
docker exec repeto-nginx-1 nginx -t
mkdir -p "$BACKUP"
cp "$COMPOSE" "$BACKUP/compose.yml"
cp "$ENV_FILE" "$BACKUP/api.env"
cp "$NGINX_CONFIG" "$BACKUP/nginx.conf"
printf '%s\n' "$EXPECTED_WEB" > "$BACKUP/previous-web"
cp "$STAGE/source-invariants.json" "$BACKUP/source-invariants.json"
cp "$STAGE/artifact-manifest.json" "$BACKUP/artifact-manifest.json"
curl --fail --silent http://127.0.0.1:3301/api/v1/meta > "$BACKUP/meta-before.json"
python3 - "$BACKUP/meta-before.json" "$STAGE/source-invariants.json" <<'PY'
import json,sys
meta=json.load(open(sys.argv[1])); inv=json.load(open(sys.argv[2]))
assert meta['buildSha']==inv['apiBaseSha']
assert meta['activeRevision']==inv['expectedActiveRevision']
PY
docker build --build-arg "BASE_IMAGE=$BASE_IMAGE" --build-arg "GIT_SHA=$SHA" -f "$STAGE/Dockerfile.api-overlay" -t "$IMAGE" "$STAGE"
guard_current
python3 "$STAGE/verify-web-parity.py" snapshot "$EXPECTED_WEB/web" "$BACKUP/old-web-hashes.json"
mkdir -p "$RELEASE/web"
chmod 0755 "$RELEASE" "$RELEASE/web"
cp -al "$EXPECTED_WEB/web/." "$RELEASE/web/"
# Replace every overlaid file by rename: never truncate a hard link to the old release.
python3 - "$STAGE/web" "$RELEASE/web" <<'PY'
import os,pathlib,shutil,sys,tempfile
source=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2])
for top,dirs,files in os.walk(target,followlinks=False):
 assert not pathlib.Path(top).is_symlink()
 os.chmod(top,0o755)
for p in source.rglob('*'):
 dest=target/p.relative_to(source)
 if p.is_dir():
  dest.mkdir(parents=True,exist_ok=True)
  assert not dest.is_symlink() and dest.resolve().is_relative_to(target)
  os.chmod(dest,0o755)
  continue
 assert p.is_file() and not p.is_symlink()
 dest.parent.mkdir(parents=True,exist_ok=True)
 assert dest.parent.resolve().is_relative_to(target)
 os.chmod(dest.parent,0o755)
 fd,tmp=tempfile.mkstemp(prefix='.traffic-overlay-',dir=dest.parent)
 os.close(fd)
 try: shutil.copy2(p,tmp); os.chmod(tmp,0o644); os.replace(tmp,dest)
 finally:
  if os.path.exists(tmp): os.unlink(tmp)
PY
python3 "$STAGE/verify-web-parity.py" compare "$EXPECTED_WEB/web" "$RELEASE/web" "$BACKUP/old-web-hashes.json" "$BACKUP/web-parity.json" "$SHA"
cp "$STAGE/source-invariants.json" "$RELEASE/source-invariants.json"
MUTATED=false
rollback() {
  local status="${1:-$?}"
  trap - ERR INT TERM
  if [[ "$MUTATED" == true ]]; then
    echo 'Release failed; restoring previous web, API and worker' >&2
    cp "$BACKUP/compose.yml" "$COMPOSE"
    cp "$BACKUP/api.env" "$ENV_FILE"
    ln -s "$EXPECTED_WEB" "$ROOT/current.traffic-rollback-$SHA"
    mv -Tf "$ROOT/current.traffic-rollback-$SHA" "$ROOT/current"
    api_compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker || true
    nginx_compose up -d --no-deps --force-recreate nginx || true
    printf '%s\n' "rollback attempted $(date -u +%FT%TZ)" > "$BACKUP/rollback-at"
  fi
  exit "$status"
}
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
MUTATED=true
python3 - "$COMPOSE" "$ENV_FILE" "$BASE_IMAGE" "$IMAGE" "$SHA" <<'PY'
import pathlib,re,sys
compose,env=map(pathlib.Path,sys.argv[1:3]); old,new,sha=sys.argv[3:]
body=compose.read_text()
updated,n=re.subn(r'(?m)^([ \t]*image:[ \t]*)'+re.escape(old)+r'[ \t]*$',lambda m:m[1]+new,body)
assert n>=2,'Expected API/worker image entries'
compose.write_text(updated)
body=env.read_text()
line='GIT_SHA='+sha
body,n=re.subn(r'(?m)^GIT_SHA=.*$',line,body)
if not n: body=body.rstrip('\n')+'\n'+line+'\n'
env.write_text(body)
PY
# No migration, content import, activation, settings or checkout operation is invoked.
api_compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
for attempt in $(seq 1 25); do
  if curl --fail --silent http://127.0.0.1:3301/api/v1/health/ready > "$BACKUP/ready-after.json"; then break; fi
  sleep 2
done
curl --fail --silent http://127.0.0.1:3301/api/v1/health/ready > "$BACKUP/ready-after.json"
curl --fail --silent http://127.0.0.1:3301/api/v1/meta > "$BACKUP/meta-after.json"
python3 - "$BACKUP/meta-before.json" "$BACKUP/meta-after.json" "$SHA" <<'PY'
import json,sys
before=json.load(open(sys.argv[1])); after=json.load(open(sys.argv[2]))
assert after['buildSha']==sys.argv[3]
for key in ('activeRevision','modes','features','growth'): assert before.get(key)==after.get(key),key
PY
[[ "$(docker inspect shoditsa-api-shoditsa-worker-1 --format '{{.Config.Image}}')" == "$IMAGE" ]]
[[ "$(docker inspect shoditsa-api-shoditsa-worker-1 --format '{{.State.Status}}')" == running ]]
ln -s "$RELEASE" "$ROOT/current.traffic-next-$SHA"
mv -Tf "$ROOT/current.traffic-next-$SHA" "$ROOT/current"
nginx_compose up -d --no-deps --force-recreate nginx
for attempt in $(seq 1 20); do
  if curl --fail --silent https://shoditsa.ru/api/v1/health/ready > "$BACKUP/public-ready.json"; then break; fi
  sleep 2
done
curl --fail --silent https://shoditsa.ru/api/v1/health/ready > "$BACKUP/public-ready.json"
curl --fail --silent -H 'Cache-Control: no-cache' https://shoditsa.ru/build-manifest.json > "$BACKUP/public-manifest.json"
python3 - "$BACKUP/public-manifest.json" "$SHA" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['commitSha']==sys.argv[2]
PY
for path in / /games/diagnosis /games/character /games/danetki /games/connections /games/svoyak; do
  curl --fail --silent "https://shoditsa.ru$path" > "$BACKUP/page-check.html"
  grep -Fq "name=\"shoditsa-build-sha\" content=\"$SHA\"" "$BACKUP/page-check.html"
done
[[ "$(curl --silent -o /dev/null -w '%{http_code}' https://shoditsa.ru/traffic-release-nonexistent-check)" == 404 ]]
docker exec repeto-nginx-1 nginx -t
printf '%s\n' "$(date -u +%FT%TZ)" > "$BACKUP/activated-at"
trap - ERR INT TERM
echo "Released $SHA; previous web/API and configuration retained in $BACKUP"
