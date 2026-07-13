# Deploy на Timeweb

Server layout: `/opt/shoditsa/{app,releases,current,shared,volumes,config}`. `.env` хранится в `/opt/shoditsa/config/.env` с mode 600. Nginx остаётся host service; PostgreSQL не публикует порт; API доступен только через `127.0.0.1:3001`.

Первичная подготовка выполняется deploy-пользователем с ограниченным sudo для Docker Compose и `nginx -t/reload`. Скопировать `compose.production.yml`, `infra`, `scripts/deploy` в `/opt/shoditsa/app`, установить Nginx template и выполнить `nginx -t`.

Workflow `.github/workflows/deploy-timeweb.yml`:

1. запускает quality gates;
2. собирает/push API image с SHA tag;
3. создаёт immutable web bundle и checksum;
4. загружает `.tmp` release;
5. делает backup;
6. применяет migration one-shot container;
7. переводит API и worker на один SHA-образ, ждёт readiness API и проверяет, что worker запущен на том же SHA;
8. атомарно переключает `current` symlink;
9. проверяет/reload Nginx;
10. выполняет внешний smoke и оставляет пять releases.

Обязательный post-deploy gate (блокирующий):

1. Проверить `GET /api/v1/meta` на проде.
2. Убедиться, что `activeRevision` не `null`.
3. Убедиться, что `modes` не пустой и все count > 0.
4. Если `activeRevision == null` или `modes` пустой, деплой считается неуспешным: сразу выполнить `npm run content:import -- --apply`, затем `npm run content:activate -- --latest-ready`, затем `npm run content:materialize` против продовой БД, и только после этого завершать релиз.

Обязательный UI gate (блокирующий):

1. В проекте поддерживается только один web shell (classic `App`), переключаемых UI-вариантов нет.
2. После деплоя сделать внешний smoke по `https://shoditsa.ru/` и убедиться, что отображается classic shell:
3. Верхний хедер с кнопками «Как играть / Архив / Статистика / Профиль».
4. Футер с навигацией и копирайтом.
5. Профиль открывает привычную форму входа classic-версии.
6. При несоответствии хотя бы одного пункта релиз откатывается на последний backup и считается неуспешным.

Production activation требует новых DB/auth/promo secrets, SMTP, initial admin email, deploy credentials и off-host backup. Нельзя копировать значения в Git/Actions logs.
