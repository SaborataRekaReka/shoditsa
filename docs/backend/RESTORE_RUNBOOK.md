# Restore runbook

Никогда не восстанавливать поверх production без отдельного incident approval. Проверить `.sha256`, поднять новый volume, выполнить `pg_restore --clean --if-exists --no-owner`, затем `npm run db:check`, `npm run test:integration` и API smoke. После подтверждения переключение выполняется через новый `DATABASE_URL`; старый volume сохраняется до закрытия инцидента.
