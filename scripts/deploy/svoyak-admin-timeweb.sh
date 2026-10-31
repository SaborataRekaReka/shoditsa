#!/usr/bin/env bash
# Paired UI/API release, without content activation or database migrations.
set -Eeuo pipefail
umask 077
ACTION="${1:?prepare or activate}"
SHA="${2:?release SHA}"
BASE=dcedd0aa467d3452e494c167a39c74dfd44af4fd
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
ROOT=/opt/shoditsa
WORK="$ROOT/incoming/svoyak-admin-$SHA"
RELEASE="$ROOT/releases/$SHA-svoyak-admin"
COMPOSE=/opt/repeto/deploy/shoditsa-api/docker-compose.yml
ENVIRONMENT=/opt/repeto/deploy/shoditsa-api/.env
API=shoditsa-api-shoditsa-api-1
WORKER=shoditsa-api-shoditsa-worker-1
compose() { docker compose --project-directory /opt/repeto/deploy/shoditsa-api --project-name shoditsa-api -f "$COMPOSE" "$@"; }
nginx_compose() { docker compose --project-directory /opt/repeto --project-name repeto -f /opt/repeto/docker-compose.prod.yml "$@"; }
assert_base() {
  [[ "$(docker inspect --format '{{.Config.Image}}' "$API")" == "shoditsa-api:$BASE" ]]
  [[ "$(docker inspect --format '{{.Config.Image}}' "$WORKER")" == "shoditsa-api:$BASE" ]]
  [[ "$(readlink -f "$ROOT/current")" == "$ROOT/releases/$BASE-club89-20261030" ]]
}
case "$ACTION" in
prepare)
  assert_base
  test ! -e "$WORK"
  install -d -m 700 "$WORK"
  cp -a "$COMPOSE" "$WORK/compose.before.yml"
  cp -a "$ENVIRONMENT" "$WORK/environment.before"
  readlink -f "$ROOT/current" > "$WORK/web.before"
  curl -fsS http://127.0.0.1:3301/api/v1/meta > "$WORK/meta.before.json"
  curl -fsS http://127.0.0.1:3301/api/v1/svoyak/catalog > "$WORK/catalog.before.json"
  docker exec shoditsa-api-shoditsa-postgres-1 pg_dump -U shoditsa_app -d shoditsa -Fc -t svoyak_content_revisions -t svoyak_questions -t app_settings > "$WORK/editor-content.before.dump"
  docker exec -i shoditsa-api-shoditsa-postgres-1 pg_restore --list < "$WORK/editor-content.before.dump" > "$WORK/editor-content.before.list"
  echo "PREPARED $WORK"
  ;;
activate)
  exec 9>"$ROOT/direct-release.lock"
  flock -n 9
  assert_base
  cd "$WORK"
  test -s offhost-backup-verified
  cmp "$COMPOSE" compose.before.yml
  cmp "$ENVIRONMENT" environment.before
  sha256sum --check artifacts.sha256
  test "$(df -Pk "$ROOT" | awk 'NR==2{print $4}')" -gt 131072
  test ! -e "$RELEASE"
  mkdir overlay
  tar -xzf api-overlay.tar.gz -C overlay --no-same-owner
  docker build --build-arg "GIT_SHA=$SHA" -t "shoditsa-api:$SHA" overlay
  mkdir -p "$RELEASE/web"
  OLD_WEB="$(cat web.before)"
  cp -al "$OLD_WEB/web/." "$RELEASE/web/"
  # Unlink overwritten files before extraction; previous release hardlinks stay intact.
  python3 - "$WORK/web-overlay.tar.gz" "$RELEASE/web" "$SHA" <<'PY'
import pathlib,tarfile,sys
root=pathlib.Path(sys.argv[2]).resolve()
allowed={'assets','seo','index.html','build-manifest.json','sitemap.xml','seo-manifest.json','robots.txt','manifest.webmanifest','sw.js','offline.html'}
with tarfile.open(sys.argv[1]) as archive:
    for item in archive.getmembers():
        path=pathlib.PurePosixPath(item.name)
        assert not path.is_absolute() and '..' not in path.parts and path.parts[0] in allowed
        assert item.isfile() or item.isdir()
        target=root.joinpath(*path.parts)
        assert target.resolve().is_relative_to(root)
        if item.isfile() and target.exists():
            assert target.is_file() and not target.is_symlink()
            target.unlink()
PY
  tar -xzf web-overlay.tar.gz -C "$RELEASE/web" --no-same-owner
  chmod a+rX "$RELEASE" "$RELEASE/web"
  grep -Fq "name=\"shoditsa-build-sha\" content=\"$SHA\"" "$RELEASE/web/index.html"
  test ! -d "$RELEASE/web/data"
  test ! -d "$RELEASE/web/city-content"
  MUTATED=false
  rollback() {
    code=$?
    trap - ERR
    if [[ "$MUTATED" == true ]]; then
      cp -a compose.before.yml "$COMPOSE"
      cp -a environment.before "$ENVIRONMENT"
      ln -s "$OLD_WEB" "$ROOT/current.rollback-svoyak-admin-$SHA"
      mv -Tf "$ROOT/current.rollback-svoyak-admin-$SHA" "$ROOT/current"
      compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker || true
      nginx_compose up -d --no-deps --force-recreate nginx || true
    fi
    echo 'Release failed; previous paired release restored' >&2
    exit "$code"
  }
  trap rollback ERR
  assert_base
  MUTATED=true
  sed -Ei "s#^([[:space:]]*image:[[:space:]]*)shoditsa-api:[^[:space:]]+#\1shoditsa-api:$SHA#" "$COMPOSE"
  if grep -q '^GIT_SHA=' "$ENVIRONMENT"; then sed -Ei "s/^GIT_SHA=.*/GIT_SHA=$SHA/" "$ENVIRONMENT"; else printf '\nGIT_SHA=%s\n' "$SHA" >> "$ENVIRONMENT"; fi
  compose config --quiet
  compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
  for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:3301/api/v1/health/ready > ready.json; then break; fi
    sleep 2
  done
  curl -fsS http://127.0.0.1:3301/api/v1/health/ready > ready.json
  curl -fsS http://127.0.0.1:3301/api/v1/meta > meta.after.json
  curl -fsS http://127.0.0.1:3301/api/v1/svoyak/catalog > catalog.after.json
  docker run --rm --network none --user 0 -e "EXPECTED_SHA=$SHA" --mount "type=bind,source=$WORK,target=/proof,readonly" "shoditsa-api:$SHA" node --input-type=module -e '
    import fs from "node:fs";
    const read=p=>JSON.parse(fs.readFileSync("/proof/"+p));
    const a=read("meta.before.json"),b=read("meta.after.json");
    for(const key of ["activeRevision","modes","growth","features","commerce"])if(JSON.stringify(a[key])!==JSON.stringify(b[key]))throw Error("Changed invariant: "+key);
    if(b.buildSha!==process.env.EXPECTED_SHA||!b.activeRevision||!b.modes.length||b.modes.some(m=>m.count<=0))throw Error("Meta gate failed");
    if(JSON.stringify(read("catalog.before.json"))!==JSON.stringify(read("catalog.after.json")))throw Error("Svoyak content changed");'
  [[ "$(docker inspect --format '{{.Config.Image}}' "$WORKER")" == "shoditsa-api:$SHA" ]]
  [[ "$(docker inspect --format '{{.State.Status}}' "$WORKER")" == running ]]
  ln -s "$RELEASE" "$ROOT/current.next-svoyak-admin-$SHA"
  mv -Tf "$ROOT/current.next-svoyak-admin-$SHA" "$ROOT/current"
  nginx_compose up -d --no-deps --force-recreate nginx
  docker exec repeto-nginx-1 nginx -t
  for attempt in {1..20}; do
    if curl -fsS https://shoditsa.ru/build-manifest.json > web.after.json && grep -Fq "$SHA" web.after.json; then break; fi
    sleep 1
  done
  grep -Fq "$SHA" web.after.json
  curl -fsS https://shoditsa.ru/api/v1/health/ready > public.ready.json
  curl -fsS https://shoditsa.ru/api/v1/meta > public.meta.json
  [[ "$(curl -s -o /dev/null -w '%{http_code}' https://shoditsa.ru/api/v1/admin/svoyak)" == 401 ]]
  curl -fsS https://shoditsa.ru/admin/svoyak | grep -Fq "$SHA"
  date -u +%FT%TZ > activated-at.txt
  trap - ERR
  echo "RELEASED $SHA"
  ;;
*) exit 2;;
esac
