---
name: shoditsa-traffic-audit
description: Analyze shoditsa.ru traffic and growth using Google Search Console, Yandex Webmaster, organic Yandex Metrica, and production game statistics. Use for project dynamics, recurring audits, growth priorities, and measurement of released SEO or product changes.
---

# Shoditsa traffic audit

Deliver an explanation of what changed, why the evidence supports that interpretation, what to do next, and what to leave alone. Collecting numbers alone is not the outcome. Match the user's current scope: an audit is read-only; implementation follows an explicit request to change things.

The maintained copy is `tools/skills/shoditsa-traffic-audit` in the shoditsa repository. Read `docs/SEO_GROWTH_EXECUTION_PLAN.md` in that repository before recommending or implementing SEO/product changes. Its old dates and findings are history, not proof of the current state. Re-evaluate sample-size gates with fresh evidence: do not repeat an old low-CTR recommendation if the page has recovered.

## Obtain evidence

Run the read-only collector first from the repository, using the actual audit date in the user's timezone:

```text
node tools/skills/shoditsa-traffic-audit/scripts/collect-yandex-history.mjs --as-of YYYY-MM-DD --out docs/research/seo-YYYY-MM-DD/yandex.json
```

Read [references/measurement.md](references/measurement.md) for source definitions, credentials, collector options, retention, and snapshot requirements. The collector supports an offline fixture; never present fixture results as production. Missing credentials produce an explicit unavailable source with null metrics, not a failed-zero report. Use the user's authorized browser session for missing sources; do not change OAuth grants, rotate tokens, or silently restore secrets as part of an audit.

Check all four surfaces with fresh evidence when accessible:

- Google Search Console: source-specific complete periods, daily data, comparison exports by page/query/device, indexing and sitemap, relevant URL inspection, manual actions/security, external links. Property totals and summed page/query rows need not reconcile.
- Yandex Webmaster: history and queries, indexing/exclusions and their actual reasons, sitemap, dated diagnostics. Old recommendations are not proof of a current defect.
- Metrica: human organic-search segment separately from all traffic/direct/internal; source, device, new/returning, landing pages and current goal catalog. Preserve sampling and privacy limitations.
- Production admin/server: real non-staff game facts, starts/completions/players by mode, registrations and attribution, linked next games, bonus/club access separately, paid orders, errors, daily content availability and operational health. Use authorized UI or SELECT-only access already configured for this project. Never start a production game merely to inflate/check growth counts.

Distinguish current production from local code. Read release records and verify deployment timestamps before attributing a metric change to a feature.

## Compare and explain

- Use complete equal-length 7/7 and 14/14 windows ending on each source's latest reliable day. For at least 56 observed days, include 28/28. A younger project has no invented pre-launch baseline; label an unavailable comparison.
- Show context for the latest up-to-31 days and the full observed history/monthly rates when available. Partial months are not comparable full-month totals. An earliest observed row is not automatically the launch date.
- Show absolute counts alongside percentages. Recompute CTR from clicks/impressions and weight positions by impressions. Do not add daily distinct users to obtain period users.
- Explain contributions by game/page/query and audience where the data supports them. Separate facts, likely explanations, and hypotheses. A rise in parties per profile is not necessarily audience growth or retention.
- Keep search clicks, Metrica visits, consented acquisitions, game profiles, sessions, accounts and paid orders as separate populations. Do not calculate a funnel by dividing totals from different sources or timezones.
- A zero in a successful complete source may be real. Missing, privacy-suppressed, delayed and uncollected values remain null with a reason. Trailing Webmaster zero rows are conservatively marked unconfirmed until the source/browser establishes completeness.

Use Wordstat and competitive search only when deciding a new opportunity, testing intent mismatch, or explaining a durable query/CTR change that existing evidence cannot resolve. Record region, date range and exact operators; broad frequency is not demand for this particular mechanic. Do not claim a guaranteed ranking or extrapolate revenue from a handful of purchases.

## Save and hand off

Save a normalized snapshot and concise Russian report under `docs/research/seo-YYYY-MM-DD/`; keep older snapshots intact. Use [references/measurement.md](references/measurement.md) for the shape. The collector output is the Yandex part, not a claim that Google/admin were checked. Compare with the most recent reliable snapshot while also showing independent nonoverlapping windows; shifted snapshots often overlap.

For two collector outputs:

```text
node tools/skills/shoditsa-traffic-audit/scripts/compare-snapshots.mjs OLD.json NEW.json
```

Lead the report with project direction and stage, then the evidence and 3–5 prioritized actions with object, reason, success metric and next review date. State unavailable sources and delayed days. Include what not to touch. A technical release is not proven growth: browser checks establish behavior; a complete post-release measurement window establishes the business result.

For installation/recovery, run `scripts/install.ps1` from this skill. It copies only the maintained skill files into the personal skills directory and preserves unrelated files; it does not install credentials.
