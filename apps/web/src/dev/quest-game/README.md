# Local title study

The local Club library is `/?preview=reference#/club?preview=reference&section=library`.
Home, header and account links use this working section. The existing offer and
checkout presentation remains at `/?preview=reference#/club?preview=reference&section=offers`.
The library reads the published pack catalogue, actual collection progress and
active sessions when a server runtime is available. The autonomous study uses
the public metadata snapshot in `club-library-catalog.json`; access, remaining
Danetki and personal pack progress stay unknown. Daily K-pop's catalogue size is
an answer pool, never a collection-completion denominator. Local daily saves can
provide a real continuation card. Server-only formats open an explanation before
linking to the canonical site. No session is started by browsing or opening a dialog.
Browser evidence for 320px, 390px and desktop: `qa/club-library-2026-10-21/`.

Guests see a stable skeleton with a sign-in CTA; authenticated non-members see
the Club-ticket CTA. Membership checks and request failures have separate loading
and retry states. For a development-only visual review of the member layout, add
`&memberPreview=1` to the hash-route query. This does not grant membership, create
progress, change a session, or bypass server launch checks. New versioned Club
covers are in `public/images/club-library/`; their built-in image-generation prompts
and sources are recorded in `qa/club-library-2026-10-21/covers-generation.json`.

`StudyClubPage` uses the existing membership/pricing model and checkout callbacks
from `ClubScreen`, inside the shared study shell. No payment service is enabled
by the autonomous preview. Production and the baseline Quest theme keep their
existing presentations.

`StudySidebarWidgets` owns shared account, guest-play, streak, saved-games,
task-progress and next-badge widgets. Pages select widgets and supply data or
routes; they do not override a widget's copy. The account card is always
«Сохрани свой прогресс». The Shoditsa rail contains six primary destinations,
including Club between Tasks and Profile; all six remain reachable on mobile.

The study server injects font preloads and native cross-document View Transitions
through its dev-only HTML transform. A bounded render-blocking bootstrap waits
for the React shell and local fonts, avoiding an empty-frame or fallback-font
capture. Internal sections commit through `transitionStudyPage`; rapid clicks
keep the latest destination. Navigation and player controls have stable transition
names, and the scrollbar gutter stays reserved on short and long pages. Native
links and browser history remain intact; reduced-motion disables animation.
See [Chrome cross-document guidance](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document)
and [same-document guidance](https://developer.chrome.com/docs/web-platform/view-transitions/same-document).

Generated profile, guest and settings PNGs, with alpha and final prompts, are in
`public/images/shoditsa-study/profile-v1/manifest.json` (built-in image_gen).

Run `./scripts/preview-quest-study.ps1` from the repository root (port 5180 by default).
The catalogue is `/shoditsa-title.html#games`. All twelve `/games/<mode>` URLs
render the same title template, with that mode's public illustration and live copy.

The route override requires both `VITE_LOCAL_REDESIGN=1` and `VITE_QUEST_STUDY=1`
and is installed only by the Vite development server. Other preview profiles and
production routing are unchanged. These pages remain `noindex,nofollow`.

`QuestTitleContent` uses the production `GAME_SEO`, `GAME_RULES` and
`GAME_GUIDE_PRESENTATION` sources directly. `live-title-copy.json` contains the
public hero and launch copy read from the twelve live titles on 2026-10-20.
Article text remains rendered inside native disclosures. No new SEO prose is
substituted for the live text.

Period selection is available for movie, series and anime; music has difficulty
selection; city has its three existing sets. Anime opens the approved standalone
game study. Other comparable modes open their existing autonomous local game
controllers with the selected options. Connections and Danetki show their own
rules and illustrations, but their launch stays unavailable in this autonomous
profile because these games require the hosted runtime.

Browser evidence and live/content comparisons: `qa/quest-titles-all-2026-10-20/`.
