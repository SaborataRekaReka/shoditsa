# Эксплуатация админ-панели

## Первый запуск

Требуются Node.js 24, PostgreSQL с импортированной active content revision и заполненный `.env`.

```powershell
npm ci
npm run db:migrate
npm run admin:bootstrap -- --email=breneize@yandex.ru
npm run dev
```

`npm run dev` поднимает web, API и worker. Для раздельного запуска используйте `npm run dev:web`, `npm run dev:api`, `npm run dev:worker`. После bootstrap перенесите напечатанный UUID в единственное значение `ADMIN_USER_IDS`; email должен оставаться единственным `breneize@yandex.ru`.

## Production

Production stack описан в `compose.production.yml`: Postgres, API, worker и одноразовый профиль migrate. Worker обязан иметь read/write volumes для enrichment и media; API имеет media read-only и не получает upstream AI/API secrets.

Порядок release:

1. собрать один image tag для API/worker/migrate;
2. запустить `docker compose --profile migrate run --rm migrate`;
3. обновить API и worker одним tag;
4. дождаться `/api/v1/health/ready`;
5. выложить web release и переключить immutable symlink;
6. выполнить smoke с `EXPECTED_SHA`.

```bash
EXPECTED_SHA=<git-sha> PRODUCTION_URL=https://shoditsa.ru npm run smoke:production
```

Smoke доказывает SHA, обязательные shell markers, отсутствие Yandex SDK и публичных answer datasets, а также наличие контента всех шести режимов. Deploy workflow мигрирует прежний Nginx root `/opt/repeto/deploy/shoditsa` на `/opt/shoditsa/current/web`, сохраняя существующие TLS-настройки vhost.

## Очередь и worker

Jobs хранятся в `background_jobs`. Worker забирает их через `FOR UPDATE SKIP LOCKED`, ставит heartbeat, повторяет временные ошибки с backoff и завершает job терминальным статусом. Музыкальная concurrency намеренно равна одному процессу.

При stuck/failed job:

1. проверьте, что worker-контейнер запущен и видит PostgreSQL;
2. проверьте `heartbeat_at`, `attempts`, `error_code`, безопасное сообщение и обрезанный log excerpt в разделе «Система»;
3. проверьте права на `/opt/shoditsa/shared/enrichment` и `/opt/shoditsa/shared/media`;
4. исправьте причину и выполните retry из UI — это создаст новый job с новым idempotency key.

Не запускайте enrichment вручную внутри API-контейнера. Не копируйте API keys в `VITE_*` и не вставляйте их в комментарии/аудит.

## Ревизии, backup и rollback

Workspace не меняет active content. Build создаёт полную immutable revision и останавливается при validation errors, конфликте base revision, повторном checksum или падении числа карточек более чем на 5% в любом из шести режимов. Activation — единственный шаг, меняющий runtime-контент.

Перед опасной публикацией убедитесь, что свежи PostgreSQL backup и media backup по runbook из `docs/backend`. Для rollback выберите предыдущую `retired` revision в «Система → Ревизии», нажмите «Откатить», укажите причину и подтвердите действие. Текущая active revision атомарно станет `retired`, выбранная — `active`; операция записывается в аудит. Не изменяйте payload ревизий вручную.

Срочная замена materialized daily challenge доступна там же, в блоке «Будущие загадки». Разрешены только даты позже текущей московской даты, карточка того же режима из active revision с `allowedInGame = true` и challenge без начатых сессий. Текущую загадку менять нельзя; причина обязательна и сохраняется в аудит.

Web rollback выполняется переключением `/opt/shoditsa/current` на предыдущий immutable release и повторным smoke. API/worker должны откатываться на один image tag.

## Retention и наблюдаемость

Client telemetry принимает только allowlisted события, не более 50 за батч, не старше семи дней и не дальше пяти минут в будущем. `eventId` обеспечивает дедупликацию. Для регулярной очистки ставится `client_event_retention` job; export results и pipeline raw references имеют ограниченный срок хранения, указанный в соответствующих run/job records.

Основные сигналы:

- `/api/v1/health/live` — процесс жив;
- `/api/v1/health/ready` — доступна БД и active revision;
- `/api/v1/admin/health` — worker/jobs/content readiness;
- `/metrics` с monitoring token — HTTP и игровые счётчики;
- request ID связывает API error, report, client/auth event и audit entry.

После изменений запускайте:

```powershell
npm run typecheck
npm test
npm run test:integration
npm run build
npm run build:api
npm run yandex:bundle
```

Yandex archive проверяется отдельно: в нём должны быть SDK и автономные data assets, но не admin chunk; обычная server-сборка, наоборот, не должна содержать SDK или `/data`.
