#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${ADMIN_USER_ID:?ADMIN_USER_ID is required}"
ROOT="${SHODITSA_ROOT:-/opt/shoditsa}"
TMP="$ROOT/releases/$RELEASE_SHA.tmp"
FINAL="$ROOT/releases/$RELEASE_SHA"
test -f "$TMP/release.tar.gz"
(cd "$TMP" && sha256sum -c release.tar.gz.sha256)
tar -xzf "$TMP/release.tar.gz" -C "$TMP"
"$ROOT/app/infra/backup/backup-postgres.sh"
export APP_IMAGE_TAG="$RELEASE_SHA"
docker compose -f "$ROOT/app/compose.production.yml" --profile migrate run --rm migrate
docker compose -f "$ROOT/app/compose.production.yml" --profile migrate run --rm --no-deps --entrypoint node migrate apps/api/dist/content-import-dtf-comments.js --apply --activate --publish --actor-id="$ADMIN_USER_ID" --report=/tmp/dtf-game-comments-25-import-report.json
docker compose -f "$ROOT/app/compose.production.yml" --profile migrate run --rm --no-deps --entrypoint node migrate apps/api/dist/content-import-game-hints.js --apply --activate --actor-id="$ADMIN_USER_ID" --report=/tmp/game-plot-hints-import-report.json
docker compose -f "$ROOT/app/compose.production.yml" up -d postgres api worker
for attempt in {1..12}; do curl -fsS http://127.0.0.1:3001/api/v1/health/ready >/dev/null && break; sleep 5; done
curl -fsS http://127.0.0.1:3001/api/v1/health/ready >/dev/null
mv "$TMP" "$FINAL"
ln -sfn "$FINAL" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
nginx -t
systemctl reload nginx
find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | xargs -r rm -rf --
