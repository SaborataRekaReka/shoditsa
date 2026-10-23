#!/usr/bin/env bash
# Run on the existing Timeweb host after uploading the verified release bundle.
set -Eeuo pipefail
umask 077
SHA="${1:?release snapshot commit required}"
EXPECTED_IMAGE="${2:?expected current API image required}"
PREVIOUS_DUMP="${3:-}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
STAGE="/opt/shoditsa/staging/svoyak-$SHA"
COMPOSE=/opt/repeto/deploy/shoditsa-api/docker-compose.yml
ENV_FILE=/opt/repeto/deploy/shoditsa-api/.env
NGINX_CONFIG=/opt/repeto/deploy/nginx.ssl.conf
BACKUP="/opt/shoditsa/backups/svoyak-$SHA"
RELEASE="/opt/shoditsa/releases/$SHA"
IMAGE="shoditsa-api:$SHA"
exec 9>/opt/shoditsa/.svoyak-release.lock
flock -n 9 || { echo 'Another Svoyak release is active'; exit 1; }
api_compose() { docker compose --project-directory /opt/repeto/deploy/shoditsa-api --project-name shoditsa-api -f "$COMPOSE" "$@"; }
nginx_compose() { docker compose --project-directory /opt/repeto --project-name repeto -f /opt/repeto/docker-compose.prod.yml "$@"; }
CURRENT_IMAGE="$(docker inspect shoditsa-api-shoditsa-api-1 --format '{{.Config.Image}}')"
[[ "$CURRENT_IMAGE" == "$EXPECTED_IMAGE" ]] || { echo 'Production changed since preflight; stop and inspect'; exit 1; }
OLD_WEB="$(readlink -f /opt/shoditsa/current)"
[[ "$OLD_WEB" == /opt/shoditsa/releases/* && -d "$OLD_WEB/web" ]] || exit 1
[[ -f "$STAGE/api-dist/server.js" && -f "$STAGE/web/index.html" && -f "$STAGE/migrations/0056_svoyak_production.sql" ]] || exit 1
[[ ! -e "$BACKUP" && ! -e "$RELEASE" ]] || { echo 'Release already exists; inspect before retry'; exit 1; }
mkdir -p "$BACKUP"
cp "$COMPOSE" "$BACKUP/compose.yml"
cp "$ENV_FILE" "$BACKUP/api.env"
cp "$NGINX_CONFIG" "$BACKUP/nginx.conf"
printf '%s\n' "$OLD_WEB" > "$BACKUP/old-web-target"
if [[ -n "$PREVIOUS_DUMP" ]]; then
  [[ "$PREVIOUS_DUMP" =~ ^/opt/shoditsa/backups/svoyak-[a-f0-9]{40}/database.dump$ && -s "$PREVIOUS_DUMP" ]]
  ln "$PREVIOUS_DUMP" "$BACKUP/database.dump"
  printf '%s\n' "$PREVIOUS_DUMP" > "$BACKUP/reused-database-backup"
else
  docker exec shoditsa-api-shoditsa-postgres-1 pg_dump -U shoditsa_app -d shoditsa -Fc > "$BACKUP/database.dump"
fi
test -s "$BACKUP/database.dump"
docker exec -i shoditsa-api-shoditsa-postgres-1 pg_restore --list < "$BACKUP/database.dump" > "$BACKUP/database-contents.txt"
echo 'Database and configuration backup verified'
MUTATED=false
rollback() {
  local status=$?
  trap - ERR
  if [[ "$MUTATED" == true ]]; then
    echo 'Release failed; restoring previous API, worker, web and nginx configuration' >&2
    cp "$BACKUP/compose.yml" "$COMPOSE"
    cp "$BACKUP/api.env" "$ENV_FILE"
    cp "$BACKUP/nginx.conf" "$NGINX_CONFIG"
    ln -s "$OLD_WEB" /opt/shoditsa/current.svoyak-rollback
    mv -Tf /opt/shoditsa/current.svoyak-rollback /opt/shoditsa/current
    api_compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker || true
    nginx_compose up -d --no-deps --force-recreate nginx || true
  fi
  exit "$status"
}
trap rollback ERR
docker build --build-arg BASE_IMAGE="$EXPECTED_IMAGE" --build-arg GIT_SHA="$SHA" -t "$IMAGE" "$STAGE"
# Guard again after the image build: never overwrite a concurrent release.
[[ "$(docker inspect shoditsa-api-shoditsa-api-1 --format '{{.Config.Image}}')" == "$EXPECTED_IMAGE" ]]
[[ "$(readlink -f /opt/shoditsa/current)" == "$OLD_WEB" ]]
MUTATED=true
sed -i "s|image: shoditsa-api:[a-zA-Z0-9._-]*|image: $IMAGE|g" "$COMPOSE"
set_env() {
  local key="$1" value="$2"
  if grep -q "^$key=" "$ENV_FILE"; then sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"; else printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"; fi
}
set_env GIT_SHA "$SHA"
set_env SVOYAK_ENABLED true
api_compose --profile migrate run --rm --no-deps shoditsa-migrate
ADMIN_ID="$(docker exec shoditsa-api-shoditsa-postgres-1 psql -U shoditsa_app -d shoditsa -At -c "select u.id from \"user\" u join player_profiles p on p.user_id=u.id where lower(trim(u.email))='breneize@yandex.ru' and p.role='admin'")"
[[ "$ADMIN_ID" =~ ^[a-f0-9-]{36}$ ]]
api_compose --profile migrate run --rm --no-deps --entrypoint node shoditsa-migrate apps/api/dist/content-bootstrap-svoyak.js --apply --activate --actor-id="$ADMIN_ID"
api_compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3301/api/v1/health/ready > "$BACKUP/ready.json"; then break; fi
  sleep 2
done
curl --fail --silent http://127.0.0.1:3301/api/v1/meta > "$BACKUP/meta.json"
curl --fail --silent http://127.0.0.1:3301/api/v1/svoyak/catalog > "$BACKUP/svoyak-catalog.json"
docker exec -i shoditsa-api-shoditsa-api-1 node --input-type=module - "$SHA" <<'JS'
const [meta,catalog,ready]=await Promise.all(['meta','svoyak/catalog','health/ready'].map(async path=>{const r=await fetch('http://127.0.0.1:3001/api/v1/'+path);if(!r.ok)throw Error(path+': '+r.status);return r.json()}));
if(meta.buildSha!==process.argv[2]||!meta.features?.svoyakEnabled||!meta.activeRevision||!meta.modes?.length||catalog.localOnly!==false||!(catalog.playable>=5))throw Error('Release readiness mismatch: '+JSON.stringify({buildSha:meta.buildSha,features:meta.features,catalogKeys:Object.keys(catalog)}));
console.log('API, active catalog and Svoyak release verified');
JS
[[ "$(docker inspect shoditsa-api-shoditsa-worker-1 --format '{{.Config.Image}}')" == "$IMAGE" ]]
mkdir -p "$RELEASE"
cp -a "$STAGE/web" "$RELEASE/web"
cp "$STAGE/source-version.json" "$RELEASE/source-version.json"
bash "$STAGE/patch-nginx-not-found.sh" "$NGINX_CONFIG"
docker exec repeto-nginx-1 nginx -t
ln -s "$RELEASE" /opt/shoditsa/current.svoyak-next
mv -Tf /opt/shoditsa/current.svoyak-next /opt/shoditsa/current
nginx_compose up -d --no-deps --force-recreate nginx
for attempt in $(seq 1 20); do
  if curl --fail --silent https://shoditsa.ru/api/v1/svoyak/catalog > /dev/null; then break; fi
  sleep 2
done
curl --fail --silent https://shoditsa.ru/api/v1/health/ready > /dev/null
curl --fail --silent https://shoditsa.ru/games/svoyak > "$BACKUP/public-svoyak.html"
grep -Fq "name=\"shoditsa-build-sha\" content=\"$SHA\"" "$BACKUP/public-svoyak.html"
[[ "$(curl --silent -o /dev/null -w '%{http_code}' https://shoditsa.ru/not-a-real-svoyak-route)" == 404 ]]
trap - ERR
echo "Released $SHA; rollback files: $BACKUP"
