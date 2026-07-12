# Rollback

Frontend: атомарно направить `/opt/shoditsa/current` на предыдущий release и выполнить `nginx -t && systemctl reload nginx`.

API: выставить предыдущий `APP_IMAGE_TAG` и выполнить `docker compose up -d api`; дождаться readiness. Последний и предыдущий API должны быть совместимы с текущей expand/contract schema.

Content: активировать прежнюю ready/retired revision через admin API/CLI. Существующие sessions не меняются.

DB: автоматический down запрещён. При data disaster восстановить проверенный dump в новый volume по restore runbook и переключить `DATABASE_URL` после проверки. Любой rollback фиксируется в incident log с SHA, revision, backup checksum и smoke result.
