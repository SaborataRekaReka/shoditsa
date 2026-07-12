# Implementation checklist

- [x] Workspaces, contracts, game-core и сохранённый Yandex build mode.
- [x] PostgreSQL 18 compose, Drizzle schema/migration, pg_trgm и constraints.
- [x] Six-mode import dry-run/apply/activate/export/materialize.
- [x] Fastify config/logging/errors/security/health/meta/OpenAPI.
- [x] Server search/start/resume/attempt/hints/archive and answer-leak guard.
- [x] Better Auth anonymous/email/password/verification/reset plumbing and profile UI.
- [x] TanStack Query client and server-authoritative web game flow.
- [x] Stats, attendance, reward ledger, unlock, free-play, promo and legacy import.
- [x] Admin revision/salt/promo/wallet/review API with audit log.
- [x] Persistent media migration tool and Nginx routing template.
- [x] Production Compose, atomic deploy, backup/restore and CI.
- [x] Hard post-deploy gate: `/api/v1/meta` must have non-null `activeRevision` and non-empty mode counts.
- [x] Hard UI gate: web runs only classic `App` shell (no variant switch), post-deploy smoke confirms classic header/footer/login form.
- [x] Unit characterization (20 fixtures per mode), DB/API integration and browser smoke.
- [ ] Production SMTP/secrets/admin/deploy credentials supplied by owner.
- [ ] Final production media snapshot migrated and verified on VPS.
- [ ] Off-host backup enabled and restore drill recorded.
- [ ] Staging/cutover/60-minute observation executed with explicit deploy approval.
