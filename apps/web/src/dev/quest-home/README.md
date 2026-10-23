# Three local home compositions

Start `scripts/preview-quest-study.ps1` and open
`http://127.0.0.1:5180/`. The home mounts at `/` without a redirect.
Variants B and C remain available at `/?variant=b` and `/?variant=c`;
the old `shoditsa-home.html` links also remain usable.
The review bar switches between A (application home), B (compact shelf) and
C (thematic worlds). Card links open the twelve existing title studies.

All three compositions now share the title/play `StudySidebar` component and
the shared application layout and breakpoints. Desktop content starts 32px
after the left rail and fills the available space beside a 320px right panel
(300px on smaller desktops). The default catalogue uses four cards per row
when its column is at least 820px wide, three on narrower desktops, and two
on phones. Both panels keep their animated collapsed states.
They also share `StudyHeader`: calendar date, the locally saved attendance streak,
wallet balance and the profile entry. Game attempts never appear in this header.
The review toolbar adds a local 64px top offset; it is not part of the product.
On phones the same six-item navigation becomes the bottom bar, and the home
context cards move below the catalogue, before the guide. Their contents stay
in HTML. No personal game progress is fabricated for this design preview.
The selected composition is remembered only in preview session storage. Title
and Shoditsa play navigation return to that composition; fresh Shoditsa entries
default to A. The original Quest study retains its existing destinations.

These are separate local design previews. No production component, SEO head,
canonical, robots, structured data or release route is replaced.

Content is shared, not rewritten for each composition:

- Runtime H1 and opening paragraph: `HOME_HERO_COPY`, as on the live client.
- Guide H2, description and three paragraphs: `HOME_SEO`.
- Twelve game destinations and anchor labels: `PUBLIC_GAME_LINKS`.
- Eight Danetki discovery destinations and labels: `DANETKI_DISCOVERY_LINKS`.
- Static fallback: generated from these same sources by
  `npx tsx scripts/qa/write-quest-home-html.ts`.

All twelve cards and all guide paragraphs/links render immediately. Responsive
CSS does not remove catalogue entries or guide content. Native disclosures keep
their body in HTML even when closed. Game destinations use ordinary canonical
`<a href>` links. The preview itself remains `noindex,nofollow`.

The source/fallback H1 and runtime H1 intentionally follow their respective live
owners; this study does not change their existing distinction. Production
structured data remains owned by the existing release renderer. Do not replace
the production SEO head with this prototype's noindex head when integrating a
selected composition.

Content parity and markup tests are in `HomeVariants.test.ts`. Public baseline,
desktop/mobile checks and screenshots are in `qa/quest-home-variants-2026-10-20/`.
This verifies preservation in the prototypes; it does not assert a future ranking
or traffic outcome. Publication and post-release measurement remain separate.

Comparable-game launches from the title pages now keep this shell too. The
autonomous controller renders its existing search, clues, hints and result inside
the lazy-loaded `StudySessionFrame`; match summaries use the same live attempts.
This bridge requires DEV, both local/study profile flags, an explicit `studyMode`
launch and a local controller. Server sessions and ordinary production routes
retain their existing frame. The original `quest-game.html` baseline is unchanged.
