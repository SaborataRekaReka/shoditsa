# Unified traffic-fixes release: review before execution

The scripts in this directory were prepared without activating a release. Root owns the final commit, build, review and execution.

Expected production baseline:

- Web: `a3fcf6169b128aabf49883832f48a52326064dd5`.
- API and worker: `shoditsa-api:9a16e7e59e0fe7ab2f7c49e4faa7f161b626dd2f`.
- Active revision: `c240a553-b7aa-426d-92aa-31909878c536`, version `admin-20261023T072437823Z-fc29d000`.
- No dependency or migration changes relative to the API base. Package manifest differences may consist only of scripts. The new image overlays bundled `apps/api/dist` onto the existing image; no package installation, runtime source copying, migrations or content import takes place.

Build the web/API from the final committed release SHA. Prepare a local artifact directory with:

```text
web/                             complete apps/web/dist
api-dist/                        complete apps/api/dist
Dockerfile.api-overlay           copied from this directory
Dockerfile.api-overlay.dockerignore
verify-web-parity.py
```

Run `node qa/traffic-fixes-2026-10-26/prepare-release-metadata.mjs <SHA> <local-stage>` from the worktree. It requires HEAD to match SHA and no tracked changes, compares all workspace package manifests (excluding scripts), checks package-lock and migrations against `9a16...`, verifies the built web SHA, rejects staged symlinks, and writes `source-invariants.json` plus `artifact-manifest.json`. A missing baseline file or difference is a blocking error. Existing Windows CRLF copies of migrations must not be uploaded: the overlay intentionally does not copy migrations at all.

Upload the stage as `/opt/shoditsa/incoming/traffic-fixes-<SHA>`. The Dockerfile-specific ignore file keeps web assets and metadata out of the Docker build context. `release.sh` is intentionally not executable by itself; after root review it can be passed explicitly to Bash with `--apply <SHA>`.

The release script:

1. Holds the same three deployment locks used by the current host, verifies exact baseline versions, minimum free space, new immutable release/image paths, artifact hashes and the active content revision.
2. Saves compose, environment, nginx configuration and metadata under a new backup directory with restrictive permissions. It does not print environment contents.
3. Builds the API overlay from the pinned existing image, hashes the entire old web tree, then creates a new web directory with hard links to the old web assets. Only new directories receive mode 0755. Changed web files are copied to temporary siblings, set to mode 0644 and renamed, so old linked files are never truncated or chmodded. Before activation, all old file hashes must still match. Robots, sitemap, PWA manifest, offline page and service worker must be byte-identical to production; all 58 sitemap pages must preserve title, H1, canonical, SEO metadata, JSON-LD and visible fallback text, while carrying the new build SHA and resolvable assets.
4. Updates only the API image reference and GIT_SHA, restarts API/worker, and verifies readiness, active revision, modes, features and growth settings.
5. Atomically switches current web and recreates nginx so its bind mount resolves the new directory. It verifies public manifest SHA, important game pages, readiness and a real 404.
6. On an error or interrupt after activation begins, restores the previous compose/environment and current web pointer, then recreates API/worker/nginx. A rollback attempt is recorded; a failing rollback command is not hidden as a successful release.

No migrations, content activations, checkout operations, manual order mutation, background-job replay, settings changes or cleanup run from this release script. Old images, web releases and backups remain available. Natural application traffic and the worker continue their ordinary database writes after restart.

The HTTP checks are a release gate, not a substitute for the requested browser checks. After release, verify route analytics with consent on/off, same-mode navigation, Territory entry, transitions and the Character first-move screen. Confirm that the next commerce reconciliation completes and that no new incomplete Danetki output is accepted as a valid answer. Do not start a paid provider request solely to test this release without a separate reason.

The API/worker compose project and service names were confirmed from live Docker labels: project `shoditsa-api`, services `shoditsa-api` and `shoditsa-worker`, compose `/opt/repeto/deploy/shoditsa-api/docker-compose.yml`. Nginx labels confirm project `repeto`, service `nginx`, compose `/opt/repeto/docker-compose.prod.yml`. Any active-revision drift blocks deployment until fresh evidence is reviewed.

The approved disk cleanup already completed separately at 12:08 UTC: six explicit temporary build directories removed, unused Docker builder cache older than seven days pruned. Net free space increased by 301.65 MiB, from 82% to 81% used. All 15,360 protected backup/release files retained identical metadata, the incoming database dump remained, and running image references were unchanged. Receipt is in the original audit checkout at `docs/research/seo-2026-10-26/health/cleanup-receipt.json`.
