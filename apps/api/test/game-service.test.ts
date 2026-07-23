import { describe, expect, it } from 'vitest'
import { CATALOG_HINT_COPY, PLAYABLE_MODE_IDS, type Hint, type TitleItem } from '@shoditsa/contracts'
import { answerPool, buildHintOptions, publicCard } from '../src/modules/games/service.js'

describe('public game card', () => {
  it('keeps genres required by attempt cards', () => {
    const item = {
      id: 'kp_301',
      mode: 'movie',
      titleRu: 'Матрица',
      genres: ['фантастика', 'боевик'],
    } as TitleItem

    expect(publicCard(item).genres).toEqual(['фантастика', 'боевик'])
  })

  it('never sends plot or fact copy to the player runtime', () => {
    const item = {
      id: 'game_private_hint',
      mode: 'game',
      titleRu: 'Игра',
      titleOriginal: 'Game',
      alternativeTitles: [],
      popularityScore: 0,
      plotHint: 'Сюжетный текст не должен попадать в игровой API.',
      facts: ['Факт не должен становиться отдельной подсказкой.'],
      description: 'Внутреннее описание карточки.',
      shortDescription: 'Короткое внутреннее описание.',
    } as TitleItem

    expect(publicCard(item)).not.toMatchObject({
      plotHint: expect.anything(),
      facts: expect.anything(),
      description: expect.anything(),
      shortDescription: expect.anything(),
    })
  })

  it('keeps extended facts required by server runtime cards', () => {
    const item = {
      id: 'tgdb_10836',
      mode: 'game',
      titleRu: 'F-Zero X',
      titleOriginal: 'F-Zero X',
      alternativeTitles: [],
      popularityScore: 0,
      year: 1998,
      genres: ['Racing'],
      developers: ['Nintendo EAD'],
      publishers: ['Nintendo of America, Inc.'],
      platforms: ['Nintendo 64'],
      steamCategories: ['4 игроков', 'Мультиплеер'],
      topRank: 563,
      posterUrl: '/data/libraries/games/img/tgdb_10836/poster.webp',
      keySymptoms: ['Лихорадка'],
      diagnostics: ['ПЦР'],
      riskFactors: ['Контакт с носителем'],
      topTracks: [{ rank: 1, title: 'Mute City', listeners: 1000 }],
      topAlbums: [{ rank: 1, title: 'F-Zero X OST', listeners: 1000 }],
      similarArtists: [{ rank: 1, name: 'Nintendo Sound Team', match: 90 }],
    } as TitleItem

    const card = publicCard(item)
    expect(card.developers).toEqual(['Nintendo EAD'])
    expect(card.publishers).toEqual(['Nintendo of America, Inc.'])
    expect(card.platforms).toEqual(['Nintendo 64'])
    expect(card.steamCategories).toEqual(['4 игроков', 'Мультиплеер'])
    expect(card.topTracks?.[0]?.title).toBe('Mute City')
    expect(card.keySymptoms).toEqual(['Лихорадка'])
    expect(card.posterUrl).toBe('/media/content/game/tgdb_10836/poster.webp')
  })

  it('normalizes people photo urls to media path', () => {
    const item = {
      id: 'kp_251733',
      mode: 'movie',
      titleRu: 'Аватар',
      titleOriginal: 'Avatar',
      alternativeTitles: [],
      popularityScore: 0,
      cast: [
        {
          nameRu: 'Сэм Уортингтон',
          nameOriginal: 'Sam Worthington',
          photoUrl: './data/libraries/people/img/84/842c7705dac914e1a3765e58bb2ca6d50117a5eb20e833d38133af5ca19a9ab3.webp',
        },
      ],
    } as TitleItem

    const card = publicCard(item)
    expect(card.cast?.[0]?.photoUrl).toBe('/media/people/84/842c7705dac914e1a3765e58bb2ca6d50117a5eb20e833d38133af5ca19a9ab3.webp')
  })
})

describe('catalog search pool', () => {
  it('keeps every music tier for standalone search and filters only an explicit difficulty', async () => {
    const items = [
      {
        id: 'music:core',
        mode: 'music',
        titleRu: 'Core Artist',
        titleOriginal: 'Core Artist',
        alternativeTitles: [],
        popularityScore: 2,
        gameTier: 'core',
        contentStatus: 'ready',
        allowedInGame: true,
      },
      {
        id: 'music:niche',
        mode: 'music',
        titleRu: 'Niche Artist',
        titleOriginal: 'Niche Artist',
        alternativeTitles: [],
        popularityScore: 1,
        gameTier: 'niche',
        contentStatus: 'ready',
        allowedInGame: true,
      },
    ] as TitleItem[]
    const rows = items.map((payload, index) => ({ id: `version-${index}`, payload }))
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => rows,
          }),
        }),
      }),
    } as never

    expect((await answerPool(db, 'revision', 'music', 'all', null)).items.map((item) => item.id))
      .toEqual(['music:core', 'music:niche'])
    expect((await answerPool(db, 'revision', 'music', 'all', 'medium')).items.map((item) => item.id))
      .toEqual(['music:core'])
  })
})

describe('server hint options', () => {
  it('applies the resolved-field rule across every game mode', () => {
    const cases: Array<{ answer: TitleItem; hints: Hint[]; expected: string }> = [
      {
        answer: {
          id: 'movie_1', mode: 'movie', titleRu: 'Фильм', titleOriginal: 'Movie', alternativeTitles: [], popularityScore: 0,
          year: 2003, countries: ['США', 'Канада'], genres: ['драма'],
        } as TitleItem,
        hints: [
          { key: 'year', label: 'Год', value: '2003', status: 'match', direction: null },
          { key: 'country', label: 'Страна', value: 'США, Канада', status: 'match', direction: null },
        ],
        expected: 'Жанры: драма',
      },
      {
        answer: {
          id: 'anime_1', mode: 'anime', titleRu: 'Аниме', titleOriginal: 'Anime', alternativeTitles: [], popularityScore: 0,
          animeKind: 'Фильм', animeStatus: 'Вышло', episodes: 1, studios: ['Studio A'], genres: ['Драма'], year: 2020,
        } as TitleItem,
        hints: [
          { key: 'anime_kind', label: 'Формат', value: 'Фильм', status: 'match', direction: null },
          { key: 'anime_status', label: 'Статус', value: 'Вышло', status: 'match', direction: null },
          { key: 'episodes', label: 'Эпизоды', value: '1', status: 'match', direction: null },
        ],
        expected: 'Студии: Studio A',
      },
      {
        answer: {
          id: 'diagnosis_1', mode: 'diagnosis', titleRu: 'Диагноз', titleOriginal: 'Diagnosis', alternativeTitles: [], popularityScore: 0,
          bodySystems: ['Нервная система'], keySymptoms: ['Головная боль'], diagnostics: ['МРТ'],
        } as TitleItem,
        hints: [
          { key: 'body_systems', label: 'Система', value: 'Нервная система', status: 'match', direction: null },
        ],
        expected: 'Ключевые симптомы: Головная боль',
      },
      {
        answer: {
          id: 'music_1', mode: 'music', titleRu: 'Артист', titleOriginal: 'Artist', alternativeTitles: [], popularityScore: 0,
          countries: ['US'], activityStartYear: 2000, musicType: 'group', genres: ['Rock'],
        } as TitleItem,
        hints: [
          { key: 'country', label: 'Страна', value: 'США', status: 'match', direction: null },
          { key: 'activity_start_year', label: 'Начало деятельности', value: '2000', status: 'match', direction: null },
          { key: 'music_type', label: 'Тип артиста', value: 'Группа', status: 'match', direction: null },
        ],
        expected: 'Жанры: Rock',
      },
    ]

    for (const testCase of cases) {
      const options = buildHintOptions(testCase.answer, [], [{ hints: testCase.hints }])
      expect(options.find((option) => option.key === 'info')?.value).toBe(testCase.expected)
    }
  })

  it('removes already matched people from partially revealed fields', () => {
    const answer = {
      id: 'movie_people', mode: 'movie', titleRu: 'Фильм', titleOriginal: 'Movie', alternativeTitles: [], popularityScore: 0,
      year: 2003,
      countries: ['США'],
      genres: ['драма'],
      directors: [{ nameRu: 'Первый режиссёр', nameOriginal: '' }, { nameRu: 'Второй режиссёр', nameOriginal: '' }],
    } as TitleItem
    const hints: Hint[] = [
      { key: 'year', label: 'Год', value: '2003', status: 'match', direction: null },
      { key: 'country', label: 'Страна', value: 'США', status: 'match', direction: null },
      { key: 'genres', label: 'Жанры', value: 'драма', status: 'match', direction: null },
      {
        key: 'creator', label: 'Режиссёр', value: 'Первый режиссёр', status: 'partial', direction: null,
        people: [{ nameRu: 'Первый режиссёр', nameOriginal: '', matched: true }],
      },
    ]

    const options = buildHintOptions(answer, [], [{ hints }])

    expect(options.find((option) => option.key === 'info')?.value).toBe('Режиссёры: Второй режиссёр')
  })

  it('tracks the revealed source field instead of skipping by a mutable list index', () => {
    const answer = {
      id: 'game_source', mode: 'game', titleRu: 'Игра', titleOriginal: 'Game', alternativeTitles: [], popularityScore: 0,
      year: 1998, genres: ['Racing'], platforms: ['Nintendo 64'], developers: ['Nintendo EAD'],
    } as TitleItem
    const attempts = [{
      hints: [{ key: 'year', label: 'Год', value: '1998', status: 'match' as const, direction: null }],
    }]

    const options = buildHintOptions(answer, [{ hintKey: 'info', response: { sourceKey: 'genres', value: 'Жанры: Racing' } }], attempts)

    expect(options.find((option) => option.key === 'info')?.value).toBe('Платформы: Nintendo 64')
  })

  it('removes matched values from unopened list fields and offers no other hint kind', () => {
    const answer = {
      id: 'game_1',
      mode: 'game',
      titleRu: 'Example game',
      titleOriginal: 'Example game',
      alternativeTitles: [],
      popularityScore: 0,
      year: 1998,
      genres: ['Racing', 'Action'],
      platforms: ['Nintendo 64'],
      developers: ['Nintendo EAD'],
      facts: ['Released in 1998.', 'It introduced a new championship mode.'],
    } as TitleItem
    const attempts = [{
      hints: [
        { key: 'year', label: 'Year', value: '1998', status: 'match' as const, direction: null },
        { key: 'genres', label: 'Genres', value: 'Racing', status: 'close' as const, direction: null, matchedValues: ['Racing'] },
      ],
    }]

    const options = buildHintOptions(answer, [], attempts)

    expect(options.find((option) => option.key === 'info')?.value).toBe('Жанры: Action')
    expect(options.map((option) => option.key)).toEqual(['info'])
  })

  it('never exposes facts as a separate hint kind', () => {
    const answer = {
      id: 'anime_1',
      mode: 'anime',
      titleRu: 'Пример аниме',
      titleOriginal: 'Example Anime',
      alternativeTitles: [],
      popularityScore: 0,
      year: 2024,
      animeKind: 'TV сериал',
      animeStatus: 'Вышло',
      episodes: 13,
      animeEpisodesAired: 12,
      facts: [
        'Формат: TV сериал',
        'Статус: Вышло',
        'Эпизоды: 13',
        'Вышло эпизодов: 12',
        'Настоящий дополнительный факт.',
      ],
    } as TitleItem

    const options = buildHintOptions(answer, [])

    expect(options.map((option) => option.key)).toEqual(['info'])
  })

  it('does not spend a hint on a binary value already implied by a miss', () => {
    const answer = {
      id: 'anime_binary',
      mode: 'anime',
      titleRu: 'Пример аниме',
      titleOriginal: 'Example Anime',
      alternativeTitles: [],
      popularityScore: 0,
      animeKind: 'Фильм',
      animeStatus: 'Вышло',
      episodes: 1,
      studios: ['Studio A'],
      plotHint: 'Формат: Фильм',
    } as TitleItem
    const attempts = [{
      hints: [
        { key: 'anime_kind', label: 'Формат', value: 'TV сериал', status: 'miss' as const, direction: null },
        { key: 'anime_status', label: 'Статус', value: 'Вышло', status: 'match' as const, direction: null },
      ],
    }]

    const options = buildHintOptions(answer, [], attempts)

    expect(options.find((option) => option.key === 'info')?.value).toBe('Эпизоды: 1')
    expect(options.map((option) => option.key)).toEqual(['info'])
  })

  it('keeps a categorical hint when the answer is outside the small inferred pair', () => {
    const answer = {
      id: 'anime_ova',
      mode: 'anime',
      titleRu: 'Пример OVA',
      titleOriginal: 'Example OVA',
      alternativeTitles: [],
      popularityScore: 0,
      animeKind: 'OVA',
    } as TitleItem
    const attempts = [{
      hints: [{ key: 'anime_kind', label: 'Формат', value: 'Фильм', status: 'miss' as const, direction: null }],
    }]

    const options = buildHintOptions(answer, [], attempts)

    expect(options.find((option) => option.key === 'info')?.value).toBe('Формат: OVA')
  })

  it('applies the same binary inference rule outside anime', () => {
    const answer = {
      id: 'music_binary',
      mode: 'music',
      titleRu: 'Пример артиста',
      titleOriginal: 'Example Artist',
      alternativeTitles: [],
      popularityScore: 0,
      musicType: 'group',
      musicOrigin: 'intl',
      genres: ['Rock'],
    } as TitleItem
    const attempts = [{
      hints: [
        { key: 'music_type', label: 'Тип артиста', value: 'Группа', status: 'match' as const, direction: null },
        { key: 'music_origin', label: 'Сцена', value: 'Русскоязычная сцена', status: 'miss' as const, direction: null },
      ],
    }]

    const options = buildHintOptions(answer, [], attempts)

    expect(options.find((option) => option.key === 'info')?.value).toBe('Жанры: Rock')
  })

  it('does not repeat any modeled field as an interesting fact', () => {
    const answer = {
      id: 'movie_model_fact',
      mode: 'movie',
      titleRu: 'Пример фильма',
      titleOriginal: 'Example Movie',
      alternativeTitles: [],
      popularityScore: 0,
      year: 2003,
      plotHint: 'Год релиза: 2003',
    } as TitleItem

    const options = buildHintOptions(answer, [])

    expect(options.find((option) => option.key === 'info')?.value).toBe('Год релиза: 2003')
    expect(options.map((option) => option.key)).toEqual(['info'])
  })

  it('ignores plot and fact copy even when both are present', () => {
    const answer = {
      id: 'anime_2',
      mode: 'anime',
      titleRu: 'Пример аниме',
      titleOriginal: 'Example Anime',
      alternativeTitles: [],
      popularityScore: 0,
      animeKind: 'TV сериал',
      animeStatus: 'Вышло',
      episodes: 12,
      facts: ['Формат: TV сериал', 'Статус: Вышло', 'Эпизоды: 12'],
      plotHint: 'Безопасная сюжетная подсказка.',
    } as TitleItem

    const options = buildHintOptions(answer, [])

    expect(options.map((option) => option.key)).toEqual(['info'])
    expect(options[0]?.value).toBe('Формат: TV сериал')
  })

  it('never offers plot or fact choices', () => {
    const answer = {
      id: 'movie_plot_choice', mode: 'movie', titleRu: 'Пример фильма', titleOriginal: 'Example Movie', alternativeTitles: [], popularityScore: 0,
      year: 2003,
      plotHint: 'Герой получает опасное задание и вынужден отправиться в неизвестность.',
      facts: ['Съёмки проходили сразу в нескольких странах.'],
    } as TitleItem

    expect(buildHintOptions(answer, []).map((option) => option.key)).toEqual(['info'])
    expect(buildHintOptions(answer, [{ hintKey: 'info' }]).map((option) => option.key)).toEqual([])
    expect(buildHintOptions(answer, [{ hintKey: 'fact' }]).map((option) => option.key)).toEqual(['info'])
    expect(buildHintOptions(answer, [{ hintKey: 'plot' }]).map((option) => option.key)).toEqual(['info'])
  })

  it('never substitutes descriptions or plot text for unopened information', () => {
    const baseAnswer = {
      id: 'game_bad_hint', mode: 'game', titleRu: 'Example', titleOriginal: 'Example', alternativeTitles: [], popularityScore: 0,
      description: 'A long description that must never become an in-game fact hint.',
      shortDescription: 'A short description that must never become an in-game fact hint.',
    } as TitleItem

    expect(buildHintOptions(baseAnswer, [])).toEqual([])
    for (const plotHint of ['This imported hint was visibly truncated...', 'Too short', 'Text with _KEEP_1_ service marker inside']) {
      expect(buildHintOptions({ ...baseAnswer, plotHint }, [])).toEqual([])
    }
  })

  it('uses exhaustive mode-specific copy for the only supported hint kind', () => {
    const answers = {
      movie: { year: 2000 },
      series: { year: 2000 },
      anime: { year: 2000 },
      game: { year: 2000 },
      city: { country: 'Казахстан' },
      music: { countries: ['KZ'] },
      diagnosis: { bodySystems: ['Нервная система'] },
    } as const

    for (const mode of PLAYABLE_MODE_IDS) {
      const answer = {
        id: `${mode}:copy`,
        mode,
        titleRu: 'Ответ',
        titleOriginal: 'Answer',
        alternativeTitles: [],
        popularityScore: 0,
        ...answers[mode],
      } as TitleItem
      const options = buildHintOptions(answer, [])

      expect(options).toHaveLength(1)
      expect(options[0]?.key).toBe('info')
      expect(options[0]?.title).toBe(CATALOG_HINT_COPY[mode].optionTitle)
      expect(options[0]?.subtitle).toBe(CATALOG_HINT_COPY[mode].optionSubtitle)
    }
  })
})
