# Сеанс

Ежедневная браузерная игра: угадайте фильм или сериал за 10 попыток. После каждой попытки игра сравнивает год, страну, жанры, создателей, актёров, рейтинги, хронометраж, возраст и популярность.

## Запуск

```powershell
npm install
npm run dev
```

Vite откроет приложение на `http://localhost:5173`.

Проверка production-сборки:

```powershell
npm run build
npm run preview
```

Базовая валидация перед и после рефакторинга:

```powershell
npm run data:validate
npm run metrics:baseline
npm run smoke
```

## Быстрый деплой на сервер

Если нужно доставлять правки быстрее, чем через цикл commit -> GitHub Actions,
используйте локальный прямой деплой:

```powershell
npm run deploy:quick
```

Команда соберет `dist`, загрузит файлы на `72.56.240.222:/opt/repeto/deploy/shoditsa`
и выставит права чтения.

Если `dist` уже собран и нужно только залить изменения:

```powershell
npm run deploy:quick:skip-build
```

## Глобальная смена ежедневного ответа (для всех)

Сдвиг для всех игроков задается в `public/data/daily-config.json` (`globalSalt`).

Быстро обновить значение:

```powershell
npm run daily:salt -- 1
```

После изменения `globalSalt` выполните сборку и деплой, чтобы значение применилось у всех пользователей:

```powershell
npm run build
npm run deploy:quick:skip-build
```

## Что работает

- режимы «Фильм дня», «Сериал дня» и «Аниме дня»;
- 7 временных периодов;
- стабильный тайтл дня по московской дате;
- поиск по русскому, оригинальному и альтернативным названиям, `е/ё` и базовым опечаткам;
- 10 сравнительных подсказок после каждой попытки;
- победа и поражение, шаринг результата без спойлера;
- отдельный прогресс каждой комбинации даты, режима и периода;
- статистика и архив в `localStorage`;
- адаптивный mobile-first интерфейс.

## Данные

Готовая сборка не обращается к стороннему API: она читает локальные файлы из `public/data`.

Сейчас включены:

- 500 фильмов из списка [500 лучших фильмов Кинопоиска](https://www.kinopoisk.ru/lists/movies/top500/) по фиксированным ID в `data/top500-ids.json`;
- 40 сериалов из `TOP_250_TV_SHOWS`.
- 500 аниме из [Shikimori Popularity](https://shikimori.io/animes?order=popularity) в последовательном порядке.

Для обновления данных создайте `.env.local`:

```dotenv
KINOPOISK_API_KEY=your_key_here
```

Затем выполните:

```powershell
npm run data:build
```

### Каталогизированная JSON-структура и search-index

Чтобы разложить библиотеки по каталогам и построить индексы быстрого поиска:

```powershell
npm run data:catalogs
```

Скрипт создаёт структуру:

- `public/data/libraries/index.json` — общий каталог библиотек;
- `public/data/libraries/movies/items.json` + `search-index.json`;
- `public/data/libraries/series/items.json` + `search-index.json`;
- `public/data/libraries/animes/items.json` + `search-index.json`;
- `public/data/libraries/games/items.json` + `search-index.json`;
- `public/data/libraries/diagnoses/items.json` + `search-index.json` + `case-vignettes.by-id.json`.

Текущие файлы в `public/data/*.generated.json` сохраняются для обратной совместимости.

Для ключей с небольшим дневным лимитом используйте режим экономии квоты (только фильмы, без staff), чтобы уложиться в 500 запросов:

```powershell
$env:KINOPOISK_INCLUDE_SERIES=0
$env:KINOPOISK_INCLUDE_STAFF=0
npm run data:build
```

Если нужен полный набор подсказок (сюжет, слоган, основной/второстепенный каст, факты, награды), включите дополнительные запросы:

```powershell
$env:KINOPOISK_INCLUDE_SERIES=0
$env:KINOPOISK_INCLUDE_STAFF=1
$env:KINOPOISK_INCLUDE_FACTS=1
$env:KINOPOISK_INCLUDE_AWARDS=1
npm run data:build
```

На бесплатном тарифе удобнее дозаполнять подсказки батчами:

```powershell
$env:KINOPOISK_HINT_BATCH=60
npm run data:hints
```

Скрипт `data:hints` обновляет только недостающие hint-поля и сохраняет прогресс в `public/data/source.json`.

### Сбор ID из длинного списка Navigator

Если нужно собрать несколько тысяч ID из страниц Navigator, используйте Playwright-скрипт
с автопереходом и возобновлением после остановки:

```powershell
npm install -D playwright
npx playwright install chromium
npm run data:collect-ids -- --url "https://www.kinopoisk.ru/top/navigator/.../#results" --manual
```

Что делает скрипт:

- открывает Chromium с постоянным профилем (`.tmp/kinopoisk-playwright-profile`);
- проходит страницы и собирает все `film/<id>` ссылки;
- пишет прогресс в `data/kinopoisk-navigator-state.json`;
- пишет итоговый список в `data/kinopoisk-navigator-ids.json`.

Продолжить после остановки:

```powershell
npm run data:collect-ids
```

Начать заново:

```powershell
npm run data:collect-ids -- --url "https://www.kinopoisk.ru/top/navigator/.../#results" --fresh
```

Если после сборки часть фильмов осталась с неполными полями (например, из-за лимита старого ключа), можно дозаполнить только пробелы без полного реимпорта:

```powershell
npm run data:refill
```

Ключ используется только Node-скриптом `scripts/import-kinopoisk.ts` и никогда не попадает в клиентскую сборку. Сведения об источнике и времени генерации сохраняются в `public/data/source.json`.

### Импорт аниме из Shikimori (по порядку популярности)

Импорт берется из каталога `https://shikimori.io/animes?order=popularity` строго по порядку: страница 1, затем 2, затем 3 и так далее.

Базовый импорт (первые 500):

```powershell
npm run data:build:anime
```

С ролями (персонажи/люди из `/api/animes/:id/roles`):

```powershell
npm run data:build:anime:roles
```

Полезные параметры:

```powershell
node scripts/import-shikimori-animes.mjs --max-items 500 --page-start 1 --limit 50 --delay-ms 700
```

Что важно:

- порядок не перемешивается: всегда от первого популярного к следующим;
- в запросах выставляется `User-Agent` (можно задать через `SHIKIMORI_USER_AGENT` в `.env.local`);
- антиспойлер для `plotHint` сейчас делает только явную маскировку названия, имен персонажей/людей (если включен `--fetch-roles`) и лор-ключей;
- маскировка trigger-фраз намеренно не используется.

## Структура

```text
src/App.tsx            интерфейс и пользовательские сценарии
src/game.ts           выбор тайтла, поиск, сравнение и шаринг
src/storage.ts        игры и статистика localStorage
src/styles.css        визуальная система и адаптивность
scripts/              сборка локального датасета
public/data/          готовые данные приложения
docs/                 исходная продуктовая документация
```
