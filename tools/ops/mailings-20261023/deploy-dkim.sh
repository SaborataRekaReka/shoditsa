#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SHA="${1:-}"
BASE=9ffdec8439693a0c42f3275d11d9c40e3027d5e0
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] && [ "$SHA" != "$BASE" ] || exit 2
ROOT=/opt/shoditsa
WORK="$ROOT/incoming/mailings-dkim-$SHA"
COMPOSE=/opt/repeto/deploy/shoditsa-api/docker-compose.yml
ENVIRONMENT=/opt/repeto/deploy/shoditsa-api/.env
API=shoditsa-api-shoditsa-api-1
WORKER=shoditsa-api-shoditsa-worker-1
compose() { docker compose --project-directory /opt/repeto/deploy/shoditsa-api --project-name shoditsa-api -f "$COMPOSE" "$@"; }
exec 9>"$ROOT/direct-release.lock"
flock -n 9
test "$(docker inspect --format '{{.Config.Image}}' "$API")" = "shoditsa-api:$BASE"
test "$(docker inspect --format '{{.Config.Image}}' "$WORKER")" = "shoditsa-api:$BASE"
test "$(readlink -f "$ROOT/current")" = "$ROOT/releases/e17223ff13db7ce22719030c3aae517066471742"
test -f "$ROOT/secrets/mailings/site20261023.pem"
cd "$WORK"
test ! -e activated-at.txt
cp -a "$COMPOSE" compose.before.yml
cp -a "$ENVIRONMENT" environment.before
docker exec "$API" wget -q -O - http://127.0.0.1:3001/api/v1/meta > meta.before.json
docker exec "$API" node apps/api/dist/mailing.js status > mailing.before.json
sha256sum --check artifacts.sha256
mkdir overlay
tar -xzf api-overlay.tar.gz -C overlay --no-same-owner
docker build --build-arg "GIT_SHA=$SHA" -t "shoditsa-api:$SHA" overlay
rollback() {
  local code=$?
  trap - ERR
  cp -a compose.before.yml "$COMPOSE"
  cp -a environment.before "$ENVIRONMENT"
  compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
  docker exec repeto-nginx-1 nginx -s reload
  printf 'DKIM release failed; previous API and worker restored.\n' >&2
  exit "$code"
}
trap rollback ERR
export DKIM_RELEASE_SHA="$SHA"
python3 - <<'PY'
import os,pathlib,re
compose=pathlib.Path('/opt/repeto/deploy/shoditsa-api/docker-compose.yml')
text=compose.read_text()
line='      - /opt/shoditsa/shared/mailings:/srv/shoditsa/mailings:ro'
assert text.count(line)==2
text=text.replace(line,line+'\n      - /opt/shoditsa/secrets/mailings/site20261023.pem:/run/secrets/shoditsa-mailing-dkim.pem:ro')
text,count=re.subn(r'(image:\s*)shoditsa-api:9ffdec8439693a0c42f3275d11d9c40e3027d5e0',r'\g<1>shoditsa-api:'+os.environ['DKIM_RELEASE_SHA'],text)
assert count==3
compose.write_text(text)
env=pathlib.Path('/opt/repeto/deploy/shoditsa-api/.env')
text=env.read_text()
assert not re.search(r'^MAILING_DKIM_',text,re.M)
text,count=re.subn(r'^GIT_SHA=.*$', 'GIT_SHA='+os.environ['DKIM_RELEASE_SHA'],text,flags=re.M)
assert count==1
env.write_text(text.rstrip()+'\nMAILING_DKIM_PRIVATE_KEY_FILE=/run/secrets/shoditsa-mailing-dkim.pem\nMAILING_DKIM_SELECTOR=site20261023\n')
PY
compose config --quiet
compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
# Refresh cached upstream DNS as soon as Docker recreates the API.
docker exec repeto-nginx-1 nginx -t
docker exec repeto-nginx-1 nginx -s reload
ready=false
for attempt in {1..24}; do
  if docker exec "$API" wget -q -O - http://127.0.0.1:3001/api/v1/health/ready > readiness.json; then ready=true; break; fi
  sleep 2
done
test "$ready" = true
docker exec "$API" wget -q -O - http://127.0.0.1:3001/api/v1/meta > meta.after.json
docker exec "$API" node apps/api/dist/mailing.js status > mailing.after.json
python3 - <<'PY'
import json,os
a=json.load(open('meta.before.json')); b=json.load(open('meta.after.json'))
for key in ['activeRevision','modes','features','growth']: assert a[key]==b[key],key
assert b['buildSha']==os.environ['DKIM_RELEASE_SHA']
a=json.load(open('mailing.before.json'));b=json.load(open('mailing.after.json'))
assert a==b
assert b['campaign']['status']=='draft' and b['campaign']['prepared_at'] is None
assert b['counts']==[{'kind':'test','status':'accepted','count':1}]
PY
docker exec "$API" node apps/api/dist/mailing.js verify
test "$(docker inspect --format '{{.State.Status}}' "$WORKER")" = running
test "$(curl -s -o /dev/null -w '%{http_code}' https://shoditsa.ru/api/v1/admin/mailings/console)" = 401
trap - ERR
date -u +%FT%TZ > activated-at.txt
printf 'MAILING_DKIM_RELEASE_ACTIVE %s\n' "$SHA"
