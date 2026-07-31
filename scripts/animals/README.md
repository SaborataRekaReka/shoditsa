# Animal data pipeline

This directory contains the provenance-first ETL for the animal guessing game.

## Complete model

The generated object is split into layers:

| Layer | Purpose |
| --- | --- |
| `identity` | Russian/English names, aliases, accepted scientific name and external IDs |
| `taxonomy` | GBIF-resolved kingdom, phylum, class, order, family, genus, species, rank and status |
| `criteria` | Controlled game-filter vocabularies |
| `measurements` | Mass, length, maturity, reproduction and longevity |
| `ecology` | Diet composition, reviewed interactions, raw interaction candidates and conservation |
| `hints` | Licensed sounds, derived silhouettes, maps and original Russian clue copy |
| `media` | Primary image, gallery and per-file licensing |
| `popularity` | Mass-audience familiarity signals |
| `gameplay` | Post-launch solve, hint, timing, skip and abandonment measurements |
| `selection` | Familiarity, playability, distinctiveness, delight, total score and difficulty |
| `quality` | Coverage, warnings and human-review state |
| `provenance` | Source, URL, license, retrieval time, method and confidence per field |

`data/animals/generated/lion.json` is the readable full-model example. `model.mjs`
contains the model factory, normalizers, validator and scoring rules.

## Live ETL

`build-animal.mjs` performs these joins and transformations:

1. Wikidata QID -> names, aliases, scientific name, Commons pointers and sitelinks.
2. Scientific name -> GBIF accepted taxon and complete taxonomy.
3. GBIF taxon -> broad habitat profiles and occurrence-country region proxy.
4. Taxonomic class/order/family -> conservative deterministic morphology and movement
   rules, explicitly marked as derived.
5. Accepted name -> EltonTraits diet, activity, foraging stratum and body mass.
6. Genus/species -> AnAge life history and maximum observed longevity.
7. Scientific name -> optional GloBI prey and predator candidates.
8. Commons pointers -> URLs, author, credit and per-file license.
9. Licensed primary image -> separately materialized foreground silhouette with inherited attribution.
10. Russian Wikipedia title -> latest complete 365-day pageview total.
11. Editorial seed -> fields that cannot safely be inferred.

The pipeline rejects Commons media marked NC, ND, all-rights-reserved or with an
unknown/non-allowed license. GloBI results go only to
`ecology.interactionCandidates`: every relation needs editorial verification.

## Runtime silhouettes and sounds

The runtime game keeps the normal photograph in `posterUrl` and stores the
separate visual clue in `silhouetteUrl`. Build real foreground masks for the
selected 300 animals with:

```powershell
python -m pip install --target .tmp/animal-media-python rembg==2.0.67
$env:PYTHONPATH = (Resolve-Path .tmp/animal-media-python).Path
npm run data:media:animals:silhouettes
```

The command writes lossless local WebP masks to
`public/images/animals/silhouettes/`, a provenance manifest to
`data/animals/media/silhouettes-manifest.json`, and a contact sheet to
`.tmp/animal-media/silhouette-contact-sheet.webp`.

Collect and normalize commercially reusable recordings with:

```powershell
npm run data:media:animals:sounds
```

Existing licensed Commons recordings are localized first. Missing recordings
are searched by scientific name in research-grade iNaturalist observations and
then Commons. Only Public Domain, CC0, CC BY and CC BY-SA media are accepted.
Every clip is normalized to a local mono Ogg Opus file of at most 20 seconds,
with author, source and license preserved in
`data/animals/media/sounds-manifest.json`. A missing real species recording
remains missing; ambient or fabricated audio is never substituted.

Run one animal:

```powershell
npm run data:build:animal --seed=data/animals/seeds/lion.json --out=data/animals/generated/lion.json
```

Run a seed directory or JSON seed manifest:

```powershell
npm run data:build:animals --seeds=data/animals/candidates/shortlist-seeds.json --concurrency=3
```

Bulk builds skip GloBI by default. Add `--interactions=true` only for a focused batch.
AnAge, EltonTraits and country-enumeration data are cached in `.tmp/animal-pipeline`.

## Candidate discovery and roster selection

Discovery walks configured Russian Wikipedia categories, resolves Wikidata IDs in
batches and retains species/subspecies:

```powershell
npm run data:discover:animals --limit=5000 --depth=3
```

Rank the pool with GBIF validation and the latest twelve complete months of Russian
Wikipedia pageviews, then prepare a class-balanced 500-item enrichment shortlist:

```powershell
npm run data:iconic:animals
npm run data:rank:animals
npm run data:shortlist:animals
```

The iconic-name step repairs a known category-traversal bias: taxonomic category trees
surface many valid species but can miss mass-audience animals such as tiger, elephant or
giraffe. The curated Russian name layer is resolved back to species/subspecies IDs rather
than trusted as free text. Explicit Wikidata `P141=extinct` takes precedence over
conflicting GBIF profile flags.

The 500 candidates cover a launch roster of 300, a reserve of 100 and a 100-item
attrition buffer for bad media licenses, ambiguous taxa and thin trait records.

Build the shortlist, select the roster and produce the review queue:

```powershell
npm run data:build:animals --seeds=data/animals/candidates/shortlist-seeds.json --concurrency=3
npm run data:backfill:animals
npm run data:names:animals
npm run data:select:animals
npm run data:review:animals
npm run data:audit:animals
```

The selector balances recognition and playability with class/difficulty quotas plus
genus, family and near-duplicate penalties. The queue separates release blockers
(identity, image license, coverage and identity-specific hint) from quality work
(native range, diet/activity, habitat refinement, clue copy, sound and interactions).
The audit fails on missing records, duplicates, extinct taxa, rejected image licenses,
non-Russian display names, coverage below 70%, ineligible selections and genus/family
cap violations.

The launch targets are 150–180 easy, 90–120 medium and 20–40 hard animals. Expected
solve rates are roughly 80–90% for easy, 55–75% for medium and 30–50% for hard, with
65–75% overall. These are hypotheses: after launch, re-score using solve rate, median
clue count, answer time, abandonment, skips and repeat exposure.
