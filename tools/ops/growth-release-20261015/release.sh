#!/usr/bin/env bash
# Invocation: RELEASE_SHA=<40-char committed SHA> bash release.sh prepare|build|backup|activate|verify
# Or: bash release.sh <stage> <SHA>
# Run prepare only AFTER the separately authorized content publish. This script never imports content or migrates DB.
set -Eeuo pipefail
umask 077
SHA="${RELEASE_SHA:-${2:-}}"
OLD=245be7c5cfeb61d323e44bef3508d603f6cfef58
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] && [ "$SHA" != "$OLD" ] || { printf 'Expected a new full commit SHA.\n' >&2; exit 2; }
ROOT=/opt/shoditsa
WORK="$ROOT/incoming/growth-$SHA"
RELEASE="$ROOT/releases/$SHA"
COMPOSE=/opt/repeto/deploy/shoditsa-api/docker-compose.yml
IMAGE="shoditsa-api:$SHA"
API=shoditsa-api-shoditsa-api-1
WORKER=shoditsa-api-shoditsa-worker-1
POSTGRES=shoditsa-api-shoditsa-postgres-1
NGINX=repeto-nginx-1
api_compose() { docker compose --project-directory /opt/repeto/deploy/shoditsa-api --project-name shoditsa-api -f "$COMPOSE" "$@"; }
pg_read() { docker exec -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000' -i "$POSTGRES" psql -X -v ON_ERROR_STOP=1 -U shoditsa_app -d shoditsa -At "$@"; }
read_meta() { docker exec "$API" wget -q -O - http://127.0.0.1:3001/api/v1/meta; }
assert_old() {
  test "$(readlink -f "$ROOT/current")" = "$ROOT/releases/$OLD" &&
  test "$(docker inspect --format '{{.Config.Image}}' "$API")" = "shoditsa-api:$OLD" &&
  test "$(docker inspect --format '{{.Config.Image}}' "$WORKER")" = "shoditsa-api:$OLD"
}
migration_ledger() { pg_read -c "select count(*)::text||'|'||coalesce(max(created_at)::text,'')||'|'||coalesce(md5(string_agg(hash||':'||created_at::text,',' order by id)),'') from drizzle.__drizzle_migrations;"; }
financial_summary() {
  pg_read -c "select jsonb_build_object('legacyCredits',(select jsonb_build_array(count(*),coalesce(sum(remaining),0)) from registration_play_credits),'modeCredits',(select jsonb_build_array(count(*),coalesce(sum(remaining),0)) from registration_mode_play_credits),'walletLedger',(select jsonb_build_array(count(*),coalesce(sum(amount),0)) from wallet_ledger),'orders',(select jsonb_build_array(count(*),coalesce(sum(amount_minor),0),count(*) filter(where status='paid')) from payment_orders));"
}
compare_meta() {
  local second="$1" expected="$2"
  docker run --rm --read-only --network none --cap-drop ALL --security-opt no-new-privileges --user 0 -e "EXPECTED_SHA=$expected" -e "SECOND_META=$second" --mount "type=bind,source=$WORK,target=/proof,readonly" "$IMAGE" node -e '
const fs=require("fs"); const a=JSON.parse(fs.readFileSync("/proof/pre-meta.json")),b=JSON.parse(fs.readFileSync("/proof/"+process.env.SECOND_META));
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==="object"?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const same=(x,y)=>JSON.stringify(stable(x))===JSON.stringify(stable(y));
const modes=x=>[...(x||[])].sort((l,r)=>String(l.mode).localeCompare(String(r.mode)));
if(b.buildSha!==process.env.EXPECTED_SHA||!b.activeRevision||!same(a.activeRevision,b.activeRevision)||!same(modes(a.modes),modes(b.modes))||!same(a.growth,b.growth))throw Error("Release/content/growth invariants failed");
console.log("Build SHA and post-content-publish revision/modes/growth verified");'
}
verify_static() {
  local web="$1" check_links="${2:-false}"
  docker run --rm --read-only --network none --cap-drop ALL --security-opt no-new-privileges --user 0 -e "CHECK_LINKS=$check_links" -e "EXPECTED_SHA=$SHA" -e "EXPECTED_OLD=$OLD" --mount "type=bind,source=$WORK,target=/proof,readonly" --mount "type=bind,source=$web,target=/web,readonly" --mount "type=bind,source=$ROOT/releases/$OLD/web,target=/oldweb,readonly" "shoditsa-api:$OLD" node -e '
const fs=require("fs"),crypto=require("crypto"),p=JSON.parse(fs.readFileSync("/proof/static-verified.json"));
if(p.sha!==process.env.EXPECTED_SHA||p.old!==process.env.EXPECTED_OLD||p.files!==1866||p.entries.length!==1866||p.mismatches.length||p.extra.length||crypto.createHash("sha256").update(JSON.stringify(p.entries)).digest("hex")!==p.staticDigest)throw Error("Invalid static verification proof");
for(const [name,hash]of p.entries){if(name.startsWith("/")||name.split("/").includes(".."))throw Error("Invalid static path");const path="/web/"+name,s=fs.lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex")!==hash)throw Error("Static changed: "+name);if(process.env.CHECK_LINKS==="true"){const old=fs.statSync("/oldweb/"+name);if(s.ino!==old.ino||s.dev!==old.dev)throw Error("Static file is not hardlinked: "+name)}}
console.log("STATIC_VERIFIED 1866; hardlinks="+process.env.CHECK_LINKS);'
}
verify_manifest() {
  docker run --rm --read-only --network none --cap-drop ALL --security-opt no-new-privileges --user 0 -e "EXPECTED_SHA=$SHA" -e "EXPECTED_OLD=$OLD" --mount "type=bind,source=$WORK,target=/proof,readonly" "shoditsa-api:$OLD" node -e '
const fs=require("fs"),p=JSON.parse(fs.readFileSync("/proof/release-manifest.json"));if(p.sha!==process.env.EXPECTED_SHA||p.old!==process.env.EXPECTED_OLD||p.staticFiles!==1866||p.unchangedDependencies!==true||p.unchangedMigrations!==true||p.databaseMigrations!==false||p.contentImports!==false)throw Error("Release manifest mismatch");console.log("Release scope verified");'
}
wait_healthy() {
  local health=''
  for attempt in {1..24}; do health="$(docker inspect --format '{{.State.Health.Status}}' "$API")"; [ "$health" = healthy ] && break; sleep 2; done
  test "$health" = healthy &&
  test "$(docker inspect --format '{{.State.Status}}' "$WORKER")" = running &&
  test "$(docker inspect --format '{{.State.Health.Status}}' "$POSTGRES")" = healthy
}
refresh_nginx() {
  local expected="$1"
  docker restart "$NGINX" >/dev/null || return 1
  if ! docker exec "$NGINX" grep -Fq "$expected" /var/www/shoditsa/build-manifest.json; then
    docker compose --project-directory /opt/repeto --project-name repeto -f /opt/repeto/docker-compose.prod.yml up -d --no-deps --force-recreate nginx || return 1
  fi
  docker exec "$NGINX" nginx -t &&
  docker exec "$NGINX" grep -Fq "$expected" /var/www/shoditsa/build-manifest.json
}
case "${1:-}" in
  prepare)
    assert_old
    test ! -e "$WORK"
    test ! -e "$RELEASE"
    test "$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')" -ge 2097152
    install -d -m 700 "$WORK" "$ROOT/backups"
    # This baseline must reflect the content revision published separately BEFORE prepare.
    read_meta > "$WORK/pre-meta.json"
    docker run --rm --read-only --network none --user 0 -e "EXPECTED_SHA=$OLD" --mount "type=bind,source=$WORK,target=/proof,readonly" "shoditsa-api:$OLD" node -e 'const p=JSON.parse(require("fs").readFileSync("/proof/pre-meta.json"));if(p.buildSha!==process.env.EXPECTED_SHA||!p.activeRevision||!Array.isArray(p.modes))throw Error("Invalid pre-release meta baseline");'
    cp -a "$COMPOSE" "$WORK/api-compose.before.yml"
    migration_ledger > "$WORK/migrations.before"
    docker inspect --format '{{.Image}}' "$API" > "$WORK/old-image-id"
    date -u +%FT%TZ > "$WORK/prepared-at.txt"
    printf 'PREPARED %s; upload artifacts into %s\n' "$SHA" "$WORK"
    ;;
  build)
    assert_old
    cd "$WORK"
    sha256sum --check artifacts.sha256
    verify_manifest
    test ! -e overlay
    mkdir overlay
    tar -xzf api-overlay.tar.gz -C overlay
    docker build --build-arg GIT_SHA="$SHA" -t "$IMAGE" overlay
    for file in server worker migrate; do docker run --rm --read-only --network none "$IMAGE" test -f "/app/apps/api/dist/$file.js"; done
    # Independently compare dependency manifests and every migration byte inside images.
    for tag in "$OLD" "$SHA"; do
      docker run --rm --read-only --network none "shoditsa-api:$tag" node -e '
const fs=require("fs"),crypto=require("crypto"),files=["package.json","package-lock.json","apps/api/package.json","apps/web/package.json","packages/config/package.json","packages/contracts/package.json","packages/database/package.json","packages/game-core/package.json"];
function walk(p){for(const n of fs.readdirSync(p)){const q=p+"/"+n;if(fs.statSync(q).isDirectory())walk(q);else files.push(q)}}walk("packages/database/migrations");
console.log(JSON.stringify(files.sort().map(p=>[p,crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")])));' > "image-invariants-$tag.json"
    done
    cmp "image-invariants-$OLD.json" "image-invariants-$SHA.json"
    printf 'IMAGE_READY %s; dependencies and migrations unchanged\n' "$SHA"
    ;;
  backup)
    assert_old
    test -d "$WORK"
    BACKUP="$ROOT/backups/pre-growth-$SHA.dump"
    test ! -e "$BACKUP"
    docker exec "$POSTGRES" pg_dump -U shoditsa_app -d shoditsa -Fc > "$BACKUP"
    test -s "$BACKUP"
    docker exec -i "$POSTGRES" pg_restore --list < "$BACKUP" >/dev/null
    sha256sum "$BACKUP" | tee "$BACKUP.sha256"
    cp "$BACKUP.sha256" "$WORK/onhost-backup-verified"
    printf 'ONHOST_BACKUP_VERIFIED %s\n' "$BACKUP"
    ;;
  activate)
    exec 9>"$ROOT/direct-release.lock"
    flock -n 9
    assert_old
    cd "$WORK"
    test ! -e activated-at.txt
    test ! -e "$RELEASE"
    sha256sum --check artifacts.sha256
    test -s onhost-backup-verified
    sha256sum --check onhost-backup-verified
    verify_manifest
    cmp "image-invariants-$OLD.json" "image-invariants-$SHA.json"
    test "$(docker inspect --format '{{.Image}}' "$API")" = "$(cat old-image-id)"
    cmp "$COMPOSE" api-compose.before.yml
    migration_ledger > migrations.pre-activate
    cmp migrations.before migrations.pre-activate
    read_meta > immediate-pre-meta.json
    compare_meta immediate-pre-meta.json "$OLD"
    verify_static "$ROOT/releases/$OLD/web"
    test "$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')" -ge 1048576
    test "$(grep -Ec '^[[:space:]]*image:[[:space:]]+shoditsa-api:[^[:space:]]+' "$COMPOSE")" = 3
    mkdir -p "$RELEASE/web"
    cp -anl "$ROOT/releases/$OLD/web/." "$RELEASE/web/"
    # Unlink before extraction is essential: overwriting an inherited hardlink would modify the old release.
    tar --unlink-first --no-same-owner --same-permissions -xzf web.tar.gz -C "$RELEASE/web"
    test ! -e "$RELEASE/web/data"
    grep -Fq "$SHA" "$RELEASE/web/build-manifest.json"
    chmod a+rx "$RELEASE" "$RELEASE/web"
    verify_static "$RELEASE/web" true
    on_failure() {
      local status=$? rollback_failed=0
      trap - ERR
      set +e
      cp -a "$WORK/api-compose.before.yml" "$COMPOSE" || rollback_failed=1
      api_compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker || rollback_failed=1
      ln -sfn "$ROOT/releases/$OLD" "$ROOT/current.growth-rollback" || rollback_failed=1
      mv -Tf "$ROOT/current.growth-rollback" "$ROOT/current" || rollback_failed=1
      refresh_nginx "$OLD" || rollback_failed=1
      wait_healthy || rollback_failed=1
      assert_old || rollback_failed=1
      if [ "$rollback_failed" = 0 ]; then
        printf 'RELEASE_FAILED: rollback verified; API/worker/web restored to %s. Database/content not rolled back; release runs no migrations/imports.\n' "$OLD" >&2
      else
        printf 'CRITICAL: release failed and rollback verification FAILED. Inspect current link, compose, containers and nginx immediately; do not assume service restored.\n' >&2
      fi
      date -u +%FT%TZ > "$WORK/failed-at.txt"
      exit "$status"
    }
    trap on_failure ERR
    api_compose stop -t 30 shoditsa-api shoditsa-worker
    financial_summary > finances.stopped-before
    sed -Ei "s#^([[:space:]]*image:[[:space:]]*)shoditsa-api:[^[:space:]]+#\1$IMAGE#" "$COMPOSE"
    api_compose config --quiet
    migration_ledger > migrations.stopped-after
    cmp migrations.before migrations.stopped-after
    financial_summary > finances.stopped-after
    cmp finances.stopped-before finances.stopped-after
    api_compose up -d --no-deps --force-recreate shoditsa-api shoditsa-worker
    wait_healthy
    test "$(docker inspect --format '{{.Config.Image}}' "$API")" = "$IMAGE"
    test "$(docker inspect --format '{{.Config.Image}}' "$WORKER")" = "$IMAGE"
    read_meta > post-meta.json
    compare_meta post-meta.json "$SHA"
    migration_ledger > migrations.post-start
    cmp migrations.before migrations.post-start
    ln -sfn "$RELEASE" "$ROOT/current.growth-next"
    mv -Tf "$ROOT/current.growth-next" "$ROOT/current"
    refresh_nginx "$SHA"
    docker run --rm -e "EXPECTED_SHA=$SHA" "$IMAGE" node scripts/diagnostics/smoke-production-main.mjs
    verify_static "$RELEASE/web" true
    trap - ERR
    date -u +%FT%TZ > activated-at.txt
    printf 'GROWTH_RELEASE_ACTIVATED %s\n' "$SHA"
    ;;
  verify)
    cd "$WORK"
    test -s activated-at.txt
    test "$(readlink -f "$ROOT/current")" = "$RELEASE"
    test "$(docker inspect --format '{{.Config.Image}}' "$API")" = "$IMAGE"
    test "$(docker inspect --format '{{.Config.Image}}' "$WORKER")" = "$IMAGE"
    wait_healthy
    read_meta > verify-meta.json
    compare_meta verify-meta.json "$SHA"
    migration_ledger > migrations.verify
    cmp migrations.before migrations.verify
    docker exec "$NGINX" nginx -t
    docker exec "$NGINX" grep -Fq "$SHA" /var/www/shoditsa/build-manifest.json
    verify_static "$RELEASE/web" true
    docker run --rm -e "EXPECTED_SHA=$SHA" "$IMAGE" node scripts/diagnostics/smoke-production-main.mjs
    printf 'GROWTH_RELEASE_VERIFIED %s\n' "$SHA"
    ;;
  *) printf 'Expected prepare, build, backup, activate or verify.\n' >&2; exit 2 ;;
esac
