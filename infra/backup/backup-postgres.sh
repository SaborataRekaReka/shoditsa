#!/usr/bin/env sh
set -eu
ROOT="${SHODITSA_ROOT:-/opt/shoditsa}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$ROOT/shared/backups/postgres/$STAMP.dump"
mkdir -p "$(dirname "$TARGET")"
chmod 700 "$ROOT/shared/backups" "$ROOT/shared/backups/postgres"
docker compose -f "$ROOT/app/compose.production.yml" exec -T postgres pg_dump -U shoditsa_app -d shoditsa -Fc > "$TARGET"
sha256sum "$TARGET" > "$TARGET.sha256"
find "$ROOT/shared/backups/postgres" -type f -name '*.dump' -mtime +186 -delete
find "$ROOT/shared/backups/postgres" -type f -name '*.sha256' -mtime +186 -delete
printf '{"event":"backup_complete","file":"%s","timestamp":"%s"}\n' "$TARGET" "$STAMP"
