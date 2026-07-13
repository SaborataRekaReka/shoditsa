# Карта интеграций админ-панели

Документ фиксирует реальные точки соединения `/admin` с текущим приложением. Канонический runtime-источник — PostgreSQL; JSON-каталоги и enrichment-скрипты являются входом пайплайна, но не читаются игровым API напрямую.

## Доступ

Админ проходит тройную проверку на каждом `/api/v1/admin/*` запросе:

- `player_profiles.role = admin`;
- UUID пользователя совпадает с единственным значением `ADMIN_USER_IDS`;
- email пользователя и единственное значение `ADMIN_EMAILS` равны `breneize@yandex.ru`.

В текущей базе владелец bootstrap-нут как `07533c59-de3e-43f8-b40a-5a0fee06f557`. Перед production deploy UUID необходимо ещё раз получить командой:

```powershell
npm run admin:bootstrap -- --email=breneize@yandex.ru
```

Команда не создаёт пользователя и не принимает другой email: учётная запись сначала должна существовать в таблице `user`. В production конфиг откажется запускаться при нескольких email/UUID или неверном UUID.

## Потоки данных

| Поверхность | Каноническое хранилище | Запись | Публикация/потребитель |
| --- | --- | --- | --- |
| Карточки шести режимов | `content_items`, `content_item_versions`, `content_aliases`, `diagnosis_vignettes` | Админ пишет в `content_workspace_changes` | Worker строит новую immutable revision; игра читает только `content_revisions.status = active` |
| Рабочая версия | `content_workspaces`, `content_workspace_changes` | Optimistic lock через `expectedVersion` | Validate → build job → ready revision → явная activation |
| Жалобы | `content_reports` | Игровой endpoint с `clientEventId`; админ меняет статус/связи | Очередь отчётов, карточка контента, timeline |
| Контентные пайплайны (музыка, кино, аниме) | `pipeline_runs`, `pipeline_run_items`, `background_jobs` | API ставит domain job; отдельный worker запускает enrichment scripts | Одобренные поля попадают в workspace в своём mode, но не сразу в active revision |
| Пользователи | Better Auth `user/session/account`, `player_profiles`, wallet/stat tables | Block/unblock, session revoke, notes, wallet adjustment | Обычные API отклоняют активную блокировку кодом `ACCOUNT_BLOCKED` |
| События | `game_sessions`, attempts/hints, `auth_events`, `client_events`, reports, wallet ledger | Серверные события и батч `/api/v1/client-events/batch` | Единая read-model timeline и export jobs |
| Аудит | `audit_log` | Все опасные admin mutations | Раздел «Аудит»; значения секретов не сохраняются |

## Активные payload-схемы

Общее ядро карточки: `id`, `mode`, `titleRu`, строковый `titleOriginal`, массив `alternativeTitles`, опциональные `year`, `plotHint`, media URL и `allowedInGame`. Дополнительные поля остаются в JSONB payload и валидируются по режиму в admin service.

- `movie`: runtime, рейтинги, создатели, актёры, Kinopoisk/IMDb.
- `series`: сезоны/эпизоды, статус, showrunners, Kinopoisk/IMDb.
- `anime`: kind/status/source/studios, Shikimori metadata.
- `game`: developers/publishers/platforms, Steam и Metacritic metadata.
- `music`: canonical ID, aliases, tier/status, tracks/albums, связи и quality; `allowedInGame` обязателен явно.
- `diagnosis`: ICD-10 или ICD group, симптомы/диагностика/риски и case vignettes.

Валидация блокирует несовпадение `id/mode`, утечку ответа в подсказке, небезопасные media URL, неверный год и отсутствие обязательных mode-specific полей.

## Файлы и внешние интеграции

- Enrichment root: `ENRICHMENT_DATA_ROOT`; локально `./data/enrichment-agent`, в worker-контейнере `/app/data/enrichment-agent`.
- Постоянный production volume: `/opt/shoditsa/shared/enrichment`.
- Media root: `MEDIA_ROOT`; production volume `/opt/shoditsa/shared/media`, публичный prefix задаёт `PUBLIC_MEDIA_BASE_URL`.
- Domain adapters: `scripts/music/run-agent-cycle.mjs`, `scripts/movies/run-agent-cycle.mjs`, `scripts/anime/run-agent-cycle.mjs` и общее ядро `scripts/enrichment-agent/run.mjs`.
- Разрешённая AI-модель: `MUSIC_PIPELINE_MODEL=gpt-5-mini`.
- Секреты Kinopoisk/Shikimori/OpenAI/LastFM/Spotify/TheAudioDB и музыкальный proxy URL передаются дочернему процессу worker только на время запуска. Сохранённые через админку значения зашифрованы и возвращаются в браузер только маской.

## Переменные окружения

Обязательные для admin runtime: `ADMIN_EMAILS`, `ADMIN_USER_IDS`, `DATABASE_URL`, Better Auth settings, `PROMO_CODE_PEPPER`, media settings. Для worker дополнительно: `ENRICHMENT_DATA_ROOT`, `WORKER_ID`, poll/heartbeat/stale intervals и нужные upstream credentials.

Ни одно имя секрета не имеет префикса `VITE_`. В браузер передаются только base URL и версия приложения. Реальная доступность production credentials этой реализацией не подтверждается: её проверяют отдельным запуском pipeline estimate/run после deploy.
