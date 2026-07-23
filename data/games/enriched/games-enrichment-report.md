# Отчёт об обогащении базы игр

Дата: 2026-07-23T15:21:38.809Z

## Результат

- Исходных объектов: **2270**
- Широкий пул SteamSpy: **3000**
- Получено карточек Steam Store: **1322**
- Канонический каталог: **2270**
- Daily-general: **1000**
- Добавлено из публичных Steam-источников: **0**
- Объединено/перенаправлено: **1316**
- Отклонено: **6**
- В очереди ручной проверки: **1760**

## До и после

| Метрика | До | После |
| --- | --- | --- |
| Всего объектов | 2270 | 2270 |
| Steam App ID | 1289 | 1289 |
| IGDB ID | 0 | 0 |
| Карточки с алиасами | 32 | 503 |
| 2022+ | 394 | 29 |
| Nintendo в daily | не ограничено | 148 |
| Console-only в daily | не ограничено | 902 |

## Распределение daily-general

Эпохи:

| Эпоха | Цель | Факт |
| --- | --- | --- |
| before_2000 | 80 | 363 |
| 2000_2009 | 170 | 301 |
| 2010_2016 | 250 | 214 |
| 2017_2021 | 270 | 93 |
| 2022_current | 230 | 29 |

Уровни узнаваемости:

| Уровень | Количество |
| --- | --- |
| cult_or_genre | 235 |
| mainstream | 765 |

Крупнейшие франшизы:

| Франшиза | Количество |
| --- | --- |
| mario | 38 |
| the-legend-of-zelda | 16 |
| final-fantasy | 16 |
| star-wars | 14 |
| metal-gear | 8 |
| sonic | 8 |
| grand-theft-auto | 8 |
| halo | 7 |
| street-fighter | 6 |
| civilization | 6 |
| fallout | 6 |
| call-of-duty | 6 |
| assassins-creed | 6 |
| god-of-war | 6 |
| battlefield | 6 |
| counter-strike | 5 |
| gears-of-war | 5 |
| forza | 5 |
| fifa | 5 |
| resident-evil | 4 |
| doom | 4 |
| warcraft | 4 |
| the-sims | 4 |
| hitman | 4 |
| far-cry | 4 |

## Ожидаемые современные игры

| Игра | Canonical ID | В daily |
| --- | --- | --- |
| Divinity: Original Sin 2 | steam_435150 | да |
| Valheim | steam_892970 | да |
| Palworld | steam_1623730 | нет |
| Lethal Company | steam_1966720 | да |

## Аудит исходной схемы

- Корень JSON: массив.
- Стабильный публичный идентификатор: `id`; он сохранён как `canonicalGameId`.
- Принимаемые ответы: `titleRu`, `titleOriginal`, `alternativeTitles`, `aliases`.
- Сравнительные подсказки: год, topRank, жанры, Steam-категории, платформы, разработчики, издатели, Steam-рейтинг/отзывы, Metacritic, цена и возрастной рейтинг.
- `steamAppId` не обязателен: игровой движок имеет полноценный fallback по остальным полям.
- `allowedInGame` теперь является совместимым флагом daily-general; специальные карточки остаются в каталоге с `allowedInGame: false`.
- Корреляция старого `popularityScore` с рангом PlayThatGame: **-0.2093**.

| Поле | Типы | Заполнено | Доля |
| --- | --- | --- | --- |
| acceptedAnswers | array | 2270/2270 | 100% |
| ageRating | null, string | 920/2270 | 40.5% |
| aliases | array | 4/2270 | 0.2% |
| allowedInGame | boolean | 2270/2270 | 100% |
| alternativeTitles | array | 32/2270 | 1.4% |
| backdropUrl | string | 2270/2270 | 100% |
| calibration | object | 2270/2270 | 100% |
| canonicalGameId | string | 2270/2270 | 100% |
| cisScore | number | 2270/2270 | 100% |
| comments | array | 25/2270 | 1.1% |
| contentStatus | string | 2270/2270 | 100% |
| dailyEligible | boolean | 2270/2270 | 100% |
| dataQuality | object | 2270/2270 | 100% |
| description | null, string | 1121/2270 | 49.4% |
| developers | array | 2261/2270 | 99.6% |
| editionType | string | 2270/2270 | 100% |
| externalRanks | object | 2270/2270 | 100% |
| franchiseKey | null, string | 376/2270 | 16.6% |
| genres | array | 2267/2270 | 99.9% |
| guessabilityScore | number | 2270/2270 | 100% |
| headerUrl | string | 2270/2270 | 100% |
| id | string | 2270/2270 | 100% |
| igdbId | null | 0/2270 | 0% |
| legacyIds | array | 42/2270 | 1.9% |
| legacyPopularityScore | number | 2270/2270 | 100% |
| legacySteamTags | array | 996/2270 | 43.9% |
| localizedTitles | object | 2270/2270 | 100% |
| matchConfidence | number | 2270/2270 | 100% |
| metacritic | null, number | 81/2270 | 3.6% |
| mode | string | 2270/2270 | 100% |
| normalizedAnswers | array | 2270/2270 | 100% |
| notes | array | 2270/2270 | 100% |
| parentCanonicalGameId | null | 0/2270 | 0% |
| platforms | array | 2270/2270 | 100% |
| plotHint | string | 2270/2270 | 100% |
| poolIds | array | 2230/2270 | 98.2% |
| popularityScore | number | 2270/2270 | 100% |
| posterUrl | string | 2270/2270 | 100% |
| price | null, object | 1121/2270 | 49.4% |
| priceSnapshotAt | string | 1315/2270 | 57.9% |
| publishers | array | 2208/2270 | 97.3% |
| ratings | object | 2270/2270 | 100% |
| recognitionComponents | object | 2270/2270 | 100% |
| recognitionLevel | string | 2270/2270 | 100% |
| recognitionScore | number | 2270/2270 | 100% |
| recognitionSignals | object | 2270/2270 | 100% |
| relatedVersions | array | 0/2270 | 0% |
| releaseDate | null, string | 2130/2270 | 93.8% |
| releaseYear | number | 2270/2270 | 100% |
| reviewStatus | string | 2270/2270 | 100% |
| scoreConfidence | number | 2270/2270 | 100% |
| scoreFormulaVersion | string | 2270/2270 | 100% |
| screenshots | array | 839/2270 | 37% |
| shortDescription | null, string | 1121/2270 | 49.4% |
| sourceFlags | array | 2270/2270 | 100% |
| steamAppId | null, number | 1289/2270 | 56.8% |
| steamCategories | array | 1081/2270 | 47.6% |
| steamTags | array | 1185/2270 | 52.2% |
| steamUrl | null, string | 1289/2270 | 56.8% |
| supportedLanguages | array | 1315/2270 | 57.9% |
| title | string | 2270/2270 | 100% |
| titleOriginal | string | 2270/2270 | 100% |
| titleRu | string | 2270/2270 | 100% |
| topRank | null, number | 1000/2270 | 44.1% |
| trendScore | number | 2270/2270 | 100% |
| verifiedAt | string | 2270/2270 | 100% |
| votes | object | 2270/2270 | 100% |
| wikidataId | null, string | 1186/2270 | 52.2% |
| wikidataUrl | null, string | 1186/2270 | 52.2% |
| year | null, number | 2268/2270 | 99.9% |

## Карта совместимости

| Текущее поле | Фактический смысл | Проблема | Новое правило | Миграция |
| --- | --- | --- | --- | --- |
| id | публичный ID карточки | стабилен | canonicalGameId = id | нет |
| dataQuality.verified | старый pipeline прошёл | не гарантирует идентичность | reviewStatus + matchConfidence + verifiedAt | совместимое расширение |
| popularityScore | часто линейный PTG rank | не узнаваемость | legacyPopularityScore + recognitionScore | popularityScore зеркалит recognitionScore |
| steamTags | смесь жанров/режимов/платформ | не реальные теги Steam | неподтверждённые значения → legacySteamTags | совместимое расширение |
| topRank | позиция в старом списке | ретро-перекос | позиция в новом daily-general | пересчитано |
| allowedInGame | допуск в общий режим | раньше почти всегда true/undefined | true только для daily-general | пересчитано |

## Ограничения источников

- IGDB не запрашивался без API-ключа; `igdbPlayed`, `igdbVisits` и `igdbId` не выдумывались.
- Steam community tags не подменялись жанрами и категориями.
- SteamSpy используется как внешний наблюдаемый сигнал, а не как единственная мера узнаваемости.
- Цена сохранена только как snapshot с датой и не входит в recognitionScore.
- Реальная игровая калибровка подготовлена, но не смешивается со score до 75 ответов на карточку.

## Проверки

- JSON валиден.
- Daily-general содержит ровно 1000 уникальных canonicalGameId.
- Конфликтов Steam App ID нет.
- Технические приложения и невышедшие игры исключены из daily.
- Для 112 карточек мягкие лимиты эпох и франшиз ослаблены, чтобы в daily оставались только игры с валидной подсказкой.
- Все daily-карточки имеют обязательные поля движка и принимаемый ответ.
- Все score и confidence находятся в допустимом диапазоне.
- Все старые ID сохранены либо перечислены в migration map.

## Повторный запуск

```powershell
npm run data:enrich:games -- --fetch --publish
```

Офлайн по сохранённым cache-файлам:

```powershell
npm run data:enrich:games -- --publish
```
