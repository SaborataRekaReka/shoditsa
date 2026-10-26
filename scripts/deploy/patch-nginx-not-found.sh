#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${1:?Usage: patch-nginx-not-found.sh /path/to/nginx.conf}"
MARKER='# BEGIN SHODITSA_EXPLICIT_SPA_ROUTES'
UTILITY_ROUTE_PATTERN='location[[:space:]]+~[[:space:]]+\^/\(partners\|specials\|club\)\$'
UTILITY_ROUTE_BLOCK_PATTERN='location[[:space:]]+~[[:space:]]+\^/\(partners\|specials\|club\)\$[[:space:]]*\{[^}]*try_files[[:space:]]+/seo\$uri\.html[[:space:]]+=404;'
DANETKI_CATALOG_ROUTE_PATTERN='location[[:space:]]+~[[:space:]]+\^/danetki\(\?:/\[\^/\]\+\)\?\$'
DANETKI_CATALOG_ROUTE_BLOCK_PATTERN='location[[:space:]]+~[[:space:]]+\^/danetki\(\?:/\[\^/\]\+\)\?\$[[:space:]]*\{[^}]*try_files[[:space:]]+/seo\$uri\.html[[:space:]]+=404;'

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Nginx config does not exist: $CONFIG_PATH" >&2
  exit 1
fi

# Add only the new semantic title to the existing canonical game allowlist.
ensure_word_seo_route() {
  if grep -Eq 'location[[:space:]]+~[[:space:]]+\^/games/\([^)]*word[^)]*\)\$' "$CONFIG_PATH"; then return 0; fi
  local word_temp_path
  word_temp_path="$(mktemp "${CONFIG_PATH}.word-route.XXXXXX")"
  if ! awk '
    index($0, "location ~ ^/games/(") { sub(/\)\$/, "|word)$"); found=1 }
    { print }
    END { if (!found) exit 42 }
  ' "$CONFIG_PATH" > "$word_temp_path"; then
    rm -f "$word_temp_path"
    echo "Canonical game route missing for the semantic title" >&2
    return 1
  fi
  cp "$word_temp_path" "$CONFIG_PATH"
  rm -f "$word_temp_path"
}

ensure_utility_seo_route() {
  if grep -Pzq "$UTILITY_ROUTE_BLOCK_PATTERN" "$CONFIG_PATH"; then
    return 0
  fi
  if grep -Eq "$UTILITY_ROUTE_PATTERN" "$CONFIG_PATH"; then
    echo "The Partners, Specials and Club route exists but does not serve route-specific SEO HTML" >&2
    return 1
  fi

  local utility_temp_path
  utility_temp_path="$(mktemp "${CONFIG_PATH}.utility-routes.XXXXXX")"
  if awk '
    /^[[:space:]]*location[[:space:]]*=[[:space:]]*\/games\/together[[:space:]]*\{/ && !injected {
      print "    location ~ ^/(partners|specials|club)$ {"
      print "        try_files /seo$uri.html =404;"
      print "        add_header Cache-Control \"no-cache\" always;"
      print "    }"
      print ""
      injected = 1
    }
    { print }
    END { if (!injected) exit 42 }
  ' "$CONFIG_PATH" > "$utility_temp_path"; then
    :
  else
    status=$?
    rm -f "$utility_temp_path"
    if [ "$status" -eq 42 ]; then
      echo "Nginx config is missing the /games/together anchor for utility SEO routes" >&2
    fi
    return "$status"
  fi

  cp "$utility_temp_path" "$CONFIG_PATH"
  rm -f "$utility_temp_path"
  if ! grep -Pzq "$UTILITY_ROUTE_BLOCK_PATTERN" "$CONFIG_PATH"; then
    echo "Could not add the Partners, Specials and Club SEO routes" >&2
    return 1
  fi
}

ensure_danetki_catalog_route() {
  if grep -Pzq "$DANETKI_CATALOG_ROUTE_BLOCK_PATTERN" "$CONFIG_PATH"; then
    return 0
  fi
  if grep -Eq "$DANETKI_CATALOG_ROUTE_PATTERN" "$CONFIG_PATH"; then
    echo "The Danetki catalog route exists but does not serve route-specific SEO HTML" >&2
    return 1
  fi

  local catalog_temp_path
  catalog_temp_path="$(mktemp "${CONFIG_PATH}.danetki-catalog.XXXXXX")"
  if awk '
    /^[[:space:]]*location[[:space:]]*=[[:space:]]*\/games\/together[[:space:]]*\{/ && !injected {
      print "    location ~ ^/danetki(?:/[^/]+)?$ {"
      print "        try_files /seo$uri.html =404;"
      print "        add_header Cache-Control \"no-cache\" always;"
      print "    }"
      print ""
      injected = 1
    }
    { print }
    END { if (!injected) exit 42 }
  ' "$CONFIG_PATH" > "$catalog_temp_path"; then
    :
  else
    status=$?
    rm -f "$catalog_temp_path"
    if [ "$status" -eq 42 ]; then
      echo "Nginx config is missing the /games/together anchor for the Danetki catalog" >&2
    fi
    return "$status"
  fi

  cp "$catalog_temp_path" "$CONFIG_PATH"
  rm -f "$catalog_temp_path"
  if ! grep -Pzq "$DANETKI_CATALOG_ROUTE_BLOCK_PATTERN" "$CONFIG_PATH"; then
    echo "Could not add the Danetki catalog SEO route" >&2
    return 1
  fi
}

ensure_application_routes() {
  local application_temp_path
  application_temp_path="$(mktemp "${CONFIG_PATH}.application-routes.XXXXXX")"
  if ! awk '
    index($0, "# BEGIN SHODITSA_EXPLICIT_SPA_ROUTES") { in_application = 1 }
    in_application && index($0, "location ~ ^/(archive|profile|") {
      print "    location ~ ^/(archive|profile|login|register|lobby|leaderboard|quests|settings|support|blog)$ {"
      private_routes = 1
      next
    }
    in_application && index($0, "location ~ ^/(play/(") {
      print "    location ~ ^/(play/(movie|series|anime|game|music|diagnosis|city|animal|book|character|connections)|sessions/[^/]+|review/music|purchase/return|danetki/join/[^/]+|specials/[^/]+|club/membership|blog/[^/]+)$ {"
      nested_routes = 1
      next
    }
    { print }
    index($0, "# END SHODITSA_EXPLICIT_SPA_ROUTES") { in_application = 0 }
    END { if (!private_routes || !nested_routes) exit 42 }
  ' "$CONFIG_PATH" > "$application_temp_path"; then
    rm -f "$application_temp_path"
    echo "Could not locate the application route allow-list" >&2
    return 1
  fi
  cp "$application_temp_path" "$CONFIG_PATH"
  rm -f "$application_temp_path"
}

ensure_svoyak_routes() {
  local svoyak_temp_path has_svoyak_landing=0 has_svoyak_rooms=0
  if grep -Pzq 'location\s*=\s*/games/svoyak\s*\{[^}]*try_files\s+/seo/games/svoyak\.html\s+=404;[^}]*\}' "$CONFIG_PATH"; then has_svoyak_landing=1; fi
  if grep -Fq 'location ~ "^/svoyak/' "$CONFIG_PATH"; then has_svoyak_rooms=1; fi
  svoyak_temp_path="$(mktemp "${CONFIG_PATH}.svoyak-routes.XXXXXX")"
  if ! awk -v has_landing="$has_svoyak_landing" -v has_rooms="$has_svoyak_rooms" '
    index($0, "location ~ \"^/(games/svoyak|svoyak/") {
      print "    location ~ \"^/svoyak/(create|(join|rooms)/[A-Fa-f0-9]{6}(/result)?)/?$\" {"
      has_rooms = 1
      next
    }
    /^[[:space:]]*location[[:space:]]*=[[:space:]]*\/games\/together[[:space:]]*\{/ && !injected {
      if (!has_landing) {
        print "    location = /games/svoyak {"
        print "        try_files /seo/games/svoyak.html =404;"
        print "        add_header Cache-Control \"no-cache\" always;"
        print "    }"
        print ""
      }
      if (!has_rooms) {
        print "    location ~ \"^/svoyak/(create|(join|rooms)/[A-Fa-f0-9]{6}(/result)?)/?$\" {"
        print "        try_files /index.html =404;"
        print "        add_header X-Robots-Tag \"noindex, follow, noarchive\" always;"
        print "        add_header Cache-Control \"no-cache\" always;"
        print "    }"
        print ""
      }
      injected = 1
    }
    { print }
    END { if (!injected) exit 42 }
  ' "$CONFIG_PATH" > "$svoyak_temp_path"; then rm -f "$svoyak_temp_path"; return 1; fi
  cp "$svoyak_temp_path" "$CONFIG_PATH"
  rm -f "$svoyak_temp_path"
}

ensure_public_trailing_slash_redirects() {
  local shoditsa_roots shoditsa_root redirect_temp_path
  mapfile -t shoditsa_roots < <(awk '$1 == "root" && ($2 == "/var/www/shoditsa;" || $2 == "/opt/shoditsa/current/web;") { sub(/;$/, "", $2); print $2 }' "$CONFIG_PATH")
  if [ "${#shoditsa_roots[@]}" -ne 1 ]; then
    echo "Expected one Shoditsa document root for the public redirect include" >&2
    return 1
  fi
  shoditsa_root="${shoditsa_roots[0]}"
  if grep -Fq "include $shoditsa_root/seo/public-trailing-slash.conf;" "$CONFIG_PATH"; then
    return 0
  fi
  redirect_temp_path="$(mktemp "$CONFIG_PATH.public-redirects.XXXXXX")"
  awk -v target_root="$shoditsa_root" '
    { print }
    $1 == "root" && $2 == target_root ";" {
      print "    include " target_root "/seo/public-trailing-slash.conf;"
    }
  ' "$CONFIG_PATH" > "$redirect_temp_path"
  cp "$redirect_temp_path" "$CONFIG_PATH"
  rm -f "$redirect_temp_path"
}

if grep -Fq "$MARKER" "$CONFIG_PATH"; then
  # A host config may contain several virtual hosts (for example, Shoditsa
  # and Repeto). A legacy SPA fallback in another server block must not block
  # a Shoditsa release or be rewritten by this patch.
  if awk -v marker="$MARKER" '
    index($0, marker) { in_target_server = 1; next }
    in_target_server && /^[^[:space:]]*}[[:space:]]*$/ { exit found ? 0 : 1 }
    in_target_server && index($0, "try_files $uri $uri/ /index.html;") { found = 1 }
    END { if (in_target_server) exit found ? 0 : 1 }
  ' "$CONFIG_PATH"; then
    echo "Explicit SPA route marker exists but the Shoditsa legacy catch-all fallback is still active" >&2
    exit 1
  fi
  ensure_word_seo_route
  ensure_utility_seo_route
  ensure_danetki_catalog_route
  ensure_application_routes
  ensure_svoyak_routes
  ensure_public_trailing_slash_redirects
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
  print "    location ~ ^/(play/(movie|series|anime|game|music|diagnosis|city|animal|book|character|connections)|sessions/[^/]+|review/music|purchase/return|danetki/join/[^/]+|specials/[^/]+)$ {"
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
ensure_word_seo_route
ensure_utility_seo_route
ensure_danetki_catalog_route
ensure_application_routes
ensure_svoyak_routes
ensure_public_trailing_slash_redirects
