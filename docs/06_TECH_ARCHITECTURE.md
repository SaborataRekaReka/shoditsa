# Tech Architecture

## Рекомендуемый стек

Использовать:

- Vite;
- React;
- TypeScript;
- CSS Modules или обычный CSS;
- localStorage;
- статичные JSON-файлы;
- npm scripts для подготовки данных.

Не использовать в MVP:

- Next.js;
- backend;
- database;
- SSR;
- auth;
- admin panel;
- analytics;
- PWA;
- sound engine.

## Почему Vite + React

Проект должен быть простым, статичным и дешёвым в хостинге. Vite + React даёт быструю разработку, понятную структуру и возможность задеплоить сайт на Vercel, Netlify, Cloudflare Pages, GitHub Pages или другой статичный хостинг.

Next.js здесь не нужен в первой версии, потому что нет SSR, backend routes, авторизации и SEO-страниц.

## Рекомендуемая структура

```txt
src/
  app/
    App.tsx
    routes.ts
  components/
    Header.tsx
    Hero.tsx
    ModeSwitcher.tsx
    PeriodSelect.tsx
    SearchBox.tsx
    AttemptTable.tsx
    AttemptRow.tsx
    HintTile.tsx
    ResultModal.tsx
    ArchivePanel.tsx
    StatsPanel.tsx
  data/
    loadTitles.ts
  game/
    compareTitles.ts
    dailyPuzzle.ts
    gameReducer.ts
    shareResult.ts
    stats.ts
    storage.ts
  search/
    normalizeQuery.ts
    titleSearch.ts
  types/
    title.ts
    game.ts
  styles/
    globals.css
    variables.css
public/
  data/
    movies.generated.json
    series.generated.json
scripts/
  import-data.ts
  normalize-data.ts
  validate-data.ts
```

## Daily puzzle selection

Выбор ответа должен быть детерминированным.

Входные данные:

- `mode`;
- `period`;
- московская дата в формате `YYYY-MM-DD`;
- список доступных тайтлов.

Алгоритм:

1. Отфильтровать тайтлы по режиму и периоду.
2. Исключить тайтлы, которые уже были ответами в ближайшие N дней, если есть расписание.
3. Применить seasonal boost, если дата попадает в сезонный слот.
4. Получить seed из строки `mode|period|date`.
5. Выбрать индекс через seeded random.
6. Вернуть тайтл.

Для MVP можно сделать простой hash-based выбор:

```ts
function seededIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0) % length;
}
```

## Московская дата

Нужно получать дату не из локального часового пояса пользователя, а по Москве.

Пример:

```ts
function getMoscowDateString(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(now);
}
```

## Периоды

```ts
export type PeriodKey = 'all' | 'from_1960' | 'from_1980' | 'from_1990' | 'from_2000' | 'from_2010' | 'from_2020';

export const PERIODS = {
  all: { label: 'Все годы', fromYear: null },
  from_1960: { label: 'С 1960', fromYear: 1960 },
  from_1980: { label: 'С 1980', fromYear: 1980 },
  from_1990: { label: 'С 1990', fromYear: 1990 },
  from_2000: { label: 'С 2000', fromYear: 2000 },
  from_2010: { label: 'С 2010', fromYear: 2010 },
  from_2020: { label: 'С 2020', fromYear: 2020 }
};
```

## Поиск

Для MVP можно реализовать без зависимости:

- нормализация строки;
- `includes` по русскому, оригинальному и альтернативным названиям;
- простая дистанция Левенштейна для коротких опечаток;
- сортировка по точности совпадения и популярности.

Если нужен быстрый результат, можно использовать Fuse.js.

## Состояние игры

Рекомендуется управлять состоянием через reducer.

```ts
type GameState = {
  mode: 'movie' | 'series';
  period: PeriodKey;
  dateMoscow: string;
  answerId: string;
  attempts: Attempt[];
  status: 'idle' | 'playing' | 'won' | 'lost';
};
```

## LocalStorage

Все записи версионировать.

Если структура меняется, не пытаться мигрировать сложные старые данные в MVP. Можно сбросить namespace `seans:v1` при переходе на `seans:v2`.

## Изображения

В JSON хранить только URL.

UI должен иметь fallback:

- если постер не загрузился, показать карточку-заглушку;
- если фото актёра не загрузилось, показать инициалы или не показывать фото.

## Производительность

- Не загружать фильмы и сериалы одновременно, если пользователь выбрал один режим.
- Можно lazy-load второго JSON при переключении режима.
- Не хранить большие описания.
- Не строить огромный поисковый индекс до первой фокусировки поля поиска.
- Для 3000 тайтлов обычный клиентский поиск должен быть приемлемым.

## Хостинг

Подходит любой статичный хостинг:

- Vercel;
- Netlify;
- Cloudflare Pages;
- GitHub Pages;
- обычный nginx;
- Chatium, если проект потом переносится туда как статичная сборка.

## Build output

Команда:

```bash
npm run build
```

Итоговая папка:

```txt
dist/
```

Её можно загрузить на статичный хостинг.
