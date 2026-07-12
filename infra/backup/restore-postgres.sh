#!/usr/bin/env sh
set -eu
if [ "$#" -ne 1 ]; then echo "Usage: $0 /path/to/backup.dump" >&2; exit 2; fi
DUMP="$1"
test -f "$DUMP"
test -f "$DUMP.sha256"
(cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256")
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL for a disposable target database}"
pg_restore --clean --if-exists --no-owner --dbname "$RESTORE_DATABASE_URL" "$DUMP"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'select count(*) from content_items'
