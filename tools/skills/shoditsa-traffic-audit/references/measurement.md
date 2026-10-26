# Collection and measurement contract

## Collector

Requires Node.js 20+; no npm dependencies. All remote operations are GET requests to official Yandex APIs. Default Metrica counter is the already documented shoditsa counter `110517987`; the Webmaster host is discovered by exact `shoditsa.ru` hostname, HTTPS preferred. No external settings are changed.

Options:

```text
--as-of YYYY-MM-DD       Audit calendar date; defaults to Asia/Qyzylorda today
--from YYYY-MM-DD        History request start; defaults to 120 days before as-of
--launch-date YYYY-MM-DD Known launch boundary, only when established by evidence
--counter-id NUMBER     Override the documented counter
--webmaster-host ID     Exact host ID if autodiscovery is ambiguous
--webmaster-through DATE Explicitly confirmed last complete source day
--metrika-through DATE  Explicitly confirmed last complete counter day
--out PATH              Save normalized Yandex snapshot (never overwrites)
--fixture PATH          Offline deterministic responses; makes no network calls
--skip-details          Daily history and period totals only
```

The default history request is a discovery window, not an assertion about project age. The output keeps request dates, first observed activity, inferred observation boundary, last reliable source date and chosen windows. Pass `--from` for older history. Supply a known launch date when available; no days before it enter comparisons.

The collector requests through yesterday and conservatively anchors each source to its last observed activity, unless a complete day is explicitly confirmed. An API response may not prove whether a trailing zero is a real zero or lag: the excluded range is marked unconfirmed, not proven missing traffic. `--webmaster-through` or `--metrika-through` may include a source-confirmed zero day. Internal Webmaster gaps yield partial coverage/null totals; successful Metrica period-total API responses remain the authority for distinct users. The two sources may end on different days.

Tokens are read only from `YANDEX_METRIKA_OAUTH_TOKEN`, `YANDEX_WEBMASTER_OAUTH_TOKEN`, or shared `YANDEX_OAUTH_TOKEN`. No token appears in command-line arguments, saved output or error messages. Optional Windows DPAPI fallback: set `SHODITSA_YANDEX_TOKEN_DPAPI_FILE` to an explicitly configured file containing a PowerShell `ConvertFrom-SecureString` encrypted value owned by the current Windows user. The bundled reader decrypts only that path into the collector's private subprocess pipe. It neither searches for secrets nor creates/rotates them. Invoke its `-StatusOnly` mode for a safe availability check; do not run the plaintext mode interactively.

Missing/invalid auth and individual failed requests are represented by `status: unavailable`, a sanitized reason, HTTP status if known, and `data/totals: null`. Requests stop for that source after 401/403/429. An offline fixture maps exact `pathname?sorted=query` keys to response objects; unknown fixture requests are explicitly unavailable. Fixture output is labeled `offline-fixture` throughout.

Read-only API references checked when this skill was restored:

- [Webmaster history](https://www.yandex.ru/dev/webmaster/doc/ru/reference/host-search-queries-history-all)
- [Webmaster popular queries](https://yandex.ru/dev/webmaster/doc/en/reference/host-search-queries-popular)
- [Metrica Reporting API](https://yandex.ru/dev/metrika/en/stat/openapi/data)

## Trustworthy comparisons

Metrica filter: `ym:s:isRobot=='No'`; organic adds `ym:s:lastTrafficSource=='organic'`. Returning visitors use `ym:s:isNewUser=='No'`, not subtraction of users minus newUsers. All/organic period users come from period API totals, never from summing daily users. Goal achievements and goal-visits are separate, and neither is a server game count.

Preserve `sampled`, `sample_share`, `contains_sensitive_data`, row limit/truncation and actual returned date range. If privacy hides landing rows, visible row share may be reported; actual tracking coverage remains null. Sanitize session/auth URLs by removing query strings and replacing IDs. Keep only aggregate audience/product fields, never account IDs, session IDs, emails or full referrer parameters in reports.

Raw first-party event retention is **38 completed days**. A 28/28 acquisition funnel may therefore lack older raw events even when the server's durable game facts cover both windows. Do not call old missing RAW records zero. Use 7/14/31 where coverage permits; separately present durable game facts and retained anonymous daily aggregates for longer context. A 31-day cohort also needs enough follow-up to mature its chosen return horizon.

Known boundaries to preserve until superseded by verified releases:

- 2026-09-05: first complete day after registration/attribution repair.
- 2026-09-12: first complete day of protected repeat-session facts; deleted earlier links were not backfilled.
- 2026-09-27: registration bonus for 12 games; mixed release day is not a clean pre/post cohort.
- 2026-09-29: club-priority repair and restored Connections schedule; check future daily availability anew.
- 2026-10-15 08:43:02 UTC: production `fb6c616` changed the growth definition to `linked-repeat-v4-played-outcomes` (won/lost count as completions; expired is separate) and focused Diagnosis recommendations on one next game. Recompute the baseline with the same definition; a lower corrected count is not a behavioral decline. Connections received 14 new scheduled rounds for October 15–28 and a reserve warning below seven consecutive days. Exclude the mixed October 15 release day: compare October 16–29 with October 1–14 after follow-up matures. Server/build checks passed, but the release browser check was blocked; do not inherit a claim of visual verification or proven uplift.

These are historical boundaries, not a substitute for fresh release evidence. Distinguish guest profiles from people, consented acquisitions from all traffic, clicks from linked server starts, activity-period completions from completion of a start cohort, and registrations from sign-ins. Do not sum modes' distinct profiles.

## Durable combined snapshot

Use this compact structure for all-source audits; extend it when needed rather than discarding source detail:

```json
{
  "schemaVersion": 1,
  "site": "https://shoditsa.ru",
  "auditDate": "YYYY-MM-DD",
  "capturedAt": "ISO timestamp",
  "sources": {
    "gsc": {"status": "ok|partial|unavailable", "through": null, "evidencePath": null},
    "webmaster": {"status": "ok|partial|unavailable", "through": null, "evidencePath": null},
    "metrika": {"status": "ok|partial|unavailable", "through": null, "evidencePath": null},
    "internal": {"status": "ok|partial|unavailable", "through": null, "evidencePath": null}
  },
  "comparisons": [],
  "releaseBoundaries": [],
  "findings": [],
  "limitations": [],
  "actions": []
}
```

Each comparison records source/definition, dates, population/filters, current/previous counts, units, maturity, null reasons and evidence path. Keep API CSV/JSON evidence alongside it, with access tokens/PII excluded. For GSC preserve property vs page/query aggregation differences and hidden-query coverage; this prevents false reconciliation errors.

Do not reuse an old generic diagnosis (e.g. weak characters CTR) when a newer complete window contradicts it. Current gates from the project plan: characters at least 100 relevant impressions, position ≤10, CTR <2%; music at least 50 impressions, position ≤8, CTR <3%; Danetki mechanics at least 20 comparable organic room starts with complete RAW coverage. Small purchases or partial retention cohorts cannot establish product-market fit or causal uplift.
