# Сходится!

Серверная платформа ежедневных игр с семью режимами. Веб-версия использует Fastify, PostgreSQL и server-authoritative игровые сессии; автономная сборка Яндекс Игр использует те же контракты, режимы и игровое ядро с локальным контроллером хранения.

## Локальный запуск

Требования: Node.js 24.14.1+, npm 10+, Docker Compose v2.

```powershell
Copy-Item .env.example .env
docker compose up -d --wait postgres mailpit
npm ci
npm run db:migrate
npm run content:import -- --dry-run
npm run content:import -- --apply
npm run content:activate -- --latest-ready
npm run content:materialize
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3001/api/v1`
- OpenAPI UI в development: `http://localhost:3001/api/docs`
- Mailpit: `http://localhost:8025`
- PostgreSQL: `localhost:5434`

## Проверки

```powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
npm run build:api
npm run data:validate
docker build -f infra/docker/Dockerfile.api .
```

Integration/E2E требуют запущенного PostgreSQL с применённой migration и active content revision. `test:e2e` поднимает отдельные API/Web процессы на 3002/5174.

Yandex Games bundle собирается только вручную и локально: `npm run yandex:bundle`. Архивы `dist.zip` и `dist-yandex.zip` находятся в `.gitignore`; CI, release workflow и production deploy их не создают и не загружают.

## Основные команды данных

```powershell
npm run db:generate
npm run db:migrate
npm run db:check
npm run content:import -- --source ./public/data/libraries --dry-run
npm run content:import -- --source ./public/data/libraries --apply
npm run content:activate -- --revision <uuid>
npm run content:export -- --revision <uuid> --output ./tmp/export
npm run content:materialize -- --days-before 90 --days-after 30
npm run content:media:migrate -- --target C:\path\to\media --apply
```

Старые JSON и upstream-скрипты остаются staging-источниками. Production runtime читает каталоги и игровое состояние только из PostgreSQL.

## Архитектура и эксплуатация

- [Архитектура](docs/backend/ARCHITECTURE.md)
- [Стандарт добавления игрового режима](docs/refactor/GAME_MODE_STANDARD.md)
- [Канонический дизайн-гайд интерфейса](docs/UI_DESIGN_GUIDELINES.md)
- [База данных](docs/backend/DATABASE.md)
- [API](docs/backend/API.md)
- [Импорт контента](docs/backend/CONTENT_IMPORT.md)
- [Deploy на Timeweb](docs/backend/DEPLOY_TIMEWEB.md)
- [Backup/restore](docs/backend/BACKUP_RESTORE.md)
- [Безопасность](docs/backend/SECURITY.md)
- [Rollback](docs/backend/ROLLBACK.md)
- [Acceptance report](docs/backend/ACCEPTANCE_REPORT.md)
