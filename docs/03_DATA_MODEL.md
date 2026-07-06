# Data Model

## Основная сущность

Каждый фильм или сериал хранится как объект `TitleItem`.

```ts
export type TitleMode = 'movie' | 'series';

export type TitleItem = {
  id: string;
  mode: TitleMode;

  titleRu: string;
  titleOriginal: string;
  alternativeTitles: string[];

  year: number;
  endYear?: number | null;

  countries: string[];
  originalLanguage: string;

  genres: string[];
  ageRating?: string | null;
  runtimeMinutes?: number | null;

  directors: PersonRef[];
  showrunners?: PersonRef[];
  writers?: PersonRef[];
  cast: PersonRef[];
  studios: string[];

  kinopoiskId?: string | null;
  imdbId?: string | null;

  ratings: {
    kinopoisk?: number | null;
    imdb?: number | null;
  };

  votes?: {
    kinopoisk?: number | null;
    imdb?: number | null;
  };

  popularityScore: number;

  budget?: MoneyValue | null;

  posterUrl?: string | null;
  backdropUrl?: string | null;

  seasonTags?: string[];
  franchise?: string | null;

  dataQuality: {
    source: string[];
    verified: boolean;
    missingFields: string[];
  };
};

export type PersonRef = {
  id?: string;
  nameRu: string;
  nameOriginal?: string;
  photoUrl?: string | null;
};

export type MoneyValue = {
  amount: number;
  currency: 'USD' | 'RUB' | 'EUR' | 'GBP' | 'KRW' | 'JPY' | 'OTHER';
};
```

## Обязательные поля для MVP

Для каждого тайтла желательно иметь:

- `id`;
- `mode`;
- `titleRu`;
- `titleOriginal`;
- `alternativeTitles`;
- `year`;
- `countries`;
- `originalLanguage`;
- `genres`;
- `directors` или `showrunners`;
- `cast`;
- `studios`;
- `ratings.kinopoisk`;
- `ratings.imdb`;
- `popularityScore`;
- `posterUrl`.

Не все источники дадут бюджет, возрастной рейтинг, длительность и студии. Игра должна корректно работать с отсутствующими данными.

## ID

Рекомендуемый формат:

- если есть Кинопоиск ID: `kp_535341`;
- если есть только IMDb ID: `imdb_tt0816692`;
- если данных нет: slug от названия и года, например `manual_brat_1997`.

## Названия

Поиск должен учитывать:

- русское название;
- оригинальное название;
- альтернативные названия;
- варианты с `е/ё`;
- варианты с дефисами и без;
- нижний регистр;
- удаление лишних пробелов и знаков препинания.

Транслит не нужен в MVP.

## Жанры

Жанры нужно нормализовать на русском языке. Не хранить одновременно `sci-fi`, `Science Fiction`, `фантастика` как разные жанры. Для UI использовать только русские значения.

Пример:

```json
{
  "Action": "боевик",
  "Adventure": "приключения",
  "Animation": "мультфильм",
  "Comedy": "комедия",
  "Crime": "криминал",
  "Documentary": "документальный",
  "Drama": "драма",
  "Family": "семейный",
  "Fantasy": "фэнтези",
  "History": "история",
  "Horror": "ужасы",
  "Music": "музыка",
  "Mystery": "детектив",
  "Romance": "мелодрама",
  "Science Fiction": "фантастика",
  "Thriller": "триллер",
  "War": "военный",
  "Western": "вестерн"
}
```

## Популярность

`popularityScore` — число от 0 до 100. Оно нужно, чтобы заменить кассовые сборы и лучше отражать узнаваемость у русскоязычной аудитории.

Пример формулы для build-time скрипта:

```ts
popularityScore = clamp(
  100
  - topRankPenalty
  + kinopoiskVotesBonus
  + imdbVotesBonus
  + manualCisBoost
  + seasonalBoost,
  0,
  100
)
```

В MVP можно выставить значение вручную или полуавтоматически при импорте.

## Периоды

Фильтр периода работает по `year`.

Для сериалов использовать `startYear` в поле `year`.

## Данные для шаринга

Для каждой завершённой игры хранить:

```ts
export type GameResult = {
  puzzleKey: string;
  mode: TitleMode;
  period: string;
  dateMoscow: string;
  answerId: string;
  status: 'won' | 'lost';
  attemptsCount: number;
  attemptIds: string[];
  hintGrid: ShareCellStatus[][];
  completedAt: string;
};
```

## LocalStorage

Рекомендуемые ключи:

- `seans:v1:settings`;
- `seans:v1:daily-results`;
- `seans:v1:archive-results`;
- `seans:v1:stats`.

Версионирование ключей нужно, чтобы потом можно было менять формат без поломки старых данных.
