#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${1:?Usage: patch-nginx-not-found.sh /path/to/nginx.conf}"
MARKER='# BEGIN SHODITSA_EXPLICIT_SPA_ROUTES'

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Nginx config does not exist: $CONFIG_PATH" >&2
  exit 1
fi

if grep -Fq "$MARKER" "$CONFIG_PATH"; then
  if grep -Fq 'try_files $uri $uri/ /index.html;' "$CONFIG_PATH"; then
    echo "Explicit SPA route marker exists but the legacy catch-all fallback is still active" >&2
    exit 1
  fi
  exit 0
fi

TEMP_PATH="$(mktemp "${CONFIG_PATH}.not-found.XXXXXX")"
trap 'rm -f "$TEMP_PATH"' EXIT

awk '
function emit_explicit_routes() {
  print "    # BEGIN SHODITSA_EXPLICIT_SPA_ROUTES"
  print "    location = / {"
  print "        try_files /index.html =404;"
  print "        add_header Cache-Control \"no-cache\" always;"
  print "    }"
  print ""
  print "    location ~ ^/(archive|profile|login|register)$ {"
  print "        try_files /index.html =404;"
  print "        add_header X-Robots-Tag \"noindex, follow, noarchive\" always;"
  print "        add_header Cache-Control \"no-cache\" always;"
  print "    }"
  print ""
  print "    location ~ ^/(play/(movie|series|anime|game|music|diagnosis|city|animal|book|connections)|sessions/[^/]+|review/music|purchase/return|danetki/join/[^/]+|specials/[^/]+)$ {"
  print "        try_files /index.html =404;"
  print "        add_header X-Robots-Tag \"noindex, follow, noarchive\" always;"
  print "        add_header Cache-Control \"no-cache\" always;"
  print "    }"
  print ""
  print "    location ~ ^/legal/(terms|tariffs|privacy|personal-data-consent|refunds|contacts)$ {"
  print "        try_files /index.html =404;"
  print "        add_header Cache-Control \"no-cache\" always;"
  print "    }"
  print ""
  print "    location = /create-a-game {"
  print "        try_files /index.html =404;"
  print "        add_header X-Robots-Tag \"noindex, follow, noarchive\" always;"
  print "        add_header Cache-Control \"no-cache\" always;"
  print "    }"
  print ""
  print "    location = /ui-kit {"
  print "        try_files /index.html =404;"
  print "        add_header X-Robots-Tag \"noindex, nofollow, noarchive\" always;"
  print "        add_header Cache-Control \"no-cache\" always;"
  print "    }"
  print "    # END SHODITSA_EXPLICIT_SPA_ROUTES"
  injected = 1
}

index($0, "location ~ ^/(play|sessions|archive|profile|review|login|register)(/|$) {") {
  emit_explicit_routes()
  skipping_old_private_route = 1
  next
}

skipping_old_private_route {
  if ($0 ~ /^[[:space:]]*}[[:space:]]*$/) skipping_old_private_route = 0
  next
}

{
  if (index($0, "try_files $uri $uri/ /index.html;")) {
    sub(/try_files \$uri \$uri\/ \/index\.html;/, "try_files $uri =404;")
    replaced_fallback = 1
  }
  print
}

END {
  if (!injected || !replaced_fallback) exit 42
}
' "$CONFIG_PATH" > "$TEMP_PATH" || {
  status=$?
  if [ "$status" -eq 42 ]; then
    echo "Nginx config does not match the expected pre-fix route layout" >&2
  fi
  exit "$status"
}

cp "$TEMP_PATH" "$CONFIG_PATH"
