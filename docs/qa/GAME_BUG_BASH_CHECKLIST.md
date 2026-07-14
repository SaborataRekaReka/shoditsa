# Game Bug Bash Checklist

This checklist is for deep exploratory testing of UI, logic, and mechanics, including unexpected user behavior.

## 1. Environment and Data

- [ ] Start API, web, and DB from a clean state.
- [ ] Confirm active content revision is loaded.
- [ ] Confirm all 6 modes are available in UI.
- [ ] Confirm both desktop and mobile viewports are tested.

## 2. Core Gameplay Flow (per mode)

- [ ] Start a daily session and verify game shell appears.
- [ ] Submit one valid attempt and verify attempt counter increments.
- [ ] Submit 10 wrong attempts and verify terminal loss state.
- [ ] Submit correct answer and verify terminal win state.
- [ ] Verify answer card appears only after win/loss.
- [ ] Verify result actions are visible (copy/share/next action).

## 3. Input and Suggestion Edge Cases

- [ ] Empty query does not allow invalid submission.
- [ ] Rapid typing and backspacing does not break suggestion list.
- [ ] Switching keyboard layout (ru/en) keeps search responsive.
- [ ] Special characters and punctuation do not crash search.
- [ ] Very short queries (1 letter) remain stable under fast edits.
- [ ] Duplicate guess in same session is blocked.

## 4. Hint Mechanics and Checkpoints

- [ ] Hint action is locked before 5 attempts.
- [ ] At 5 attempts, hint action becomes available.
- [ ] Picking a hint at checkpoint 5 succeeds exactly once.
- [ ] Second pick on same checkpoint is blocked.
- [ ] Repeat the same checks for checkpoint 8.

## 5. Session Stability and Recovery

- [ ] Reload page mid-session and verify progress persists.
- [ ] Reload page on result screen and verify result persists.
- [ ] Open second tab and verify consistent state.
- [ ] Navigate away and back via footer/header and verify no resets.

## 6. Economy and Progression

- [ ] Verify ticket balance changes after session completion.
- [ ] Verify free-play unlock requires enough balance.
- [ ] Verify free-play cost progression is correct over repeated launches.
- [ ] Verify promo activation handles invalid code with clear error.
- [ ] Verify idempotent retry does not double-charge unlock or promo.

## 7. Archive and Rewatch

- [ ] Open archive and launch a historical day.
- [ ] Verify archive game has correct heading and context.
- [ ] Verify replay in archive does not corrupt daily session progress.
- [ ] Verify mode tabs in archive are all reachable and responsive.

## 8. Mobile and Layout Robustness

- [ ] Check no horizontal overflow on root page.
- [ ] Check no horizontal overflow in active game.
- [ ] Hint tiles remain usable on narrow viewport.
- [ ] Long text does not overlap controls.
- [ ] Sticky/fixed elements do not hide critical buttons.

## 9. Unexpected Actions (Chaos Pass)

- [ ] Repeatedly click main navigation quickly for 20-30 seconds.
- [ ] Rapidly open/close dialogs (`How to play`, `Stats`, `Tickets`).
- [ ] Spam `Start` button click when entering a mode.
- [ ] Alternate between profile and game routes during active session.
- [ ] Verify no page crashes, no unhandled exceptions, no API 5xx.

## 10. Security and Contract Checks

- [ ] Verify in-progress session payload does not expose answer internals.
- [ ] Verify answer becomes visible only in terminal state.
- [ ] Verify game attempt endpoint rejects out-of-pool item IDs.
- [ ] Verify unauthorized session access returns not found/forbidden.

## 11. Automated Runs

- [ ] Unit checks: `npm test`
- [ ] Integration checks: `npm run test:integration`
- [ ] E2E checks: `npm run test:e2e`

## 12. Reporting Template

Use the template below for each bug:

- Title:
- Severity: blocker | critical | major | minor
- Area: ui | mechanics | logic | data | auth | economy
- Preconditions:
- Steps to reproduce:
- Expected result:
- Actual result:
- Frequency: always | often | rare
- Build/commit:
- Screenshot/video:
- Console/API logs:
