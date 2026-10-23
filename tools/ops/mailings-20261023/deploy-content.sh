#!/usr/bin/env bash
# Immutable approved content update before the first test or audience snapshot.
set -Eeuo pipefail
umask 077
REV="${1:-}"
[[ "$REV" =~ ^[0-9a-f]{40}$ ]] || exit 2
CODE=9ffdec8439693a0c42f3275d11d9c40e3027d5e0
ROOT=/opt/shoditsa
WORK="$ROOT/incoming/mailings-$CODE"
COMPOSE=/opt/repeto/deploy/shoditsa-api/docker-compose.yml
ENVIRONMENT=/opt/repeto/deploy/shoditsa-api/.env
CONTENT="$ROOT/shared/mailings/autumn-2026-v1-$REV"
API=shoditsa-api-shoditsa-api-1
PG=shoditsa-api-shoditsa-postgres-1
compose() { docker compose --project-directory /opt/repeto/deploy/shoditsa-api --project-name shoditsa-api -f "$COMPOSE" "$@"; }
exec 9>"$ROOT/direct-release.lock"
flock -n 9
test "$(docker inspect --format '{{.Config.Image}}' "$API")" = "shoditsa-api:$CODE"
test "$(docker exec "$PG" psql -X -U shoditsa_app -d shoditsa -Atc 'select count(*) from mailing_campaigns')" = 0
cd "$WORK"
sha256sum --check mailing-content.sha256
test ! -e "$CONTENT"
cp -a "$COMPOSE" content-compose.before.yml
cp -a "$ENVIRONMENT" content-environment.before
install -d -m 755 "$ROOT/shared/mailings" "$CONTENT"
tar -xzf mailing-content.tar.gz -C "$CONTENT" --no-same-owner
find "$CONTENT" -type d -exec chmod 755 {} +
find "$CONTENT" -type f -exec chmod 644 {} +
rollback() {
  local code=$?
  trap - ERR
  cp -a content-compose.before.yml "$COMPOSE"
  cp -a content-environment.before "$ENVIRONMENT"
  compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
  docker exec repeto-nginx-1 nginx -s reload
  exit "$code"
}
trap rollback ERR
python3 - "$COMPOSE" "$ENVIRONMENT" "$REV" <<'PY'
from pathlib import Path
import sys
compose,env,rev=map(str,sys.argv[1:])
p=Path(compose); text=p.read_text()
mount='      - /opt/shoditsa/shared/mailings:/srv/shoditsa/mailings:ro'
if mount not in text:
    for marker in ['      - /opt/shoditsa/shared/media:/srv/shoditsa/media','      - /opt/repeto/deploy/shoditsa-api/enrichment:/app/data/enrichment-agent']:
        if text.count(marker)!=1: raise RuntimeError('Unexpected compose volume context')
        text=text.replace(marker,marker+'\n'+mount)
    p.write_text(text)
p=Path(env); lines=p.read_text().splitlines()
lines=[line for line in lines if not line.startswith('MAILING_CONTENT_ROOT=')]
lines.append('MAILING_CONTENT_ROOT=/srv/shoditsa/mailings/autumn-2026-v1-'+rev)
p.write_text('\n'.join(lines)+'\n')
PY
compose config --quiet
compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
ready=false
for attempt in {1..24}; do
  if docker exec "$API" wget -q -O - http://127.0.0.1:3001/api/v1/health/ready > content-readiness.json; then ready=true; break; fi
  sleep 2
done
test "$ready" = true
docker exec "$API" node apps/api/dist/mailing.js verify
docker exec "$API" node apps/api/dist/mailing.js status > content-status.json
docker exec repeto-nginx-1 nginx -t
docker exec repeto-nginx-1 nginx -s reload
trap - ERR
printf 'MAILING_CONTENT_ACTIVE %s\n' "$REV"
