# Native View Transition browser check

26 October 2026. Source commit: `8f74ca79a70e2d2c7768e2b5666a4d0077cd70ae`.

**PASS for route rendering and native transition handling in the isolated fixture.** This is a pre-release browser observation, not a production check or a test suite.

- New headless Chromium context, 1280 × 900, `reducedMotion: no-preference`, `document.visibilityState: visible`.
- Fixture: `http://127.0.0.1:5197`, explicitly reports `localOnly: true`, `apiForwarding: false`. External network and API mutations blocked. No existing browser profile, login, or production data used.
- Three complete cycles of Home → Character → Animal → Profile → Home. Every step waits for the destination's visible H1, not just its URL. Profile is checked by `#application-profile-title`, which contains the synthetic player's name.
- Real rendered links activated with focus and Enter, without waiting for the previous animation to finish. This avoids pointer hit-testing against the native transition snapshot while deliberately exercising overlapping transitions.
- **13 native transitions and 11 explicit skips.** Every route rendered; the final route is Home and `data-study-transitioning` is cleared.
- **0 page errors, 0 unhandled promise rejections, 0 duplicate visible `view-transition-name` values.** No intercepted `client_error` payloads or API writes. The observer does not attach extra handlers to native transition promises that could conceal application rejections.
- One document navigation only; subsequent route changes remain in the SPA.
- Final viewport screenshot reviewed. Left sidebar width is 250 px before, during, and after the route cycles; content is visible alongside it. A prior full-page screenshot distorted the fixed sidebar, so the retained screenshot uses the actual viewport.

The resource console still contains blocked external font/resource errors and local fixture 404 responses. This check establishes route/transition behavior; it does not establish successful loading of every asset or production analytics delivery.

## Evidence and corrected QA false failures

- `native-transitions.mjs`: reproducible one-off local observation.
- `native-transitions.json`: successful run, route headings, counters, duplicate-name checks, and isolation evidence.
- `native-transitions.png`: final 1280 × 900 viewport.
- `native-transitions-attempt1.json`: retained failed first observation. It waited for the URL instead of rendered content and therefore is not a valid route-commit check.
- `native-transition-diagnosis.{mjs,json}`: diagnostic comparison of native and reduced motion. A manual import of `/src/app/router.tsx` instantiated a second, unmounted router because the running Vite app had imported a timestamped module. Waiting on that router's `resolvedLocation` produced a false timeout. The final observation performs no router import and checks actual visible destination content.

No application source changes were needed during this observation. The fixture server was left running.
