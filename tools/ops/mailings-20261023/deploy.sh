#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SHA="${2:-}"
BASE=e17223ff13db7ce22719030c3aae517066471742
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] && [ "$SHA" != "$BASE" ] || exit 2
ROOT=/opt/shoditsa
WORK="$ROOT/incoming/mailings-$SHA"
COMPOSE=/opt/repeto/deploy/shoditsa-api/docker-compose.yml
ENVIRONMENT=/opt/repeto/deploy/shoditsa-api/.env
API=shoditsa-api-shoditsa-api-1
WORKER=shoditsa-api-shoditsa-worker-1
PG=shoditsa-api-shoditsa-postgres-1
compose() { docker compose --project-directory /opt/repeto/deploy/shoditsa-api --project-name shoditsa-api -f "$COMPOSE" "$@"; }
meta() { docker exec "$API" wget -q -O - http://127.0.0.1:3001/api/v1/meta; }
assert_base() {
  test "$(docker inspect --format '{{.Config.Image}}' "$API")" = "shoditsa-api:$BASE"
  test "$(docker inspect --format '{{.Config.Image}}' "$WORKER")" = "shoditsa-api:$BASE"
  test "$(readlink -f "$ROOT/current")" = "$ROOT/releases/$BASE"
}
case "${1:-}" in
 prepare)
  assert_base
  test ! -e "$WORK"
  install -d -m 700 "$WORK" "$ROOT/backups"
  cp -a "$COMPOSE" "$WORK/compose.before.yml"
  cp -a "$ENVIRONMENT" "$WORK/environment.before"
  meta > "$WORK/meta.before.json"
  docker exec "$PG" psql -X -v ON_ERROR_STOP=1 -U shoditsa_app -d shoditsa -Atc 'select count(*),max(created_at) from drizzle.__drizzle_migrations' > "$WORK/migrations.before"
  docker exec "$PG" pg_dump -U shoditsa_app -d shoditsa -Fc > "$WORK/database.before.dump"
  test -s "$WORK/database.before.dump"
  docker exec -i "$PG" pg_restore --list < "$WORK/database.before.dump" >/dev/null
  cd "$WORK"
  sha256sum database.before.dump > backup.sha256
  printf 'BACKUP_READY %s\n' "$WORK"
  ;;
 activate)
  exec 9>"$ROOT/direct-release.lock"
  flock -n 9
  assert_base
  cd "$WORK"
  test -f offhost-backup-verified
  test ! -e activated-at.txt
  cmp "$COMPOSE" compose.before.yml
  cmp "$ENVIRONMENT" environment.before
  sha256sum --check artifacts.sha256
  sha256sum --check backup.sha256
  if [ ! -d overlay ]; then
    mkdir overlay
    tar -xzf api-overlay.tar.gz -C overlay --no-same-owner
  fi
  docker build --build-arg "GIT_SHA=$SHA" -t "shoditsa-api:$SHA" overlay
  rollback() {
    local code=$?
    trap - ERR
    cp -a compose.before.yml "$COMPOSE"
    cp -a environment.before "$ENVIRONMENT"
    compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
    docker exec repeto-nginx-1 nginx -s reload
    printf 'Mailing release failed, previous API and worker restored. Additive migration retained.\n' >&2
    exit "$code"
  }
  trap rollback ERR
  # Additive schema only. The current API can continue serving while this runs.
  docker run --rm --network shoditsa_internal --env-file /opt/repeto/deploy/shoditsa-api/.env "shoditsa-api:$SHA" node apps/api/dist/migrate.js
  if grep -q '^GIT_SHA=' "$ENVIRONMENT"; then
    sed -Ei "s/^GIT_SHA=.*/GIT_SHA=$SHA/" "$ENVIRONMENT"
  else
    printf '\nGIT_SHA=%s\n' "$SHA" >> "$ENVIRONMENT"
  fi
  sed -Ei "s#^([[:space:]]*image:[[:space:]]*)shoditsa-api:[^[:space:]]+#\1shoditsa-api:$SHA#" "$COMPOSE"
  compose config --quiet
  compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
  ready=false
  for attempt in {1..24}; do
    if docker exec "$API" wget -q -O - http://127.0.0.1:3001/api/v1/health/ready > readiness.json; then ready=true; break; fi
    sleep 2
  done
  test "$ready" = true
  test "$(docker inspect --format '{{.Config.Image}}' "$WORKER")" = "shoditsa-api:$SHA"
  test "$(docker inspect --format '{{.State.Status}}' "$WORKER")" = running
  meta > meta.after.json
  docker run --rm --network none --user 0 -e "EXPECTED_SHA=$SHA" --mount "type=bind,source=$WORK,target=/proof,readonly" "shoditsa-api:$SHA" node -e '
    const fs=require("fs"),a=JSON.parse(fs.readFileSync("/proof/meta.before.json")),b=JSON.parse(fs.readFileSync("/proof/meta.after.json"));
    for(const key of ["activeRevision","modes","features","growth"])if(JSON.stringify(a[key])!==JSON.stringify(b[key]))throw Error("Changed production invariant "+key);
    if(b.buildSha!==process.env.EXPECTED_SHA||!b.activeRevision||!b.modes.length||b.modes.some(x=>x.count<=0))throw Error("Production meta gate failed");'
  # This backend-only release serves its admin HTML through /api; the SPA stays on its verified production build.
  test "$(readlink -f "$ROOT/current")" = "$ROOT/releases/$BASE"
  docker exec "$API" node apps/api/dist/mailing.js verify
  docker exec "$API" node apps/api/dist/mailing.js status > mailing.after.json
  docker exec repeto-nginx-1 nginx -t
  docker exec repeto-nginx-1 nginx -s reload
  test "$(curl -s -o /dev/null -w '%{http_code}' https://shoditsa.ru/api/v1/admin/mailings/console)" = 401
  trap - ERR
  date -u +%FT%TZ > activated-at.txt
  printf 'MAILING_RELEASE_ACTIVE %s\n' "$SHA"
  ;;
 *) exit 2;;
esac
