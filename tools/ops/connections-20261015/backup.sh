#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
BACKUP=/opt/shoditsa/backups/pre-connections-content-20261015.dump
test ! -e "$BACKUP"
test "$(df -Pk /opt/shoditsa | awk 'NR==2 {print $4}')" -ge 2097152
docker exec shoditsa-api-shoditsa-postgres-1 pg_dump -U shoditsa_app -d shoditsa -Fc > "$BACKUP"
test -s "$BACKUP"
docker exec -i shoditsa-api-shoditsa-postgres-1 pg_restore --list < "$BACKUP" >/dev/null
sha256sum "$BACKUP" | tee "$BACKUP.sha256"
sha256sum --check "$BACKUP.sha256"
ls -lh "$BACKUP"
