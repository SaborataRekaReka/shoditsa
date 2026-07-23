# Отчёт об обогащении базы игр

Дата: 2026-07-23T13:22:59.119Z

## Результат

- Исходных объектов: **1016**
- Широкий пул SteamSpy: **3000**
- Получено карточек Steam Store: **1322**
- Канонический каталог: **2270**
- Daily-general: **1000**
- Добавлено из публичных Steam-источников: **1257**
- Объединено/перенаправлено: **60**
- Отклонено: **8**
- В очереди ручной проверки: **1760**

## До и после

| Метрика | До | После |
| --- | --- | --- |
| Всего объектов | 1016 | 2270 |
| Steam App ID | 17 | 1289 |
| IGDB ID | 0 | 0 |
| Карточки с алиасами | 17 | 503 |
| 2022+ | 14 | 230 |
| Nintendo в daily | не ограничено | 55 |
| Console-only в daily | не ограничено | 397 |

## Распределение daily-general

Эпохи:

| Эпоха | Цель | Факт |
| --- | --- | --- |
| before_2000 | 80 | 80 |
| 2000_2009 | 170 | 170 |
| 2010_2016 | 250 | 250 |
| 2017_2021 | 270 | 270 |
| 2022_current | 230 | 230 |

Уровни узнаваемости:

| Уровень | Количество |
| --- | --- |
| cult_or_genre | 107 |
| mainstream | 850 |
| mass | 43 |

Крупнейшие франшизы:

| Франшиза | Количество |
| --- | --- |
| the-legend-of-zelda | 5 |
| mario | 5 |
| final-fantasy | 5 |
| star-wars | 5 |
| call-of-duty | 5 |
| grand-theft-auto | 5 |
| the-elder-scrolls | 5 |
| assassins-creed | 5 |
| divinity | 3 |
| metal-gear | 3 |
| street-fighter | 3 |
| resident-evil | 3 |
| sonic | 3 |
| civilization | 3 |
| diablo | 3 |
| fallout | 3 |
| mortal-kombat | 3 |
| warcraft | 3 |
| silent-hill | 3 |
| halo | 3 |
| the-sims | 3 |
| mass-effect | 3 |
| counter-strike | 3 |
| god-of-war | 3 |
| gears-of-war | 3 |

## Ожидаемые современные игры

| Игра | Canonical ID | В daily |
| --- | --- | --- |
| Divinity: Original Sin 2 | steam_435150 | да |
| Valheim | steam_892970 | да |
| Palworld | steam_1623730 | да |
| Lethal Company | steam_1966720 | да |

## Аудит исходной схемы

- Корень JSON: массив.
- Стабильный публичный идентификатор: `id`; он сохранён как `canonicalGameId`.
- Принимаемые ответы: `titleRu`, `titleOriginal`, `alternativeTitles`, `aliases`.
- Сравнительные подсказки: год, topRank, жанры, Steam-категории, платформы, разработчики, издатели, Steam-рейтинг/отзывы, Metacritic, цена и возрастной рейтинг.
- `steamAppId` не обязателен: игровой движок имеет полноценный fallback по остальным полям.
- `allowedInGame` теперь является совместимым флагом daily-general; специальные карточки остаются в каталоге с `allowedInGame: false`.
- Корреляция старого `popularityScore` с рангом PlayThatGame: **-0.9999**.

| Поле | Типы | Заполнено | Доля |
| --- | --- | --- | --- |
| ageRating | null, string | 933/1016 | 91.8% |
| allowedInGame | boolean | 17/1016 | 1.7% |
| alternativeTitles | array | 17/1016 | 1.7% |
| backdropUrl | string | 1016/1016 | 100% |
| comments | array | 25/1016 | 2.5% |
| dataQuality | object | 1016/1016 | 100% |
| description | string | 1016/1016 | 100% |
| developers | array | 1007/1016 | 99.1% |
| externalRanks | object | 1016/1016 | 100% |
| genres | array | 1016/1016 | 100% |
| headerUrl | string | 1016/1016 | 100% |
| id | string | 1016/1016 | 100% |
| metacritic | null, number | 8/1016 | 0.8% |
| mode | string | 1016/1016 | 100% |
| notes | array | 1016/1016 | 100% |
| platforms | array | 1016/1016 | 100% |
| plotHint | string | 1016/1016 | 100% |
| popularityScore | number | 1016/1016 | 100% |
| posterUrl | string | 1016/1016 | 100% |
| price | object | 1016/1016 | 100% |
| publishers | array | 954/1016 | 93.9% |
| ratings | object | 1016/1016 | 100% |
| releaseDate | null, string | 999/1016 | 98.3% |
| screenshots | array | 726/1016 | 71.5% |
| shortDescription | string | 1016/1016 | 100% |
| steamAppId | null, number | 17/1016 | 1.7% |
| steamCategories | array | 975/1016 | 96% |
| steamTags | array | 999/1016 | 98.3% |
| steamUrl | null, string | 17/1016 | 1.7% |
| supportedLanguages | array | 17/1016 | 1.7% |
| titleOriginal | string | 1016/1016 | 100% |
| titleRu | string | 1016/1016 | 100% |
| topRank | null, number | 999/1016 | 98.3% |
| votes | object | 1016/1016 | 100% |
| year | number | 1016/1016 | 100% |

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
- Лимиты франшиз соблюдены.
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
