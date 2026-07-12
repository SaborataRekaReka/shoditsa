# Backup и restore

`infra/backup/backup-postgres.sh` создаёт custom-format `pg_dump`, SHA-256 и закрытые permissions. Systemd timer запускается в 00:00 UTC, то есть 03:00 Moscow. Перед каждой migration/deploy создаётся отдельный dump. Media копируется off-host инкрементально средствами Timeweb snapshot/backup или отдельного backup storage.

Restore drill:

1. Создать новый пустой PostgreSQL volume/database, не production DB.
2. Установить `RESTORE_DATABASE_URL` на disposable target.
3. Выполнить `infra/backup/restore-postgres.sh <dump>`.
4. Запустить `db:check`, integration tests и выборочную semantic content проверку.
5. Зафиксировать время, checksum, row counts и результат.

Retention policy: 7 daily, 4 weekly, 6 monthly; конкретная ротация и off-host lifecycle настраиваются backup provider. Restore drill проводится минимум раз в месяц.
