# Content fact-check runbook

Use this workflow for factual or semantic verification of one field, multiple fields, whole cards, a game mode, several modes, or arbitrary JSON card data.

## Non-negotiable defaults

- A request to check or audit is read-only. Do not edit cards, workspaces, revisions, or production.
- Prefer the active revision when the user means live content. Never silently substitute a local library for production; label any fallback.
- Treat `null`, missing, zero, `false`, and not-applicable as different states.
- Check related fields in one card context. Do not fact-check dependent fields independently.
- Model output is not evidence. Preserve direct source URLs, confidence, source conflicts, and the as-of date for volatile facts.
- A run is incomplete until every queued semantic research task is completed or explicitly classified as unresolved.

## Translate the request into scope

Infer these values from the user's words:

- source: `active`, `library`, or an explicit JSON file/directory;
- modes: one, several, `all`, or a custom mode with `--input`;
- fields: comma-separated paths or `*` for the whole factual card;
- cards: all matching cards or explicit IDs;
- research: `all` for a real fact-check, `flagged` for anomaly triage, `none` only for structural lint;
- AI: `web` for automated evidence research, otherwise `never` to create a review queue without spending API budget.

If scope is omitted, use all cards in the named mode, all requested fields, `research=all`, and read-only behavior. Ask only when the missing choice would materially change source or cost.

## Run the pipeline

Local library, several fields:

```powershell
npm run content:factcheck --source=library --mode=animal --fields=legCount,locomotion --research=all --ai=web
```

Active production revision, whole cards:

```powershell
npm run content:factcheck --source=active --mode=city --fields=* --research=all --ai=web
```

Specific cards without AI spending:

```powershell
npm run content:factcheck --source=library --mode=book --ids=book-1,book-2 --fields=bookAuthors,bookPublicationYear --research=all --ai=never
```

Arbitrary JSON:

```powershell
npm run content:factcheck --source=input --input=path/to/cards.json --mode=custom --fields=fieldA,fieldB --research=all --ai=web
```

Use `--limit=N` or `--max-ai=N` only for pilots and label the resulting run as partial. `--ai=web` requires `OPENAI_API_KEY`; the default model is `gpt-5-mini`. Use `--concurrency=N`, `--model=...`, and `--refresh` only when necessary. Never print secret values.

## Interpret the artifacts

Every run writes under `var/factcheck/runs/<run-id>/` unless `--output` is supplied:

- `manifest.json`: immutable scope and source identity;
- `profile.json`: completeness, types, and distinct-count profile;
- `findings.jsonl`: deterministic and AI findings with severity, confidence, and evidence;
- `research-queue.jsonl`: one whole-card research task per selected card;
- `ai-results.jsonl`: completed evidence-based semantic reviews;
- `patch-plan.json`: proposals only; never applied by this command;
- `summary.md`: coverage, findings, and release gate.

Statuses are `pass`, `contradiction`, `uncertain`, `stale`, `not_applicable`, and `source_conflict`. Severity is separate from confidence. Critical and high findings block release; incomplete research never counts as a passed fact-check.

## Research and remediation rules

1. Run deterministic checks across 100% of the scope.
2. Group repeated findings by rule, provenance method, or source fingerprint before researching them individually.
3. Prefer fixing the generating rule or mapping when many cards share one cause. Use a per-card override only for a real exception.
4. For disputed or high-impact facts, require an authoritative exact-identity source and a second source when ambiguity remains.
5. When the user asks to fix confirmed findings, stage changes outside the active revision, preserve sources per changed field, rebuild dependent fields, and rerun the same fact-check scope.
6. Convert stable confirmed contradictions into deterministic regression rules or tests.

## Completion gate

A full fact-check is complete only when:

- the manifest identifies the exact source/revision and requested scope;
- deterministic coverage is 100%;
- AI research coverage is 100% for `research=all` or every omitted task is explicitly unresolved;
- no critical/high contradiction remains in releasable cards;
- every proposed correction has evidence and preserves field types and semantics;
- a post-fix rerun has no regression in related fields;
- no active revision was mutated during checking.
