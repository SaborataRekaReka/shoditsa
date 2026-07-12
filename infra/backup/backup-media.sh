#!/usr/bin/env sh
set -eu
: "${OFFSITE_MEDIA_TARGET:?Set OFFSITE_MEDIA_TARGET, for example backup@host:/srv/shoditsa-media/}"
ROOT="${SHODITSA_ROOT:-/opt/shoditsa}"
MANIFEST="$ROOT/shared/backups/media-manifest-$(date -u +%Y%m%dT%H%M%SZ).sha256"
find "$ROOT/shared/media" -type f -print0 | sort -z | xargs -0 sha256sum > "$MANIFEST"
rsync -a --ignore-existing --delete-delay "$ROOT/shared/media/" "$OFFSITE_MEDIA_TARGET"
printf '{"event":"media_backup_complete","manifest":"%s"}\n' "$MANIFEST"
