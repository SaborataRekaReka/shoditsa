# Refactor Baseline Checklist

## Baseline metrics

1. Run `npm run build`
2. Run `npm run metrics:baseline`
3. Open app and verify runtime metrics in `window.__SEANS_REFACTOR_METRICS__`
   - `first_render`
   - `search_duration`
   - `fcp`, `lcp`, `cls`

## Regression scenarios

- [ ] Hub screen renders all mode cards with counts
- [ ] Title screen opens at `/games/:mode` for all manifest modes
- [ ] Period selector works for year-based modes; variant selector works for Cities
- [ ] Game flow: search suggestion -> submit attempt -> status updates
- [ ] Server game uses `/sessions/:sessionId`; Yandex/local game uses `/play/:mode`
- [ ] Game flow: hint modal (5/8 rounds) opens and persists selections
- [ ] Rewatch archive opens last 7 days and can start archived game
- [ ] Stats modal opens and shows values by current mode
- [ ] Rules modal opens and closes
- [ ] Resume modal appears when >1 active session
- [ ] Share action produces spoiler-free text
- [ ] Hosted bundle contains neither `/data` nor `/city-content`
