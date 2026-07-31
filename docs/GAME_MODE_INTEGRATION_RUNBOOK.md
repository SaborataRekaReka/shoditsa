# Runbook: интеграция игры «угадай по признакам» до production

Этот документ — исполнимая инструкция для ИИ-агента. Цель задачи «интегрировать игру под ключ» — не локальный экран, а новая игра на https://shoditsa.ru, в которую пользователь может без ошибок сыграть от титульного экрана до результата.

## Содержание

1. [Контракт результата](#1-контракт-результата)
2. [Паспорт режима](#2-паспорт-режима)
3. [Стратегия без пустого production-режима](#3-стратегия-без-пустого-production-режима)
4. [Данные и медиа](#4-данные-и-медиа)
5. [Подключение к архитектуре](#5-подключение-к-архитектуре)
6. [Автоматические gates](#6-автоматические-gates)
7. [UX и тексты через браузер](#7-ux-и-тексты-через-браузер)
8. [Релиз, ревизия контента и production](#8-релиз-ревизия-контента-и-production)
9. [Definition of Done](#9-definition-of-done)
10. [Диагностика типовых блокеров](#10-диагностика-типовых-блокеров)
11. [Формат финального отчёта](#11-формат-финального-отчёта)

## 1. Контракт результата

Агент обязан:

- переиспользовать движок catalog_guess, общий shell, серверную сессию, экономику, архив, статистику и шаринг;
- провести данные через source → generated dataset → public library → API release-content → active DB revision;
- реализовать поиск, сравнение, подсказки, карточку попытки, результат, повторную игру и админ-просмотр;
- написать SEO-страницу и естественные русские UX-тексты;
- проверить интерфейс в браузере и исправлять найденное итерациями;
- при явном запросе «под ключ / в production» выполнить полный релиз и закончить только после реальной игры на production.

Не считать задачу завершённой после npm run build, появления маршрута или загрузки JSON в репозиторий.

Нельзя:

- делать отдельный игровой экран, router или localStorage-формат для нового режима;
- выбирать или отдавать правильный ответ клиенту до завершения серверной сессии;
- публиковать public/data/libraries/**/items.json в hosted web bundle;
- включать режим в PLAYABLE_MODE_IDS до появления его карточек в active revision;
- выпускать новый режим только через scripts/deploy/timeweb.ps1: этот скрипт обновляет web, но не API-образ, миграции и release-content;
- заменять основную фотографию силуэтом: posterUrl и clue-media всегда отдельны.

## 2. Паспорт режима

До кода агент фиксирует в рабочем плане короткий паспорт:

| Поле | Что определить |
| --- | --- |
| modeId | стабильный английский ID в единственном числе |
| dataDir | каталог public/data/libraries/<dataDir> |
| Сущность | что именно угадывает игрок; без смешения уровней детализации |
| Основной запрос | русская формулировка: «угадай …» |
| Размер запуска | точное число карточек и минимальное число playable-карточек |
| Пул | массовый / тематический / варианты / сложность |
| Попытки | обычно общий контракт на 10 попыток |
| Критерии | 6–11 полезных сравнительных признаков |
| Подсказки | текст, факт, изображение, силуэт, звук или другой отдельный clue |
| Медиа | основная фотография, декоративная обложка, clue-media, лицензии |
| SEO | H1, title, description, синонимы запроса и интент |

Для каждого критерия записать:

| Поле | Тип | Нормализация | Сравнение | Поведение без данных | Источник |
| --- | --- | --- | --- | --- | --- |
| пример | scalar / list / number | контролируемый словарь или единицы | match / partial / close / up-down | скрыть критерий или unknown | URL/API/dataset |

Правила качества критериев:

- scalar: одинаковые нормализованные значения дают match;
- list: полное совпадение — match, пересечение — partial, без пересечения — miss;
- number: заранее определить допуск match/close и направление;
- self-compare каждой playable-карточки обязан возвращать только match и direction: null;
- отсутствующее значение ответа не должно создавать бесполезную плитку;
- единицы, словари и русские подписи должны быть единообразны на всём пуле.

Сначала собрать вертикальный срез на 10–20 карточках и сыграть его локально. После фиксации схемы масштабировать ETL до полного пула. Источники и генерация изображений могут идти параллельно, но контракт имён файлов и полей фиксируется в паспорте сразу.

## 3. Стратегия без пустого production-режима

Для совершенно нового modeId использовать двухфазный rollout.

### Фаза A — data-first, режим скрыт

1. Добавить modeId в CONTENT_MODE_IDS, GAME_MODE_MANIFEST, типы, DB migration, core/API/UI registries и SEO-контент.
2. Не добавлять его в PLAYABLE_MODE_IDS.
3. Положить непустую проверенную библиотеку в public/data/libraries/<dataDir>/items.json.
4. Собрать API Docker image и доказать, что файл присутствует внутри /app/release-content/libraries/<dataDir>/items.json.
5. Выпустить полный SHA-релиз через .github/workflows/deploy-timeweb.yml.
6. В админке собрать безопасное наложение release-content, активировать ревизию и проверить count режима в /api/v1/meta.

Режим ещё не виден игрокам, поэтому production smoke не требует его count и не возникает состояния «пункт есть, карточек нет».

### Фаза B — включение

1. Добавить modeId в PLAYABLE_MODE_IDS.
2. Запустить полный набор тестов и второй полный SHA-релиз.
3. Production smoke теперь обязан увидеть положительный count, SEO route и одинаковый SHA web/API.
4. Пройти реальную игровую сессию в браузере.

Для расширения уже активного режима можно использовать один релиз, но изменение карточек всё равно нужно включить в новую active revision.

## 4. Данные и медиа

### 4.1 Минимальная runtime-карточка

Каждая карточка должна иметь:

~~~json
{
  "id": "<mode>:<stable-id>",
  "mode": "<mode>",
  "titleRu": "Название",
  "titleOriginal": "Original or scientific name",
  "alternativeTitles": [],
  "popularityScore": 0,
  "allowedInGame": true,
  "contentStatus": "ready",
  "posterUrl": "https://... или /media/...",
  "plotHint": "Подсказка без ответа"
}
~~~

Добавить поля критериев и clue-media из паспорта. Названия, оригиналы, алиасы и accepted answers должны искать одну canonical identity. Не смешивать вид/род, игру/издание, заболевание/симптомокомплекс и другие разные сущности без явной продуктовой причины.

### 4.2 ETL

Pipeline обязан быть:

- возобновляемым, с cache/checkpoint, а не монолитным одноразовым скриптом;
- идемпотентным: повторный запуск не меняет стабильные ID;
- provenance-first: сохранять источник, URL, дату получения, метод, confidence и лицензию;
- разделённым на discovery, enrichment, normalization, selection, materialization и audit;
- безопасным к rate limits и частичной недоступности источников;
- способным построить одну карточку для отладки и весь batch для релиза.

Хранить:

- полную source-модель в data/<domain>/generated;
- редакционные seeds/overrides отдельно от автоматически полученных значений;
- runtime-проекцию только в public/data/libraries/<dataDir>/items.json;
- manifests и review queue рядом с domain data;
- media assets с непрозрачными content-addressed именами.

### 4.3 Отбор пула

Определить до сбора полного batch:

- целевое распределение узнаваемости и сложности;
- квоты по важным классам/жанрам;
- лимиты близких дублей, одной франшизы/семьи/рода;
- минимальное покрытие критериев;
- обязательную основную фотографию;
- критерии ready, review, blocked;
- резерв 20–40% кандидатов на плохие лицензии и слабые данные.

Ручной review обязателен для названий, identity, двусмысленных алиасов, лицензии основной фотографии и фактов, которые могут раскрыть ответ.

### 4.4 Медиа

- posterUrl — фотография/основное изображение карточки.
- silhouetteUrl, soundUrl, map или иной clue — отдельные поля; они не заменяют фотографию.
- Каждый clue имеет attribution с source URL, author, license и license URL.
- При отсутствии настоящего лицензированного звука или другого clue поле остаётся пустым; не подставлять выдуманный контент.
- Админка должна позволять увидеть фотографию, clue-media и прослушать звук до публикации.
- Локальные runtime assets проверяются на HTTP 200 и корректный MIME type.

## 5. Подключение к архитектуре

Использовать [стандарт режима](refactor/GAME_MODE_STANDARD.md) и пройти весь список.

### Contracts и DB

- packages/contracts/src/game-modes.ts: CONTENT_MODE_IDS, manifest, capabilities; PLAYABLE_MODE_IDS только в фазе B.
- packages/contracts/src/legacy-types.ts: поля карточки и связанные контракты.
- packages/contracts/src/schemas.ts: проверить API unions/schemas.
- packages/database/src/schema.ts: enum строится из canonical IDs.
- packages/database/migrations/: отдельный ALTER TYPE ... ADD VALUE IF NOT EXISTS.

### Core

- packages/game-core/src/index.ts: pool policy и compare-функция в GAME_MODE_RULES.
- Поиск должен учитывать titleRu, titleOriginal, alternativeTitles, алиасы и нормализацию е/ё, пунктуации и пробелов.
- Добавить unit-тесты конкретных сравнений.
- Общие invariants в packages/game-core/test/game-core.invariants.test.ts должны автоматически охватить режим.
- Добавить regression fixture: точный размер библиотеки и 2–3 характерные пары.

### API

- apps/api/src/modules/games/service.ts: info hints, clue options, redaction/public payload и eligibility.
- Проверить daily, archive, free play, replay за билеты и friends room, если capability применима.
- Ответ не должен утекать через start/search/hint payload.
- scripts/content/lib.ts и apps/api/src/modules/admin/release-content-loader.ts получают библиотеку из manifest; новый каталог обязан существовать до сборки image.

### Web

- apps/web/src/app/mode-config.ts: русские формы, placeholder и dataDir.
- apps/web/src/app/mode-presentation.ts: icon, цвет, watermark, description, empty hint.
- Использовать общий title screen и ATTEMPT_CARD_BY_MODE; отдельный renderer делать только для реально нового набора плиток.
- Проверить header/hub/daily order/archive/profile/full-house/free-play/result/share.
- Все mode-specific списки находить через rg, не полагаться только на TypeScript exhaustiveness.

### Админка

- добавить label режима, schema groups, normalization fields и preview fields;
- показывать число карточек, playable status и completeness;
- дать просмотреть основное изображение и все clue-media;
- для звука использовать встроенный audio controls, без autoplay;
- открыть несколько карточек подряд в preview и проверить контент вручную.

### SEO и инфраструктура

- apps/web/src/app/seo-content.ts: title, description, H1, intro, FAQ/досье, canonical path;
- генератор static pages, sitemap и structured data должен включить /games/<mode>;
- обновить Nginx allowlist маршрутов и scripts/diagnostics/validate-app-shell.mjs, если route regex перечисляет режимы явно;
- добавить отдельный brand/token только при необходимости; не копировать весь CSS режима;
- проверить 200, canonical, index,follow, H1, JSON-LD и отсутствие ответа в HTML.

### Аналитика

Общие события уже получают mode. Проверить в коде и в админ-событиях:

- select_mode, start_session, submit_attempt;
- open_hint_modal, reveal_hint;
- game_won / game_lost;
- start_free_play, ticket spend/earn;
- share и content report;
- api_error и client error без нового всплеска.

## 6. Автоматические gates

### 6.1 Проверка карточек до сборки

Запустить новый deterministic preflight, подставив поля режима:

~~~powershell
node scripts/diagnostics/verify-game-mode-release.mjs --mode=animal --data-dir=animals --expected=300 --min-playable=300 --criteria=taxonomicClass,animalOrder,animalFamily,bodyCoverings,habitats,animalContinents,diets,locomotion,reproduction,bodyMassKg,legCount --min-criteria=6 --require-poster
~~~

Команда проверяет count, playable count, базовые поля, ID, алиасы, изображения и минимальное покрытие критериев. Alias collisions печатаются для review; после редакционной чистки запустить ещё раз с --strict-aliases.

### 6.2 Общие проверки

~~~powershell
npm run content:import -- --dry-run
npm run data:validate
npm run lint
npm test
npm run test:integration
npm run build
npm run build:api
~~~

Проверить, что dist/data отсутствует: hosted web не должен содержать answer library.

### 6.3 Доказательство release-content внутри API image

~~~powershell
docker build --build-arg GIT_SHA=mode-preflight -f infra/docker/Dockerfile.api -t shoditsa-api:mode-preflight .
docker run --rm shoditsa-api:mode-preflight node scripts/diagnostics/verify-game-mode-release.mjs --mode=animal --data-dir=animals --source=/app/release-content/libraries --expected=300 --min-playable=300 --criteria=taxonomicClass,animalOrder,animalFamily,bodyCoverings,habitats,animalContinents,diets,locomotion,reproduction,bodyMassKg,legCount --min-criteria=6 --require-poster
~~~

Если второй запуск не проходит, релиз запрещён: именно этот gate предотвращает ситуацию «в репозитории карточки есть, в release их нет».

### 6.4 Локальный E2E

На чистой тестовой БД:

1. применить migration;
2. импортировать library и активировать revision;
3. запустить API/web/worker;
4. проверить meta count;
5. сыграть daily и free play;
6. запустить npm run test:e2e либо узкий Playwright spec нового режима.

## 7. UX и тексты через браузер

Браузерная проверка — обязательная часть реализации, а не демонстрация после неё.

### Локальная итерация

Использовать доступный browser-control skill и пройти:

1. Главная: карточка режима понятна без контекста.
2. /games/<mode>: заголовок, дата, описание и CTA помещаются на desktop/mobile.
3. Старт: сервер возвращает сессию без 4xx/5xx.
4. Поиск: русское, оригинальное, алиас, е/ё, опечатка, отсутствие дубля.
5. Попытка: плитки имеют ясные подписи, корректные цвета, partial и стрелки.
6. Пустые поля: нет undefined, пустых плиток и технических кодов.
7. Подсказки: блокировка/стоимость, текст, clue-media, attribution.
8. Победа и поражение: правильный ответ, число попыток, share и следующая игра.
9. Повторная игра: билет списывается один раз, повторный клик идемпотентен.
10. Reload/back/archive: прогресс не теряется.
11. Админка: карточка, media и последовательный preview.

Для текстов отдельно проверить:

- естественные падежи и отсутствие кальки;
- одинаковое название сущности на hub/title/input/result;
- короткие labels плиток и понятные пояснения;
- SEO-запрос используется естественно, без переспама;
- подсказка не называет ответ и не содержит его алиас;
- ошибки говорят игроку, что делать дальше.

После каждого найденного дефекта: исправить код/данные, прогнать узкие тесты, пересобрать, снова открыть тот же шаг. Минимум одна итерация должна включать desktop и viewport около 390 px.

### Production UX gate

После финального релиза повторить критический путь уже на https://shoditsa.ru:

- открыть игру с главной;
- начать реальную сессию;
- найти и отправить вариант;
- открыть доступную подсказку;
- завершить или безопасно проверить terminal flow тестовой/admin-сессией;
- проверить повторную игру, архив и админ-карточку;
- убедиться, что console/network не содержит новых ошибок.

Локальная проверка не заменяет production gate.

## 8. Релиз, ревизия контента и production

### Полный релиз

Новый режим меняет web, API, contracts, DB и content. Использовать только SHA-релиз из .github/workflows/deploy-timeweb.yml, который:

- запускает тесты;
- собирает matching web/API;
- применяет migrations;
- запускает API и worker на одном SHA;
- делает backup, health checks и external smoke.

scripts/deploy/timeweb.ps1 допустим для изолированной web-правки уже работающего режима, но не для первого запуска режима или изменения API/content.

### Активация контента в фазе A

В авторизованной админке:

1. открыть dashboard и блок безопасного наложения release;
2. проверить release count нового режима и отсутствие mode conflicts/count drops;
3. запустить проверку и сборку release revision;
4. дождаться background job;
5. активировать готовую revision;
6. при необходимости materialize archive/future days;
7. запросить /api/v1/meta и доказать положительный count.

Не включать режим публично, пока этот count равен нулю.

### Финальная проверка фазы B

~~~powershell
$env:EXPECTED_SHA = "<deployed-commit-sha>"
$env:PRODUCTION_URL = "https://shoditsa.ru"
npm run smoke:production
~~~

Дополнительно сверить:

- build-manifest.json.commitSha == /api/v1/meta.buildSha;
- playableModes содержит новый mode;
- meta.modes[mode].count равен ожидаемому playable count и больше нуля;
- /games/<mode> отвечает 200 и индексируется;
- приватный items.json отвечает 404;
- API и worker используют один image tag;
- active revision содержит новый mode;
- production browser flow пройден.

## 9. Definition of Done

| Область | Блокирующий результат |
| --- | --- |
| Product | паспорт утверждён реализацией, сущности и критерии однозначны |
| Data | точный target count, playable count, audit без blockers |
| Search | русское/оригинальное/алиасы работают, неоднозначности reviewed |
| Compare | self-compare invariant и характерные пары покрыты тестами |
| Media | основная фотография не заменена clue; лицензии сохранены |
| API | серверная daily/free-play session стартует, ответ не утекает |
| UI | title → attempt → hint → result → replay проходит |
| Admin | карточки видны, media просматриваются/прослушиваются |
| SEO | 200, canonical, indexable, H1, JSON-LD, sitemap |
| Release | библиотека доказана внутри API image |
| DB | active revision содержит положительный count режима |
| Production | web/API SHA совпадают, smoke зелёный |
| UX | production-путь проверен браузером на desktop и mobile |

Если хотя бы одна строка не выполнена, агент сообщает конкретный blocker и продолжает безопасную работу; он не пишет «готово».

## 10. Диагностика типовых блокеров

| Симптом | Вероятная причина | Проверка/исправление |
| --- | --- | --- |
| Режим виден, вариантов нет | mode включён раньше active content | выключить из playable или активировать data-first revision |
| В репозитории 300, в release 0 | использован web-only deploy или API image без library | Docker release-content gate |
| /api/v1/meta не знает режим | старый API SHA или manifest | сверить SHA и GAME_MODE_MANIFEST |
| Start даёт CONTENT_NOT_READY | нет active revision | build/activate revision |
| Start даёт пустой pool | allowedInGame, status или eligibility | dry-run и playable count |
| Поиск ничего не находит | aliases не импортированы или revision старая | проверить content aliases и active revision |
| UI новый, API старый | частичный deploy | полный SHA-релиз web+API |
| SEO route 404 после refresh | Nginx allowlist не обновлён | route config + validate shell |
| Фото есть, clue 404 | asset не materialized/deployed или URL не разрешён | HTTP/MIME и immutable media route |
| Силуэт вместо фото | перепутаны posterUrl и clue field | вернуть фото в poster, silhouette оставить отдельным |
| Плитки unknown у большинства | слабое покрытие/разные словари | coverage report и повторная нормализация |
| Повторный запуск списывает дважды | нет idempotency/replay test | проверить request key и economy ledger |
| Локально хорошо, prod сломан | cache/SHA/revision mismatch | production smoke + browser gate |

## 11. Формат финального отчёта

Агент завершает задачу коротким доказательным отчётом:

~~~text
Production URL:
Web/API SHA:
Active content revision:
Mode/count/playable:
Пройденный browser flow:
Desktop/mobile:
Автотесты:
SEO smoke:
Rollback point:
Оставшиеся только неблокирующие улучшения:
~~~

Не перечислять как «оставшееся» то, без чего пользователь не может открыть и сыграть игру.
