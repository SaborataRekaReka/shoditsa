# «Сходится!» — техническое задание на переход к серверной архитектуре

**Версия документа:** 1.0  
**Дата:** 11 июля 2026  
**Репозиторий:** `SaborataRekaReka/shoditsa`  
**Базовая ветка:** `main`  
**Проверенный commit:** `3e1e151b3019c96df6d4d38885e5a41c121d8fb3`  
**Основной production-домен:** `https://shoditsa.ru`  
**Целевой исполнитель:** Codex 5.3  
**Статус:** утверждаемая спецификация реализации

---

## 1. Назначение документа

Нужно перевести работающую браузерную платформу «Сходится!» со статической архитектуры на серверную, сохранив текущий интерфейс, шесть игровых режимов, существующую игровую механику и данные.

После реализации:

- PostgreSQL является единственным production-источником контента, игровых сессий, статистики, экономики и аккаунтов;
- правильный ответ и расчёт результата находятся на сервере;
- игрок может начать без регистрации, затем привязать постоянный аккаунт;
- прогресс доступен после перезагрузки и на другом устройстве после входа;
- билеты, промокоды, разблокировки и награды невозможно изменить через DevTools;
- сайт, API, PostgreSQL и игровые изображения работают на текущем сервере Timeweb;
- Nginx напрямую отдаёт frontend и изображения, поэтому отдельный CDN в первой серверной версии не используется;
- сборка Яндекс Игр продолжает собираться, но приоритетом является веб-версия на `shoditsa.ru`;
- переход выполняется постепенно, с возможностью быстрого отката frontend/API и без потери исходных JSON до подтверждения миграции.

Этот документ должен использоваться исполнителем как источник требований. При расхождении с устаревшими файлами `docs/01_PRODUCT_BRIEF.md`, `docs/03_DATA_MODEL.md`, `docs/06_TECH_ARCHITECTURE.md` и `docs/07_ACCEPTANCE_CHECKLIST.md` приоритет имеет данное ТЗ: старые документы описывают статический MVP.

---

## 2. Обязательные архитектурные решения

Исполнитель не должен повторно выбирать стек или менять его без доказанной технической причины.

### 2.1. Стек

| Слой | Требование |
|---|---|
| Frontend | Сохранить React + Vite + TypeScript |
| Работа с server state | TanStack Query 5 |
| Backend | Node.js 24 LTS, TypeScript, Fastify 5 |
| Валидация | JSON Schema + TypeBox, схемы запросов и ответов обязательны |
| API-документация | OpenAPI 3.1, генерируемая из тех же схем |
| База | PostgreSQL 18, один экземпляр на текущем VPS |
| ORM | Drizzle ORM + `drizzle-kit`; миграции хранятся в Git |
| Драйвер PostgreSQL | `postgres` (`postgres.js`) |
| Авторизация | Better Auth 1.x, `@better-auth/drizzle-adapter`, anonymous plugin |
| Логи | Pino в JSON-формате, встроенная интеграция Fastify |
| Unit/integration tests | Vitest |
| E2E | Playwright |
| Контейнеризация | Docker Compose v2 |
| Reverse proxy и файлы | Существующий Nginx на хосте |

Референсные актуальные версии на дату документа: Fastify `5.10.0`, Drizzle ORM `0.45.2`, drizzle-kit `0.31.10`, Better Auth `1.6.23`, postgres.js `3.4.9`, TanStack Query `5.101.2`, TypeBox `0.34.51`. Перед установкой исполнитель проверяет совместимость пакетов, фиксирует точные версии в `package-lock.json` и не использует диапазоны `latest` в production-зависимостях.

### 2.2. Архитектурный стиль

Использовать модульный монолит. Backend запускается одним stateless API-процессом и делится на изолированные доменные модули внутри приложения.

Микросервисы, Kubernetes, GraphQL, Firebase, MongoDB и отдельный Redis в эту реализацию не входят. Границы модулей должны позволять добавить Redis/Valkey и несколько API-инстансов позже.

### 2.3. Production URL

- Канонический адрес: `https://shoditsa.ru`.
- `http://shoditsa.ru` продолжает отвечать `301` на HTTPS.
- Frontend обращается к API по относительному пути `/api/v1`, без CORS на основном сайте.
- Better Auth обслуживается под `/api/auth/*`.
- Изображения контента доступны под `/media/*`.
- Статические UI-ассеты Vite доступны под `/assets/*` и `/images/*`.

На момент аудита HTTP уже перенаправляется на HTTPS, а HTTPS отдаётся Nginx 1.27.5. Существующее TLS-поведение нужно сохранить.

---

## 3. Зафиксированное текущее состояние

### 3.1. Код

- Проект является клиентским React/Vite SPA.
- `src/App.tsx` — около 3 748 строк и содержит UI, игровые сценарии и экономику.
- `src/game.ts` — около 977 строк; содержит выбор ответа, поиск и сравнение по всем режимам.
- `src/storage.ts` — около 510 строк; хранит игры, статистику, билеты, промокоды и разблокировки в `localStorage`.
- `src/hooks/use-data-loader.ts` загружает полные каталоги и поисковые индексы из `public/data`.
- `vite.config.ts` использует `base: './'` для ZIP-сборки Яндекс Игр.
- Production-деплой копирует `dist/*` в `/opt/repeto/deploy/shoditsa`.
- Сгенерированные изображения библиотек исключены из Git и загружаются на сервер отдельно.

### 3.2. Production-данные на дату аудита

| Режим | Количество записей |
|---|---:|
| Фильмы | 1 246 |
| Сериалы | 811 |
| Аниме | 1 000 |
| Игры | 1 000 |
| Музыка | 409 |
| Диагнозы | 120 |
| Всего | 4 586 |

В Git checkout музыкальная библиотека отсутствует, хотя production отдаёт 409 записей по `/data/libraries/music/items.json`. Перед первым импортом исполнитель обязан получить музыкальный файл с production-сервера или из утверждённого локального источника, посчитать checksum и включить его в отчёт импорта. Импорт с нулевой музыкальной библиотекой запрещён.

### 3.3. Уязвимые клиентские зоны

Сейчас на клиенте выполняются операции, которые после миграции должны стать серверными:

- выбор ответа дня (`dailyTitle`);
- сравнение попытки и ответа (`compareTitles`);
- выбор анамнеза диагноза;
- раскрытие обычных и музыкальных подсказок;
- определение победы/поражения;
- начисление награды;
- расчёт серий посещения;
- списание билетов за период и свободную игру;
- применение промокодов;
- хранение кошелька и журнала операций;
- смена глобальной соли через клиентские admin-функции;
- музыкальные review-решения.

Все перечисленные операции должны исчезнуть из доверенной клиентской зоны.

---

## 4. Границы первой серверной версии

### 4.1. Входит в обязательный объём

1. Монорепозиторий/workspaces без потери текущей истории Git.
2. Fastify API и PostgreSQL.
3. Миграции Drizzle.
4. Импорт всех шести каталогов.
5. Серверный поиск.
6. Серверные ежедневные, архивные и свободные игровые сессии.
7. Все текущие правила сравнения и подсказок.
8. Анонимные пользователи.
9. Регистрация и вход по email + пароль.
10. Привязка анонимного прогресса к аккаунту.
11. Серверная статистика, серии, посещаемость и экономика.
12. Серверные промокоды и разблокировки.
13. Однократная миграция безопасной части старого `localStorage`.
14. Роль администратора и серверное управление daily salt.
15. Хранение изображений на том же VPS и отдача через Nginx.
16. Docker Compose, Nginx-конфигурация, миграции, резервные копии и CI/CD.
17. Набор unit, integration, E2E и smoke-тестов.
18. Сохранение текущего визуального поведения и mobile-first UX.

### 4.2. Отложено

- полноценная графическая CMS для редактирования контента;
- социальные OAuth-провайдеры, пока владелец не предоставит credentials;
- полноценная серверная интеграция Яндекс Игры с подписанным Player ID;
- real-time комнаты и WebSocket-мультиплеер;
- публичные профили и лидерборды;
- платежи;
- S3/CDN;
- Redis/Valkey;
- горизонтальное масштабирование PostgreSQL;
- SSR и перевод клиента на Next.js.

Сборка Яндекс Игр должна продолжать проходить. Полный sync аккаунта внутри iframe допускается отдельным этапом после веб-релиза.

---

## 5. Целевая схема компонентов

```text
Browser
  ├─ GET /, /assets/*, /images/*  ───────────────┐
  ├─ GET /media/*                                │
  └─ /api/v1/*, /api/auth/*                      │
                                                  ▼
                                           Host Nginx
                                          /          \
                               static files           proxy 127.0.0.1:3001
                                  │                              │
                                  ▼                              ▼
                            current web release             Fastify API
                                                                 │
                                                                 ▼
                                                        PostgreSQL container
```

### 5.1. Инварианты

- Nginx — единственная публичная точка входа на VPS.
- API-контейнер слушает только `127.0.0.1:3001`.
- PostgreSQL не публикует порт наружу.
- У API и PostgreSQL отдельная внутренняя Docker-сеть.
- База и медиа находятся вне release-директорий.
- Runtime frontend не загружает `items.json`, `search-index.json` или `daily-config.json`.
- JSON разрешён как staging/export формат для контентного pipeline и резервных операций.
- Ответ игры отсутствует во всех незавершённых клиентских payload.
- Все write-запросы идемпотентны или защищены уникальными ограничениями.
- Московская дата определяется сервером.

---

## 6. Структура репозитория

Перевести репозиторий на npm workspaces. Допустима миграция корневого frontend в `apps/web` отдельным коммитом, после создания regression-тестов.

```text
apps/
  web/
    src/
      app/
      api/
      features/
        auth/
        game/
        archive/
        profile/
        economy/
        content-review/
      components/
      styles/
    public/
    vite.config.ts
  api/
    src/
      app.ts
      server.ts
      config/
      plugins/
      modules/
        auth/
        users/
        content/
        challenges/
        games/
        hints/
        stats/
        economy/
        admin/
        health/
      lib/
    test/
packages/
  contracts/
    src/
      schemas/
      api-types.ts
  game-core/
    src/
      pool.ts
      daily.ts
      compare/
      hints/
      economy.ts
      normalize.ts
  database/
    src/
      schema/
      client.ts
    migrations/
    drizzle.config.ts
  config/
scripts/
  content/
  deploy/
infra/
  docker/
  nginx/
  systemd/
  backup/
docs/
  backend/
```

### 6.1. Правила зависимостей

- `apps/web` может импортировать `packages/contracts` и безопасные presentation-типы.
- `apps/web` не импортирует серверную функцию выбора ответа и серверные economy-функции.
- `apps/api` импортирует `packages/game-core`, `packages/contracts`, `packages/database`.
- `packages/game-core` не зависит от React, Fastify, Drizzle или DOM.
- `packages/database` не зависит от frontend.
- Общие API-типы выводятся из runtime-схем, а не дублируются вручную.

---

## 7. Контентная модель и версионирование

Текущий `TitleItem` сильно различается по режимам. В первой серверной версии используется гибридная модель: общие индексируемые поля хранятся в колонках, полный валидированный объект режима — в `jsonb`.

### 7.1. Почему нужна версия контента

Изменение названия, рейтинга, жанров или состава участников не должно менять уже сыгранную архивную загадку. Каждая ежедневная загадка закрепляется за конкретной ревизией каталога. Архив использует данные той ревизии, на которой был создан challenge.

### 7.2. Таблицы контента

#### `content_revisions`

- `id uuid primary key`;
- `version text unique not null`, например `2026-07-11T142208Z-a1b2c3d4`;
- `checksum_sha256 text unique not null`;
- `source_manifest jsonb not null`;
- `status text check in ('importing','ready','active','failed','retired')`;
- `created_by uuid null`;
- `created_at timestamptz not null`;
- `activated_at timestamptz null`.

#### `content_items`

Стабильная identity-запись:

- `id text primary key` — сохранить существующие `kp_*`, `shiki_*`, `tgdb_*` и остальные ID;
- `mode content_mode not null`;
- `created_at`, `updated_at`;
- уникальность внешних ID обеспечивается частичными unique indexes там, где это возможно.

#### `content_item_versions`

- `id uuid primary key`;
- `item_id text references content_items(id)`;
- `revision_id uuid references content_revisions(id)`;
- `mode content_mode not null`;
- `title_ru text not null`;
- `title_original text not null default ''`;
- `normalized_title text not null`;
- `year smallint null`;
- `end_year smallint null`;
- `popularity_score real not null`;
- `top_rank integer null`;
- `sort_order integer not null` — сохраняет порядок исходного каталога;
- `allowed_in_game boolean not null default true`;
- `content_status text null`;
- `payload jsonb not null` — валидированный полный объект `TitleItem`;
- `created_at timestamptz not null`;
- `unique(item_id, revision_id)`.

#### `content_aliases`

- `item_version_id uuid`;
- `alias text not null`;
- `normalized_alias text not null`;
- `kind text check in ('ru','original','alternative','external')`;
- `primary key(item_version_id, normalized_alias)`.

#### `content_revision_modes`

- `revision_id uuid`;
- `mode content_mode`;
- `items_count integer`;
- `source_checksum text`;
- `primary key(revision_id, mode)`.

#### `diagnosis_vignettes`

- `id text primary key`;
- `item_version_id uuid`;
- `text text not null`;
- `sort_order integer not null`.

#### `content_review_decisions`

- `id uuid primary key`;
- `item_id text`;
- `field text`;
- `decision jsonb`;
- `reviewer_user_id uuid`;
- `created_at`, `updated_at`;
- `unique(item_id, field, reviewer_user_id)`.

### 7.3. Индексы поиска

Включить PostgreSQL extension `pg_trgm`.

Минимальные индексы:

- B-tree `(revision_id, mode, allowed_in_game, year)`;
- B-tree `(revision_id, mode, sort_order)`;
- GIN trigram на `content_aliases.normalized_alias`;
- B-tree `(item_version_id)` на aliases;
- GIN на `content_item_versions.payload` только после подтверждённого реального запроса; заранее индексировать весь JSONB запрещено.

Нормализация поиска должна повторять текущее поведение: lowercase, Unicode NFKD, удаление диакритики, `ё → е`, нормализация знаков и пробелов. Русские и латинские варианты обрабатываются одинаково.

---

## 8. Игровая и пользовательская модель БД

Все timestamps — `timestamptz`. Игровая дата — PostgreSQL `date`. Денежные игровые значения — целые числа.

### 8.1. Auth и профиль

Better Auth создаёт собственные таблицы `user`, `session`, `account`, `verification` через проверенную и закоммиченную migration. В конфигурации установить `advanced.database.generateId: "uuid"`, чтобы PostgreSQL/CLI использовали UUID-колонки, совместимые с внешними ключами доменных таблиц. Вручную менять auth-контракт без необходимости нельзя.

Дополнительная таблица `player_profiles`:

- `user_id uuid primary key`;
- `role text check in ('player','admin') default 'player'`;
- `display_name text null`;
- `locale text default 'ru'`;
- `timezone text default 'Europe/Moscow'`;
- `legacy_imported_at timestamptz null`;
- `created_at`, `updated_at`.

### 8.2. Настройки приложения

#### `app_settings`

- `key text primary key`;
- `value jsonb not null`;
- `version integer not null default 1`;
- `updated_by uuid null`;
- `updated_at timestamptz`.

Обязательные ключи:

- `daily_global_salt`;
- `active_content_revision_id`;
- `economy_rules_version`;
- `legacy_import_ticket_cap`;
- `legacy_import_deadline`.

### 8.3. Challenges

#### `daily_challenges`

- `id uuid primary key`;
- `challenge_key text unique not null`;
- `puzzle_date date not null`;
- `mode content_mode not null`;
- `period period_key not null`;
- `difficulty difficulty_key null`;
- `revision_id uuid not null`;
- `answer_item_version_id uuid not null`;
- `global_salt integer not null`;
- `algorithm_version integer not null`;
- `created_at timestamptz not null`;
- unique `(puzzle_date, mode, period, coalesce(difficulty,'-'), global_salt)` через выражение или нормализованный `variant_key`.

После создания `answer_item_version_id`, `revision_id` и алгоритм challenge не изменяются. Изменение соли создаёт новый challenge key; завершённые старые сессии продолжают ссылаться на прежний challenge.

### 8.4. Сессии и попытки

#### `game_sessions`

- `id uuid primary key`;
- `user_id uuid not null`;
- `challenge_id uuid null`;
- `kind text check in ('daily','archive','free_play')`;
- `mode`, `period`, `difficulty`;
- `puzzle_date date not null`;
- `revision_id uuid not null`;
- `answer_item_version_id uuid not null`;
- `status text check in ('playing','won','lost')`;
- `attempts_count smallint default 0 check between 0 and 10`;
- `rules_version integer not null`;
- `started_at`, `updated_at`, `completed_at`;
- `reward_ledger_id uuid null`;
- для daily/archive: unique `(user_id, challenge_id)`;
- для free play уникальность определяется `id` и operation key старта.

Поле ответа находится только в БД и никогда не сериализуется до завершения.

#### `game_attempts`

- `id uuid primary key`;
- `session_id uuid not null`;
- `position smallint check between 1 and 10`;
- `guessed_item_version_id uuid not null`;
- `is_correct boolean not null`;
- `hints_snapshot jsonb not null`;
- `idempotency_key uuid not null`;
- `created_at`;
- unique `(session_id, position)`;
- unique `(session_id, guessed_item_version_id)`;
- unique `(session_id, idempotency_key)`.

#### `game_hint_choices`

- `id uuid primary key`;
- `session_id uuid`;
- `checkpoint smallint check in (5,8)`;
- `hint_key text`;
- `response_snapshot jsonb not null`;
- `idempotency_key uuid`;
- `created_at`;
- unique `(session_id, checkpoint)`;
- unique `(session_id, idempotency_key)`.

Snapshot хранится, чтобы архивная сессия отображалась одинаково после изменения контента или логики.

### 8.5. Статистика и посещаемость

#### `user_mode_stats`

- `user_id`;
- `mode`;
- `difficulty_key text default '-'`;
- `played`, `won`, `current_streak`, `best_streak` integers;
- `distribution integer[10]`;
- `updated_at`;
- primary key `(user_id, mode, difficulty_key)`.

#### `daily_attendance`

- `user_id`;
- `activity_date date`;
- `completed_modes content_mode[]`;
- `won_modes content_mode[]`;
- `first_completed_at timestamptz`;
- `full_house boolean`;
- primary key `(user_id, activity_date)`.

#### `attendance_stats`

- `user_id primary key`;
- `current_daily_streak`;
- `best_daily_streak`;
- `last_completed_date`;
- `grace_passes`;
- `total_active_days`;
- `full_house_days`;
- `updated_at`.

### 8.6. Экономика

#### `wallet_accounts`

- `user_id primary key`;
- `balance integer check balance >= 0`;
- `lifetime_earned integer check lifetime_earned >= 0`;
- `version integer not null` для optimistic locking, хотя основные операции используют row lock;
- `updated_at`.

#### `wallet_ledger`

- `id uuid primary key`;
- `user_id uuid`;
- `operation_key text unique not null`;
- `type text check in ('earn','spend','adjustment','migration')`;
- `reason text not null`;
- `amount integer not null` — signed value;
- `balance_after integer not null`;
- `metadata jsonb not null default '{}'`;
- `created_at`.

Ledger append-only. UPDATE/DELETE из прикладного API запрещены.

#### `period_entitlements`

- `user_id`, `mode`, `period`;
- `source text`;
- `ledger_id uuid null`;
- `unlocked_at`;
- primary key `(user_id, mode, period)`.

Период `all` считается доступным системно и отдельной записью может не храниться.

#### `free_play_usage`

- `user_id`, `activity_date`, `launches`;
- primary key `(user_id, activity_date)`.

#### `promo_codes`

- `id uuid`;
- `code_hash text unique`;
- `title text`;
- `reward_type`, `reward_value`;
- `per_user_limit`, `global_limit`;
- `starts_at`, `ends_at`;
- `enabled boolean`;
- `created_by`, `created_at`.

Код нормализуется так же, как сейчас: trim, uppercase ru-RU, `Ё → Е`. В БД хранится HMAC-SHA256 нормализованного кода с server-side pepper. Исходный код не возвращается API.

#### `promo_redemptions`

- `id uuid`;
- `promo_id`, `user_id`, `ledger_id`;
- `idempotency_key uuid`;
- `created_at`;
- unique `(promo_id, user_id, redemption_number)` или эквивалентное ограничение лимита в transaction;
- unique `(user_id, idempotency_key)`.

Клиентский destructive-код `СОСО` удалить из production. Корректировка кошелька выполняется только admin CLI/API с audit log.

### 8.7. Legacy import и аудит

#### `legacy_imports`

- `id uuid`;
- `user_id uuid`;
- `device_id uuid`;
- `schema_version integer`;
- `payload_checksum text`;
- `imported_games integer`;
- `imported_wallet integer`;
- `warnings jsonb`;
- `created_at`;
- unique `(user_id, device_id, schema_version)`.

#### `audit_log`

- `id uuid`;
- `actor_user_id uuid null`;
- `action text`;
- `entity_type`, `entity_id`;
- `before jsonb null`, `after jsonb null`;
- `request_id text`;
- `created_at`.

В audit log попадают: смена соли, активация content revision, admin wallet adjustment, создание/выключение промокода, review-решение и изменение роли.

---

## 9. Контентный импорт

### 9.1. Общий принцип

Текущие скрипты сбора данных можно сохранить как upstream pipeline. Они продолжают формировать проверяемые staging-файлы. Production runtime читает PostgreSQL.

### 9.2. Команды

Добавить:

```bash
npm run db:generate
npm run db:migrate
npm run db:check
npm run content:import -- --source ./public/data/libraries --dry-run
npm run content:import -- --source ./public/data/libraries --apply
npm run content:import:production-snapshot -- --manifest ./data/import-manifest.json
npm run content:activate -- --revision <revision-id>
npm run content:export -- --revision <revision-id> --output ./tmp/export
```

### 9.3. Dry run обязателен

Dry run:

- читает все шесть режимов;
- применяет runtime-схемы `TitleItem` по режимам;
- проверяет уникальность ID;
- проверяет `mode`;
- проверяет диапазоны чисел;
- проверяет корректность ссылок на картинки;
- проверяет число диагнозных кейсов;
- сохраняет порядок записей;
- считает SHA-256 каждого входного файла и общий manifest checksum;
- сравнивает counts с активной ревизией;
- блокирует аномальное падение количества более чем на 5%, пока не передан явный `--allow-count-drop`;
- не пишет в production-таблицы.

### 9.4. Apply

Apply выполняется transactionally в статус `importing`, создаёт version rows, aliases и manifest. При любой ошибке revision получает статус `failed`; активная revision остаётся прежней. Активация выполняется отдельной командой после проверки отчёта.

### 9.5. Первая миграция

1. Создать snapshot всех файлов на server до изменения деплоя.
2. Получить отсутствующую в Git музыкальную библиотеку и связанные изображения.
3. Зафиксировать baseline counts 1 246 / 811 / 1 000 / 1 000 / 409 / 120.
4. Импортировать в новую revision.
5. Запустить сравнение случайной выборки минимум по 20 элементов каждого режима: исходный объект и DB-export должны совпадать семантически.
6. Проверить, что каждый URL изображения отдаёт 200 либо зарегистрирован как известный missing asset.
7. Активировать revision.
8. Предварительно материализовать daily challenges минимум за 90 прошедших и 30 будущих дней.

### 9.6. Стабильность daily challenge

Алгоритм первой materialization должен повторить `src/game.ts` commit `3e1e151`:

- FNV-1a hash;
- seed `seans|mode|period|date|salt|variant`;
- фильтрация периода;
- особые правила series;
- music canonical IDs, tier/difficulty pools, redirects и dataset version;
- сохранённый исходный `sort_order`.

После materialization ответ хранится явно в `daily_challenges`; дальнейшие изменения алгоритма получают новый `algorithm_version`.

---

## 10. API: общие правила

### 10.1. Формат

- JSON UTF-8.
- Даты: `YYYY-MM-DD`.
- Время: ISO 8601 UTC.
- IDs server entities: UUID.
- Существующие content IDs остаются строками.
- API version prefix: `/api/v1`.
- У каждого ответа заголовок `X-Request-Id`.
- Все mutation requests принимают `Idempotency-Key` UUID в заголовке; auth endpoints следуют контракту Better Auth.

### 10.2. Ошибка

```json
{
  "error": {
    "code": "GAME_DUPLICATE_GUESS",
    "message": "Этот вариант уже был в попытках",
    "requestId": "req-...",
    "details": {}
  }
}
```

Допустимые статусы:

- `400` malformed request;
- `401` требуется сессия;
- `403` недостаточно прав;
- `404` entity не найдена;
- `409` конфликт состояния или duplicate;
- `422` валидный JSON нарушает доменное правило;
- `429` rate limit;
- `500` внутренняя ошибка без stack trace.

### 10.3. Запрет утечки ответа

До `won/lost` запрещено возвращать:

- `answerId`;
- answer item/version ID;
- полную answer card;
- неоткрытые answer hints;
- внутренний seed;
- SQL/revision payload, из которого ответ однозначно следует.

Добавить автоматический contract-test, который рекурсивно проверяет незавершённые ответы API на запрещённые ключи и известный answer ID.

---

## 11. API endpoints и контракты

### 11.1. Health и meta

#### `GET /api/v1/health/live`

Проверяет процесс. Не обращается к БД. Ответ `200 { "status": "ok" }`.

#### `GET /api/v1/health/ready`

Проверяет DB query, применённую migration и active content revision. `503`, если API нельзя включать в трафик.

#### `GET /api/v1/meta`

Возвращает server time, Moscow date, API version, rules version, modes/counts и минимальную совместимую frontend version. Не возвращает секреты и answer data.

### 11.2. Auth

Better Auth routes: `/api/auth/*`.

Дополнительно:

- `POST /api/v1/auth/guest` — создаёт anonymous account только при первом намерении играть;
- `GET /api/v1/me`;
- `PATCH /api/v1/me/profile`;
- `POST /api/v1/me/legacy-import`;
- `DELETE /api/v1/me` с повторным подтверждением.

### 11.3. Каталог и поиск

#### `GET /api/v1/catalog/search`

Query:

- `mode` required;
- `q` required, 1–100 chars;
- `period` optional;
- `difficulty` only music;
- `sessionId` preferred — сервер сам применяет revision/pool текущей сессии;
- `limit` 1–20, default 10.

Response:

```json
{
  "items": [
    {
      "id": "kp_535341",
      "mode": "movie",
      "titleRu": "1+1",
      "titleOriginal": "Intouchables",
      "year": 2011,
      "posterUrl": "/media/content/...webp"
    }
  ]
}
```

Search исключает уже использованные guesses, если передан `sessionId`. Клиентский `exclude` не считается доверенным.

#### `GET /api/v1/catalog/items/:itemId`

Возвращает публичную карточку текущей active revision. Для игрового сравнения клиент endpoint не использует.

### 11.4. Start/resume

#### `POST /api/v1/games/start`

Body:

```json
{
  "kind": "daily",
  "mode": "movie",
  "period": "all",
  "difficulty": null,
  "archiveDate": null
}
```

Правила:

- `daily` игнорирует клиентскую дату и использует текущую Moscow date;
- `archive` требует прошедшую/текущую дату и существующий challenge;
- `free_play` создаётся отдельным economy endpoint;
- для game/music/diagnosis period принудительно `all`;
- difficulty разрешена только music;
- повторный start возвращает существующую session;
- сервер создаёт challenge через `INSERT ... ON CONFLICT` и повторно читает победившую запись.

Response:

```json
{
  "session": {
    "id": "uuid",
    "kind": "daily",
    "mode": "movie",
    "period": "all",
    "difficulty": null,
    "puzzleDate": "2026-07-11",
    "status": "playing",
    "attemptsCount": 0,
    "attemptsRemaining": 10,
    "attempts": [],
    "hintCheckpoints": [
      { "round": 5, "state": "locked" },
      { "round": 8, "state": "locked" }
    ],
    "diagnosisVignette": null,
    "serverTime": "2026-07-11T...Z"
  }
}
```

Для diagnosis `diagnosisVignette` содержит выбранный анамнез, поскольку это предусмотренная стартовая подсказка.

#### `GET /api/v1/games/:sessionId`

Возвращает resume snapshot. При завершённой игре включает `answer` и `reward`.

### 11.5. Попытка

#### `POST /api/v1/games/:sessionId/attempts`

Body:

```json
{ "itemId": "kp_..." }
```

В одной DB transaction:

1. lock game session `FOR UPDATE`;
2. проверить owner, `playing`, attempts < 10;
3. найти guessed version в revision и разрешённом pool;
4. проверить duplicate;
5. вычислить hints в `game-core`;
6. вставить attempt;
7. определить статус;
8. при завершении обновить stats, attendance и wallet exactly once;
9. commit;
10. вернуть snapshot.

Response до завершения:

```json
{
  "attempt": {
    "position": 1,
    "item": { "id": "...", "titleRu": "...", "year": 2010, "posterUrl": "/media/..." },
    "hints": []
  },
  "session": {
    "status": "playing",
    "attemptsCount": 1,
    "attemptsRemaining": 9
  },
  "progressiveHints": []
}
```

После завершения дополнительно:

```json
{
  "answer": { "id": "...", "titleRu": "...", "posterUrl": "/media/..." },
  "reward": {
    "total": 25,
    "components": {},
    "balanceAfter": 120,
    "alreadyClaimed": false
  }
}
```

Повтор того же `Idempotency-Key` возвращает исходный успешный ответ без второй попытки и награды.

### 11.6. Assist hints

#### `POST /api/v1/games/:sessionId/hints`

Body:

```json
{ "checkpoint": 5, "hintKey": "plot" }
```

Сервер проверяет текущий round, доступность ключа и отсутствие выбора для checkpoint. Возвращает только выбранную подсказку. Открытие в checkpoint 5/8 сохраняется.

Музыкальные progressive hints строятся сервером и возвращаются с attempt snapshot в соответствии с текущим количеством попыток.

### 11.7. Архив

- `GET /api/v1/archive?mode=&cursor=&limit=30`;
- `GET /api/v1/archive/:date/status`;
- запуск архивной игры выполняется обычным `/games/start kind=archive`.

Архив показывает server sessions и импортированные legacy completions. Cursor pagination обязательна.

### 11.8. Dashboard и экономика

- `GET /api/v1/me/dashboard` — wallet, attendance, active sessions, mode summary одним запросом;
- `GET /api/v1/me/stats`;
- `GET /api/v1/me/wallet`;
- `GET /api/v1/me/wallet/ledger?cursor=&limit=`;
- `GET /api/v1/me/entitlements`;
- `POST /api/v1/economy/period-unlocks`;
- `POST /api/v1/economy/free-play/start`;
- `POST /api/v1/promos/redeem`.

### 11.9. Admin

Только `role=admin`:

- `GET /api/v1/admin/content/revisions`;
- `POST /api/v1/admin/content/revisions/:id/activate`;
- `GET /api/v1/admin/settings/daily-salt`;
- `PUT /api/v1/admin/settings/daily-salt`;
- `POST /api/v1/admin/promos`;
- `PATCH /api/v1/admin/promos/:id`;
- `POST /api/v1/admin/wallet-adjustments`;
- `GET/PUT /api/v1/admin/content-review/...`.

Swagger UI production-доступен только admin либо выключен; raw OpenAPI также защищён или отключён.

---

## 12. Серверные игровые правила

### 12.1. Совместимость

Перенести `poolFor`, `dailyTitle`, `compareTitles`, diagnosis vignette, music redirects/difficulty и hint builders в `packages/game-core`. До переключения frontend написать characterization tests на текущую реализацию.

Для каждого режима минимум 20 golden fixtures, включающих missing fields и partial matches. Новый результат должен совпадать с текущим по ключам, status, direction, matched values и presentation value.

### 12.2. Завершение и награда

Сохранить текущую формулу:

- completion: `10`;
- win: `10`, иначе `0`;
- speed: при победе `max(0, 10 - attemptsCount)`;
- first completion of Moscow day: `5`;
- первый full house дня: `25`;
- streak multiplier: `1.0`, с 3 дней `1.1`, с 7 `1.25`, с 14 `1.4`, с 30 `1.6`;
- итог округляется `Math.round(base * multiplier)`;
- grace pass выдаётся каждые 7 новых дней серии, максимум 2;
- пропуск ровно одного дня может потратить один grace pass.

Mode stats обновляются один раз для уникальной завершённой daily или archive session, как в текущей версии. Билеты и daily attendance начисляются только за challenge текущей московской даты. Archive не выдаёт билеты, а practice/free-play не обновляет mode stats, daily attendance и reward. Изменение этого поведения требует отдельного rules version.

### 12.3. Full house

Full house наступает после завершения хотя бы одной eligible сессии каждого из шести режимов в Moscow day. Повтор режима или другая difficulty не увеличивает число completed modes.

### 12.4. Периоды

- `all` открыт всегда;
- unlockable modes: movie, series, anime;
- стоимость каждого дополнительного периода: 25 билетов;
- одна transaction блокирует wallet, списывает средства, пишет ledger и entitlement;
- повторный запрос возвращает существующий entitlement без списания.

### 12.5. Free play

- eligible modes: movie, series, anime, music;
- стоимость: `45 + launchesToday * 15`;
- списание и создание session выполняются в одной transaction;
- недостаток баланса даёт `409 INSUFFICIENT_TICKETS`;
- повтор idempotency key не создаёт второй запуск;
- free play answer выбирается server-side из active revision и сохраняется в session.

---

## 13. Авторизация и аккаунты

### 13.1. Guest-first

Посетитель может открыть главную без создания DB-user. Anonymous account создаётся при первом действии, которому нужна запись: начало игры, promo, unlock или legacy import.

Это снижает мусор от ботов и простых просмотров.

### 13.2. Постоянный аккаунт

В первой версии реализовать:

- регистрация email + password;
- вход email + password;
- logout текущей сессии;
- logout всех устройств;
- email verification;
- password reset;
- linking текущего anonymous user вместо создания пустого второго профиля.

SMTP-провайдер является внешней конфигурацией. До заполнения SMTP production-переменных guest-игра работает, а UI регистрации показывает понятное сообщение о временной недоступности. Definition of Done авторизации требует настроенного SMTP и успешно пройденных verification/reset E2E на production-like окружении.

### 13.3. Cookies

- HttpOnly;
- Secure production;
- SameSite=Lax для основного сайта;
- Path=/;
- короткая session rotation согласно Better Auth;
- secret минимум 32 random bytes;
- trusted origins: только `https://shoditsa.ru`, dev origins из env;
- основной сайт использует cookie session, токены не хранятся в `localStorage`.

### 13.4. Account merge

Если anonymous player связывается с новым email, переносится тот же user/profile. Если email уже принадлежит аккаунту, требуется явный повторный вход в существующий аккаунт и серверная merge operation.

Merge правила:

- sessions/completions объединяются по challenge, duplicate выбирает более продвинутую/завершённую запись;
- stats пересчитываются из completions, а не складываются вслепую;
- wallet balances складываются только для двух server-trusted wallets;
- entitlements объединяются множеством;
- ledger переносится с неизменяемыми operation keys;
- anonymous account деактивируется;
- операция transaction + audit log.

### 13.5. Роли

Роль admin назначается миграцией/CLI на email из `ADMIN_EMAILS`, но дальнейшее изменение ролей выполняется отдельной admin-командой. Никогда не доверять role из frontend payload.

---

## 14. Миграция старого localStorage

### 14.1. UX

После создания anonymous server account frontend обнаруживает ключи `seans:v1:*` и предлагает один раз: «Перенести прогресс с этого устройства». До согласия ничего не отправляется.

### 14.2. Что импортируется

- saved games и attempt item IDs;
- status;
- hint choices;
- mode stats как справочная legacy-информация;
- daily attendance dates;
- period unlocks;
- wallet balance с ограничением server setting `legacy_import_ticket_cap`, default 500;
- lifetime balance не доверяется и устанавливается не ниже импортированного balance;
- promo usage не импортируется;
- локальный ticket ledger не импортируется строка-в-строку.

### 14.3. Верификация

- каждый game key разбирается и нормализуется;
- answer ID на клиенте игнорируется;
- attempts пересчитываются server-side на соответствующей materialized challenge revision, если она существует;
- невозможные даты, modes, duplicate attempts и >10 попыток отбрасываются с warning;
- status вычисляется заново;
- импортированный wallet создаёт одну ledger entry `legacy-import`, capped;
- импортированный unlock создаёт entitlement source `legacy-import`;
- один device/schema импортируется один раз;
- payload limit 1 MB compressed/разумный JSON limit;
- import endpoint имеет строгий rate limit;
- feature имеет deadline из `app_settings` и может быть выключена.

### 14.4. После успеха

Frontend ставит технический флаг завершения. Старые keys сохраняются 30 дней как local fallback и затем удаляются после дополнительного подтверждения server snapshot. Production уже не читает их для расчёта.

---

## 15. Изменения frontend

### 15.1. Главный принцип

Сохранить существующий дизайн и сценарии. Backend migration не является редизайном.

Нельзя одновременно переписывать весь `App.tsx`, менять визуальную систему и менять backend. Сначала добавить characterization/E2E, затем извлекать feature-модули небольшими шагами.

### 15.2. API слой

Создать единый typed client:

- base URL из `VITE_API_BASE_URL`, production default `/api/v1`;
- `credentials: 'include'`;
- timeout через AbortController;
- error mapping по code;
- request ID в диагностике;
- idempotency UUID сохраняется на время retry;
- никакого автоматического retry для неизвестно завершившихся non-idempotent запросов без ключа.

### 15.3. TanStack Query

Query keys централизованы. Минимум:

- `['me']`;
- `['dashboard']`;
- `['game', sessionId]`;
- `['search', sessionId, query]`;
- `['archive', filters]`;
- `['ledger']`.

Attempts отправляются mutation и применяют server snapshot. UI не вычисляет hints оптимистично.

### 15.4. Состояние

В `localStorage` после миграции допустимы:

- UI preferences;
- последний mode/period;
- consent/legacy migration marker;
- несекретный installation/device ID;
- кэш TanStack Query только после отдельного решения и без answer secrets.

Кошелёк, stats, attempts и answer state в authoritative localStorage больше не сохраняются.

### 15.5. Network UX

- Во время submit кнопка блокируется.
- При timeout можно безопасно повторить с тем же idempotency key.
- При `409` frontend запрашивает актуальный session snapshot.
- При падении API главная может отобразиться, однако запуск и попытка показывают понятное сообщение.
- Нельзя принимать локальную попытку, которая не была подтверждена сервером.

### 15.6. Auth UI

Добавить без редизайна:

- компактную кнопку профиля/входа в header;
- modal регистрации/входа;
- prompt сохранения прогресса после первой завершённой игры;
- экран/модал профиля: имя, email, stats, wallet, devices/logout;
- состояния guest, verified, unverified;
- доступный keyboard/focus flow.

### 15.7. Admin и review

Существующие window-функции смены соли удалить из production frontend. Music review UI показывается только подтверждённому admin и пишет через API.

---

## 16. Изображения и ассеты на текущем сервере

### 16.1. Разделение

- Брендовые UI-ассеты остаются в Vite build.
- Постеры, backdrops, screenshots и фото людей находятся в persistent media root.
- БД хранит только публичный относительный URL и metadata, никогда абсолютный filesystem path.

### 16.2. Server layout

```text
/opt/shoditsa/
  app/                    # compose, deploy scripts
  releases/
    <git-sha>/web/        # immutable frontend release
  current -> releases/<git-sha>
  shared/
    media/
      content/
      people/
    backups/
    import/
  volumes/
    postgres/
  config/
    .env                  # chmod 600, вне Git
```

Старый `/opt/repeto/deploy/shoditsa` после проверки становится compatibility symlink либо Nginx root переводится на `/opt/shoditsa/current/web`. Действующую директорию нельзя очищать текущим скриптом до создания нового atomic deploy.

### 16.3. URL

Новые файлы:

```text
/media/content/<mode>/<item-id>/<kind>-<sha12>.webp
/media/people/<person-id>/<sha12>.webp
```

Content hash в имени позволяет ставить immutable cache. Legacy URLs конвертируются importer-ом; файлы копируются/линкуются в новый media root.

### 16.4. Nginx cache

- content-addressed media: `Cache-Control: public, max-age=31536000, immutable`;
- `index.html`: `no-cache`;
- hashed Vite assets: one year immutable;
- API: `no-store` для auth/game/economy; public meta/search — короткое private/public caching только после явного анализа;
- `try_files $uri =404` для media;
- запрет directory listing;
- корректные MIME types;
- range requests допустимы.

### 16.5. Изображения нельзя класть в PostgreSQL

В БД находятся URL, width/height, byte size, MIME, checksum и source. Binary bytes хранятся на диске.

---

## 17. Безопасность

### 17.1. Обязательные меры

- HTTPS на всех auth/game endpoints;
- PostgreSQL недоступен из интернета;
- API работает непривилегированным user внутри контейнера;
- deploy выполняется отдельным системным пользователем, а не постоянным root SSH;
- secrets только в server `.env`/GitHub Secrets;
- `.env.example` содержит имена без значений;
- SQL только через параметризованные Drizzle/postgres запросы;
- runtime schema validation каждого body/query/response;
- body limit default 256 KB, legacy import отдельный limit;
- rate limiting;
- secure headers;
- origin/CSRF protection Better Auth;
- password hashing делегирован Better Auth;
- логи маскируют cookies, authorization, password, email verification tokens и promo codes;
- ответы production не содержат stack traces;
- admin endpoints проверяют server session + role;
- backups шифруются либо защищены server permissions.

### 17.2. Rate limits baseline

Уточняются по нагрузочному тесту, стартовые значения:

- anonymous auth creation: 10/IP/hour;
- login/register/reset: 5/IP/15 min и 5/email/15 min;
- search: 60/user/min;
- game start: 20/user/min;
- attempt: 30/user/min;
- promo redeem: 5/user/hour;
- legacy import: 3/user/day;
- admin: 60/admin/min.

На одном API-инстансе разрешён in-memory limiter. Перед запуском второго обязательна миграция limiter store в Redis/Valkey.

### 17.3. Security headers

Настроить как минимум:

- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Permissions-Policy` с минимальным набором;
- `frame-ancestors` с учётом будущей сборки Яндекс Игр;
- CSP, учитывающий Yandex Metrika и Yandex Games SDK;
- HSTS только после проверки HTTPS и всех поддоменов.

CSP вводится сначала в report-only, затем enforcement после проверки аналитики и Яндекс-сборки.

---

## 18. Docker Compose и Timeweb

### 18.1. Services

Минимальный `compose.production.yml`:

- `api`;
- `postgres`;
- опциональный one-shot profile `migrate`;
- опциональный profile `backup`, либо backup через host systemd timer.

Nginx остаётся host service и в Compose не переносится.

### 18.2. PostgreSQL

- pin конкретного `postgres:18.x-alpine` image;
- named/bind persistent volume вне release;
- `POSTGRES_DB=shoditsa`;
- отдельный app user;
- healthcheck `pg_isready`;
- timezone БД UTC;
- application timezone logic Europe/Moscow;
- max connections согласовать с API pool;
- порт 5432 не публиковать.

### 18.3. API

- multi-stage Dockerfile;
- builder image Node 24 pinned;
- runtime непривилегированный user;
- production dependencies only;
- `NODE_ENV=production`;
- bind `0.0.0.0:3001` внутри контейнера, host mapping `127.0.0.1:3001:3001`;
- graceful shutdown на SIGTERM: перестать принимать запросы, дождаться активных, закрыть DB pool;
- healthcheck readiness endpoint;
- restart policy `unless-stopped`.

### 18.4. Nginx routing

Репозиторий должен содержать готовый template, адаптируемый к существующему server block:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
}

location /media/ {
    alias /opt/shoditsa/shared/media/;
    try_files $uri =404;
    access_log off;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}

location / {
    root /opt/shoditsa/current/web;
    try_files $uri $uri/ /index.html;
}
```

Перед `nginx -s reload` обязательно `nginx -t`.

---

## 19. Environment variables

Создать типизированный startup validator. API не запускается при отсутствии обязательной production-конфигурации.

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
LOG_LEVEL=info

DATABASE_URL=postgres://shoditsa_app:...@postgres:5432/shoditsa
DATABASE_POOL_MAX=10

BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://shoditsa.ru
TRUSTED_ORIGINS=https://shoditsa.ru
COOKIE_SECURE=true

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
AUTH_EMAIL_ENABLED=true

ADMIN_EMAILS=owner@example.com
PROMO_CODE_PEPPER=...

MEDIA_ROOT=/srv/shoditsa/media
PUBLIC_MEDIA_BASE_URL=/media

LEGACY_IMPORT_ENABLED=true
LEGACY_IMPORT_TICKET_CAP=500

SENTRY_DSN=
APP_VERSION=
GIT_SHA=
```

Frontend:

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_AUTH_BASE_URL=/api/auth
VITE_APP_VERSION=
VITE_YANDEX_GAMES=false
```

Никакие server secrets не должны иметь префикс `VITE_`.

---

## 20. CI/CD

### 20.1. Pull request pipeline

Обязательные jobs:

1. install с `npm ci`;
2. formatting/lint;
3. TypeScript project references/typecheck;
4. unit tests;
5. PostgreSQL integration tests через service container;
6. Drizzle migration from empty DB;
7. content importer dry-run на fixture + доступных production datasets;
8. frontend build;
9. API build;
10. Playwright smoke;
11. Docker image build;
12. Yandex archive build как secondary non-regression job.

### 20.2. Production deploy

Текущий workflow с прямым `scp dist/*` и очисткой target заменить atomic deploy.

Последовательность:

1. CI проходит полностью.
2. Собираются frontend archive и API image/release bundle.
3. Bundle загружается в `/opt/shoditsa/releases/<sha>.tmp`.
4. Проверяется checksum.
5. Выполняется свежий DB backup.
6. Поднимается/обновляется PostgreSQL, если нужно.
7. Запускаются forward-only migrations one-shot container.
8. Запускается новый API container.
9. `/health/ready` должен стабильно ответить 200 несколько раз.
10. Frontend temp release атомарно переименовывается.
11. `current` symlink атомарно переключается.
12. `nginx -t`, затем reload только при изменении config.
13. Внешний smoke проверяет HTTPS, meta, guest auth, start и resume тестовой служебной сессии.
14. Старые 5 releases сохраняются.

Deploy concurrency — один production deploy. Отмена workflow не должна оставлять half-switched release.

### 20.3. Rollback

- Frontend: вернуть symlink на предыдущий release.
- API: запустить предыдущий image tag.
- DB: migrations проектируются expand/contract и совместимы минимум с предыдущим API release.
- Destructive schema changes выполняются отдельным релизом после периода совместимости.
- Автоматический `down migration` по production data запрещён.

---

## 21. Резервное копирование и восстановление

### 21.1. PostgreSQL

- ежедневный `pg_dump -Fc` в 03:00 Europe/Moscow;
- checksum каждого dump;
- 7 daily + 4 weekly + 6 monthly copies;
- backup перед migration/deploy;
- файлы доступны только root/backup group;
- отчёт об успехе/ошибке в лог и мониторинг.

### 21.2. Media

- ежедневный incremental backup media metadata/новых файлов;
- backup manifest checksums;
- удаление media только двухэтапное: mark orphan, grace period, затем purge.

### 21.3. Внешняя копия

Хранение единственной копии backup на том же VPS оставляет риск потери сервера. Production readiness требует хотя бы одного off-host слоя: Timeweb backup/snapshot либо отдельное объектное хранилище для backup. Это не CDN и не участвует в пользовательской выдаче изображений.

### 21.4. Restore drill

Добавить `docs/backend/RESTORE_RUNBOOK.md` и скрипт восстановления в новый volume. Не реже раза в месяц тестовая БД должна восстанавливаться из последнего dump с последующим `db:check` и выборочными API integration tests.

---

## 22. Наблюдаемость

### 22.1. Логи

Каждая запись содержит:

- timestamp;
- level;
- requestId;
- route;
- statusCode;
- durationMs;
- userId в псевдонимизированном/внутреннем виде, если есть;
- appVersion/gitSha.

Не логировать полный search query на info при риске персональных данных; passwords, cookies, auth tokens, promo codes и SMTP полностью redact.

### 22.2. Метрики

Минимум:

- request count/error rate/latency по route group;
- DB pool usage;
- active sessions;
- attempts accepted/rejected;
- games completed;
- reward transactions;
- auth failures;
- backup age;
- active content revision;
- missing media 404.

Существующую Яндекс Метрику сохранить для продуктовых событий. Server-authoritative completion event должен иметь server operation ID, чтобы клиентские события можно было дедуплицировать в аналитике.

### 22.3. Alerts

На первом этапе достаточно внешнего uptime monitor + уведомлений:

- `/health/ready` недоступен 2 минуты;
- 5xx > 5% за 5 минут;
- backup старше 26 часов;
- диск > 80%;
- PostgreSQL container unhealthy.

---

## 23. Производительность

### 23.1. Цели

На production-like VPS с прогретым приложением:

- health/meta p95 < 100 ms;
- search p95 < 200 ms;
- game start/resume p95 < 250 ms;
- attempt transaction p95 < 300 ms;
- frontend initial assets не должны заметно вырасти из-за backend migration;
- error rate под ожидаемой нагрузкой < 1%, исключая намеренные 4xx.

### 23.2. Load test baseline

Добавить k6/другой воспроизводимый сценарий:

- 100 concurrent virtual users;
- 20 RPS sustained 10 минут;
- 100 RPS burst 30 секунд на public/search/start mix;
- отдельный write scenario attempts с уникальными users/sessions;
- проверка отсутствия duplicate attempts/rewards.

### 23.3. Оптимизации

- API держит небольшой in-process cache active content revision/pools;
- cache инвалидируется после admin activation;
- DB pool default 10;
- не выполнять N+1 на session snapshot;
- search limit 20;
- pagination cursor, без больших OFFSET;
- большие payload поля не возвращаются в search;
- изображения отдаёт Nginx, а не Fastify.

Redis добавляется при подтверждённой метриками необходимости или втором API instance.

---

## 24. Тестовая стратегия

### 24.1. Unit

- normalize/search;
- pool filters;
- deterministic challenge selection;
- compare для шести modes;
- hint availability;
- Moscow date around midnight/DST assumptions;
- economy formula;
- streak/grace pass;
- promo normalization;
- legacy payload sanitation.

### 24.2. Characterization

До переноса `src/game.ts` создать fixtures, которые запускаются старой и новой реализацией. Изменение результата разрешено только отдельным documented rules version.

### 24.3. DB integration

- migrations на пустой БД;
- повтор migrations;
- import/activate/rollback active revision;
- concurrent challenge creation;
- concurrent duplicate attempt;
- concurrent reward completion;
- wallet insufficient funds;
- promo per-user/global limits;
- account merge;
- unique constraints.

Тесты должны использовать настоящий PostgreSQL, не SQLite.

### 24.4. API contract

- schemas reject extra/invalid values там, где это требуется;
- error envelope;
- idempotency;
- ownership/authorization;
- answer leakage test;
- admin role;
- rate limits;
- completed response reveals answer only after terminal state.

### 24.5. E2E website

Минимальные Playwright-сценарии:

1. Новый guest запускает игру и делает попытку.
2. Reload восстанавливает server session.
3. Победа и поражение.
4. Hint на 5 и 8 checkpoint.
5. Каждый из шести режимов стартует.
6. Movie/series/anime period unlock.
7. Недостаточно билетов.
8. Free play списывает один раз.
9. Promo redeem не повторяется сверх лимита.
10. Регистрация связывает guest progress.
11. Login на другом browser context видит progress.
12. Logout закрывает приватные данные.
13. Legacy import.
14. Archive session.
15. API timeout/retry не дублирует attempt/reward.
16. Основные mobile viewports без visual regression.

### 24.6. Production smoke

Smoke не должен портить публичную статистику. Использовать специального service user и test challenge либо rollback transaction там, где возможно.

---

## 25. Этапы реализации

Каждый этап — отдельная проверяемая группа commits. Следующий начинается после зелёных тестов предыдущего.

### Этап 0. Baseline и страховка

- [ ] Зафиксировать production data/media manifest.
- [ ] Получить music dataset 409 items.
- [ ] Создать characterization fixtures.
- [ ] Запустить текущие `typecheck`, `build`, `data:validate`, `smoke`.
- [ ] Добавить Playwright baseline ключевых сценариев.
- [ ] Зафиксировать screenshots/mobile layout.

### Этап 1. Workspace и game-core

- [ ] Настроить npm workspaces и TypeScript references.
- [ ] Перенести frontend без визуальных изменений.
- [ ] Извлечь `game-core` под characterization tests.
- [ ] Сохранить Yandex build.

### Этап 2. Database и importer

- [ ] Compose development PostgreSQL.
- [ ] Drizzle schema/migrations.
- [ ] Import dry-run/apply/activate/export.
- [ ] Импорт шести modes.
- [ ] Проверка counts/checksums.
- [ ] Materialize challenges.

### Этап 3. API foundation

- [ ] Config validation.
- [ ] Fastify plugins/logging/error envelope.
- [ ] Health/meta/OpenAPI.
- [ ] Content search.
- [ ] Dockerfile.

### Этап 4. Server game

- [ ] start/resume/search-in-session;
- [ ] attempt;
- [ ] hints;
- [ ] archive;
- [ ] diagnosis/music special cases;
- [ ] answer leakage/security tests.

### Этап 5. Auth и frontend integration

- [ ] Better Auth migrations;
- [ ] anonymous account;
- [ ] email/password/verification/reset;
- [ ] profile/link/merge;
- [ ] TanStack Query/API client;
- [ ] убрать trusted game state из localStorage;
- [ ] сохранить текущий UX.

### Этап 6. Economy и migration

- [ ] stats/attendance;
- [ ] wallet ledger;
- [ ] period unlock;
- [ ] free play;
- [ ] promos;
- [ ] legacy import;
- [ ] admin salt/review.

### Этап 7. Timeweb staging

- [ ] Новый server layout рядом с текущим production.
- [ ] PostgreSQL/API containers.
- [ ] Media migration.
- [ ] Nginx `/api` и `/media`.
- [ ] Backup/restore.
- [ ] Deploy workflow.
- [ ] Staging smoke через отдельный host/path.

### Этап 8. Cutover

- [ ] Финальный backup.
- [ ] Maintenance/read-only window при необходимости.
- [ ] Финальный content import.
- [ ] Deploy API.
- [ ] Переключить web release.
- [ ] Наблюдать logs/metrics минимум 60 минут.
- [ ] Проверить auth/game/economy/media/mobile.
- [ ] Сохранить старый статический release для rollback.

### Этап 9. После стабилизации

- [ ] Удалить runtime JSON fallback.
- [ ] Выключить legacy import после deadline.
- [ ] Удалить client admin globals/promo constants.
- [ ] Обновить старые docs.
- [ ] Провести restore drill.

---

## 26. Критерии приёмки

Работа считается завершённой только при выполнении всех обязательных критериев.

### 26.1. Данные

- [ ] В active revision присутствуют 4 586 исходных записей либо больше после явно утверждённого обновления.
- [ ] Все шесть modes имеют ненулевой pool.
- [ ] IDs сохранены.
- [ ] Runtime сайта не запрашивает catalog JSON.
- [ ] Export active revision проходит semantic comparison.
- [ ] Архивная загадка не меняется после активации новой revision.

### 26.2. Игра

- [ ] Ответ отсутствует на клиенте до завершения.
- [ ] Все попытки валидирует API.
- [ ] Duplicate guess невозможен.
- [ ] Максимум 10 попыток обеспечен DB/API.
- [ ] Hint checkpoints работают.
- [ ] Все шесть режимов повторяют текущую логику.
- [ ] Daily answer одинаков для всех пользователей одной комбинации.
- [ ] Server Moscow date определяет daily.
- [ ] Reload/device resume работает.

### 26.3. Аккаунты

- [ ] Guest может играть без формы регистрации.
- [ ] Guest progress привязывается к email account.
- [ ] Verification и password reset работают.
- [ ] Session cookie HttpOnly/Secure.
- [ ] Logout и logout-all работают.
- [ ] Admin endpoint недоступен player.

### 26.4. Экономика

- [ ] Изменение localStorage не влияет на server wallet.
- [ ] Reward начисляется один раз при concurrent/retry запросах.
- [ ] Unlock/free play/promo транзакционны.
- [ ] Ledger сходится с balance.
- [ ] Destructive promo отсутствует.

### 26.5. Media и UI

- [ ] Изображения отдаются текущим VPS через `/media`.
- [ ] Missing image имеет UI fallback.
- [ ] Media cache headers корректны.
- [ ] Главный desktop/mobile UI визуально не регрессировал.
- [ ] Яндекс build продолжает собираться.

### 26.6. Operations

- [ ] `docker compose up -d` воспроизводим по инструкции.
- [ ] DB volume переживает redeploy.
- [ ] `/health/live` и `/health/ready` корректны.
- [ ] Atomic deploy и rollback проверены.
- [ ] Daily backup создан.
- [ ] Restore из backup проверен.
- [ ] PostgreSQL не имеет public port.
- [ ] Никаких secrets в Git/history/build artifacts.
- [ ] Production работает только через HTTPS для stateful функций.

### 26.7. Quality gates

- [ ] `npm ci`;
- [ ] `npm run lint`;
- [ ] `npm run typecheck`;
- [ ] `npm test`;
- [ ] `npm run test:integration`;
- [ ] `npm run test:e2e`;
- [ ] `npm run build`;
- [ ] `npm run build:api`;
- [ ] `npm run data:validate`;
- [ ] `npm run content:import -- --dry-run`;
- [ ] Docker image build;
- [ ] load test baseline без нарушения SLO.

---

## 27. Итоговые deliverables

Исполнитель должен передать:

1. Исходный код frontend/API/packages.
2. `package-lock.json` с pinned compatible dependencies.
3. Все Drizzle migrations.
4. Import/export/validation scripts.
5. Dockerfiles и Compose для dev/production.
6. Nginx template/diff.
7. GitHub Actions CI и atomic deploy workflow.
8. Backup и restore scripts.
9. `.env.example` без secrets.
10. OpenAPI spec.
11. Unit/integration/E2E/load tests.
12. `docs/backend/ARCHITECTURE.md`.
13. `docs/backend/DATABASE.md` с ERD и constraints.
14. `docs/backend/API.md`.
15. `docs/backend/DEPLOY_TIMEWEB.md`.
16. `docs/backend/BACKUP_RESTORE.md`.
17. `docs/backend/CONTENT_IMPORT.md`.
18. `docs/backend/SECURITY.md`.
19. `docs/backend/ROLLBACK.md`.
20. Migration report с counts/checksums/warnings.
21. Acceptance report со списком команд и результатами.

---

## 28. Специальные инструкции исполнителю Codex 5.3

1. Начать с чтения этого ТЗ, `README.md`, `src/game.ts`, `src/storage.ts`, `src/hooks/use-data-loader.ts`, `src/types.ts`, deployment workflows и data scripts.
2. Создать ветку `feat/server-postgres-auth`; прямые изменения `main` не выполнять.
3. Перед изменениями проверить dirty worktree и сохранить пользовательские изменения.
4. Не удалять существующие datasets, scripts и static deploy до успешного cutover.
5. Не выполнять массовый визуальный рефакторинг.
6. Не менять игровые правила без characterization test и documented rules version.
7. Не доверять значениям wallet/stats/role/answer/date из клиента.
8. Не возвращать answer до terminal status.
9. Каждую mutation проектировать с idempotency и concurrency test.
10. Каждую DB migration проверять с пустой БД и upgrade с предыдущего состояния.
11. Использовать `apply_patch` для ручных правок; форматтер допустим для механических изменений.
12. После каждого этапа обновлять implementation checklist и запускать соответствующие quality gates.
13. Не подключаться к production и не менять Nginx/DB без явного разрешения владельца на deploy-этап.
14. Если не предоставлены SMTP/admin secrets, полностью реализовать и протестировать через dev mail catcher; production activation пометить как внешний blocker.
15. Если production media/music snapshot отличается от зафиксированного baseline, остановить cutover и выдать diff-report.
16. Любой упрощённый fallback должен быть явно помечен и не может ослаблять server authority.
17. Финальный PR должен быть reviewable: логические commits, migration notes, screenshots для UI-изменений, тестовый отчёт.

---

## 29. Внешние данные, которые понадобятся владельцу перед production-активацией

Реализация в коде может быть завершена заранее. Для запуска потребуются:

- SMTP host/port/user/password/from;
- email владельца для initial admin;
- подтверждение лимита legacy wallet import, default 500;
- подтверждение deadline legacy import;
- доступ deploy user к серверу;
- включённый Timeweb backup/snapshot либо альтернативная off-host копия;
- окончательный production music/media snapshot;
- новые `BETTER_AUTH_SECRET`, DB password и promo pepper.

Secrets должны генерироваться заново и не пересылаться в issue/PR/log.

---

## 30. Справочные ссылки

- Репозиторий: https://github.com/SaborataRekaReka/shoditsa
- Fastify validation/serialization: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Better Auth Fastify integration: https://better-auth.com/docs/integrations/fastify
- Better Auth anonymous plugin: https://better-auth.com/docs/plugins/anonymous
- Drizzle migrations: https://orm.drizzle.team/docs/migrations
- PostgreSQL JSON types: https://www.postgresql.org/docs/current/datatype-json.html
- PostgreSQL trigram extension: https://www.postgresql.org/docs/current/pgtrgm.html
- Node.js release status: https://nodejs.org/en/about/previous-releases
- Yandex Games Player/server verification: https://yandex.ru/dev/games/doc/ru/sdk/sdk-player
- Timeweb Cloud docs: https://timeweb.cloud/docs

---

## 31. Финальная Definition of Done

Новая версия считается готовой к основному трафику, когда пользователь открывает `https://shoditsa.ru`, начинает игру без регистрации, делает подтверждённые сервером попытки, завершает сеанс, получает транзакционно начисленные билеты, регистрируется, видит тот же прогресс после входа на другом устройстве, а правильный ответ до завершения отсутствует в браузере. Перезапуск контейнеров и новый deploy не теряют аккаунты, сессии, базу или изображения. Последний backup успешно восстанавливается в отдельную тестовую БД. Предыдущий frontend/API release можно вернуть документированной rollback-процедурой.
