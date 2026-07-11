# Агентное обогащение данных

## Задача

Процесс обогащает сущности по одной, помнит результат каждого шага и безопасно продолжается после остановки. Музыка — первый адаптер; общее ядро не зависит от музыкальной схемы и рассчитано на последующие библиотеки. Доверенный источник по умолчанию — текущая production-библиотека `items.json`.

Основной принцип качества и цены: один AI-вызов на discovery-партию, затем структурированные API и один AI-вызов на нового артиста для fact-check и подсказки. Production-файлы не меняются во время поиска.

## Быстрый старт

Посмотреть доверенный production baseline:

```powershell
npm run data:agent:music:plan
npm run data:agent:music:status
```

Полный цикл на пяти новых исполнителях:

```powershell
npm run data:agent:music -- --max-items=5
```

Команда сначала запускает discovery-агента: он ищет артистов в интернете, исключает уже известные имена и сохраняет кандидатов минимум с двумя URL источников. Затем для каждого кандидата собираются API-данные, выполняется AI fact-check и создаётся игровая подсказка. Результаты остаются в staging до отдельной публикации.

Запустить этапы отдельно:

```powershell
npm run data:agent:music:discover -- --max-items=5
node scripts/enrichment-agent/run.mjs music run --source=data/enrichment-agent/music/discovery/discovered-candidates.json --max-items=5 --max-ai-reviews=5
```

Процесс автоматически импортирует текущий production baseline из 409 карточек. Legacy-файл `music_artists_merged_dedup.json` содержит 1925 имён, но не имеет сохранённого происхождения и не используется по умолчанию. Его можно исследовать только явно, в отдельном scope:

```powershell
node scripts/enrichment-agent/run.mjs music plan --source=archive/local/music-pipeline/source/music_artists_merged_dedup.json
```

## Источники и ключи

Без настройки используются MusicBrainz, Wikidata и demo-доступ TheAudioDB. Дополнительное покрытие дают:

```powershell
$env:LASTFM_API_KEY="..."
$env:SPOTIFY_CLIENT_ID="..."
$env:SPOTIFY_CLIENT_SECRET="..."
$env:THEAUDIODB_API_KEY="..." # необязательно, вместо demo-доступа
$env:OPENAI_API_KEY="..."     # обязателен для поиска и генерации новых подсказок
```

Секреты можно установить в PowerShell или сохранить в `.env.local`; файл уже исключён из Git. Они читаются только Node-процессом и не записываются в output. Ответы источников сохраняются в `data/music/raw`, нормализованные результаты — в `data/music/normalized`.

## Профили стоимости

Metadata-only для заранее известного списка, без ИИ и без автопринятия:

```powershell
node scripts/enrichment-agent/run.mjs music run --source=path/to/candidates.json --max-items=20 --ai=never
```

Рекомендуемый: API для фактов, затем один вызов `gpt-5-mini` с веб-поиском для fact-check и подсказки каждой новой записи:

```powershell
npm run data:agent:music -- --max-items=10 --ai=auto --max-ai-reviews=10
```

Без AI web search на этапе обработки кандидатов, но с проверкой переданного API evidence; подсказка в этом режиме не считается исследованной в интернете:

```powershell
node scripts/enrichment-agent/run.mjs music run --source=data/enrichment-agent/music/discovery/discovered-candidates.json --max-items=10 --max-ai-reviews=10 --no-ai-web-search
```

Полная перепроверка записей из очереди review:

```powershell
node scripts/enrichment-agent/run.mjs music run --source=data/enrichment-agent/music/discovery/discovered-candidates.json --retry-review --max-items=5 --ai=always
```

## Память и восстановление

Состояние разделено по источникам: production находится в `data/enrichment-agent/music/production`, найденные кандидаты — в отдельном scope внутри `data/enrichment-agent/music/`. Отдельные результаты хранятся в `records/`, история запусков — в `runs/`. Каталог `data/` исключён из Git и должен входить в локальный или серверный backup.

Перед обработкой сущность получает `running`, сразу после неё — `completed`, `review` или `failed`. Запись state выполняется через временный файл. После аварийной остановки зависшие `running` автоматически возвращаются в `pending`. Ошибки повторяются с экспоненциальной задержкой, до четырёх попыток по умолчанию.

Изменение исходной seed-записи меняет SHA-256 fingerprint и автоматически возвращает только эту сущность в очередь. Принятые записи планово освежаются раз в 90 дней; период задаётся через `--refresh-days=N`, значение `0` отключает refresh.

Одновременный запуск двух процессов блокируется `run.lock`.

## Контроль качества и публикация

Запись принимается автоматически, если минимум два источника успешны, есть идентичность и топ-треки, отсутствуют критические конфликты, match confidence не ниже `0.75`, а AI-подсказка прошла проверку. Агент ищет отличительный факт в интернете, возвращает URL источников и пишет русскую подсказку длиной 80-280 символов. Валидатор запрещает имя исполнителя, алиасы, названия треков и альбомов. Иначе запись получает `review`; ИИ не заполняет факты без evidence.

Пересобрать staging aggregate из отдельных records:

```powershell
node scripts/enrichment-agent/run.mjs music rebuild --source=data/enrichment-agent/music/discovery/discovered-candidates.json
```

В aggregate попадают только записи с disposition `accepted`. Публикация использует существующий конвертер и обновляет `music.generated.json`, `items.json`, `search-index.json` и `source.json`:

```powershell
npm run data:agent:music:publish
npm run data:audit:music
npm run data:validate
```

`publish` запускается отдельно и никогда не вызывается автоматически после сетевого batch. Публикация работает в merge-режиме: существующие production-карточки сохраняются без перезаписи, добавляются только новые принятые ID. Это не даёт спорной или оборванной партии уменьшить или испортить рабочую библиотеку.

## Новый домен

Для фильмов, игр или диагнозов нужен модуль `scripts/enrichment-agent/adapters/<domain>.mjs`, экспортирующий `<domain>Adapter` с методами:

- `loadItems` — загрузить seed;
- `entityKey` и `fingerprintInput` — задать стабильную идентичность;
- `process` — собрать evidence, нормализовать и оценить одну сущность;
- `buildAggregate` — собрать принятые records в staging;
- `bootstrap` — необязательно, импортировать существующую базу в state.

После этого общий CLI получает домен без изменений ядра:

```powershell
node scripts/enrichment-agent/run.mjs games plan
node scripts/enrichment-agent/run.mjs games run --max-items=10
```
