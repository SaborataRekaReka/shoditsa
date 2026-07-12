# Acceptance report

Дата локальной проверки: 2026-07-11.

Подтверждено:

- TypeScript project references: pass.
- Unit/contract tests: 16 pass; six modes include 20 golden comparisons each.
- PostgreSQL 18.4 migration on empty Docker volume: pass.
- Content dry-run/apply/activate/db-check: pass, active total 4586 with exact baseline counts.
- API integration: concurrent start converges to one session; unfinished response has no answer; repeated idempotency key creates one attempt.
- Browser E2E: desktop/mobile guest start, reload resume, confirmed attempt, six modes and no horizontal overflow: 4 pass.
- Web build and API bundle: pass.
- OpenAPI 3.1 generation: pass.

Остаются environment-dependent gates: production SMTP verification/reset, final media download/copy on VPS, Docker image build in CI/Node 24, external load test, off-host backup restore, staging and production cutover. Они требуют credentials/server resources из раздела 29 ТЗ и не выполнялись без разрешения на deploy.
