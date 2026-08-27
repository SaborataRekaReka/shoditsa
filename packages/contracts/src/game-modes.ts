// Keep the persisted PostgreSQL enum order stable; presentation order is dailyOrder.
export const CONTENT_MODE_IDS = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis', 'city', 'danetki', 'connections', 'animal', 'book', 'character', 'territory'] as const
// Every listed runtime is available in the player application. Full-house
// participation remains a separate capability below.
export const PLAYABLE_MODE_IDS = ['movie', 'series', 'anime', 'game', 'music', 'diagnosis', 'city', 'animal', 'book', 'character', 'connections', 'danetki'] as const

export type ContentModeId = typeof CONTENT_MODE_IDS[number]
export type PlayableModeId = typeof PLAYABLE_MODE_IDS[number]
export type GameEngine = 'catalog_guess' | 'danetki_chat' | 'connections_grid' | 'territory_duel'

export type GameModeCapabilities = {
  engine: GameEngine
  label: string
  dailyLabel: string
  shareIcon: string
  dataDir: 'movies' | 'series' | 'animes' | 'games' | 'cities' | 'music' | 'diagnoses' | 'animals' | 'books' | 'characters' | 'danetki' | 'connections' | 'territory'
  dailyOrder: number
  countsTowardFullHouse: boolean
  periodPolicy: 'year' | 'all'
  difficultyPolicy: 'music' | 'none'
  freePlay: boolean
  variants: readonly GameModeVariant[]
  runtimes: readonly ('hosted' | 'local')[]
}

export type GameModeVariant = {
  id: string
  label: string
  shortLabel: string
  description: string
}

/**
 * Canonical, dependency-free description of every playable mode.
 * Runtime rules and React presentation live in their own exhaustive registries,
 * while capabilities, ordering and public identifiers are defined only here.
 */
export const GAME_MODE_MANIFEST = {
  movie: {
    engine: 'catalog_guess', label: 'Кино', dailyLabel: 'Фильм', shareIcon: '🎬', dataDir: 'movies', dailyOrder: 1,
    countsTowardFullHouse: true, periodPolicy: 'year', difficultyPolicy: 'none', freePlay: true, variants: [], runtimes: ['hosted', 'local'],
  },
  series: {
    engine: 'catalog_guess', label: 'Сериалы', dailyLabel: 'Сериал', shareIcon: '📺', dataDir: 'series', dailyOrder: 2,
    countsTowardFullHouse: true, periodPolicy: 'year', difficultyPolicy: 'none', freePlay: true, variants: [], runtimes: ['hosted', 'local'],
  },
  anime: {
    engine: 'catalog_guess', label: 'Аниме', dailyLabel: 'Аниме', shareIcon: '🌸', dataDir: 'animes', dailyOrder: 3,
    countsTowardFullHouse: true, periodPolicy: 'year', difficultyPolicy: 'none', freePlay: true, variants: [], runtimes: ['hosted', 'local'],
  },
  game: {
    engine: 'catalog_guess', label: 'Игры', dailyLabel: 'Игра', shareIcon: '🎮', dataDir: 'games', dailyOrder: 4,
    countsTowardFullHouse: true, periodPolicy: 'all', difficultyPolicy: 'none', freePlay: true, variants: [], runtimes: ['hosted', 'local'],
  },
  city: {
    engine: 'catalog_guess', label: 'Города', dailyLabel: 'Город', shareIcon: '🌍', dataDir: 'cities', dailyOrder: 5,
    countsTowardFullHouse: true, periodPolicy: 'all', difficultyPolicy: 'none', freePlay: true,
    variants: [
      { id: 'capitals', label: 'Столицы', shortLabel: 'Столицы', description: 'Только столицы государств' },
      { id: 'capitals-popular', label: 'Столицы и популярные', shortLabel: 'Столицы +', description: 'Столицы и самые узнаваемые города' },
      { id: 'all', label: 'Все города', shortLabel: 'Все', description: 'Полный набор без ограничений' },
    ], runtimes: ['hosted', 'local'],
  },
  music: {
    engine: 'catalog_guess', label: 'Музыка', dailyLabel: 'Артист', shareIcon: '🎵', dataDir: 'music', dailyOrder: 6,
    countsTowardFullHouse: true, periodPolicy: 'all', difficultyPolicy: 'music', freePlay: true, variants: [], runtimes: ['hosted', 'local'],
  },
  diagnosis: {
    engine: 'catalog_guess', label: 'Диагнозы', dailyLabel: 'Диагноз', shareIcon: '🩺', dataDir: 'diagnoses', dailyOrder: 7,
    countsTowardFullHouse: true, periodPolicy: 'all', difficultyPolicy: 'none', freePlay: true, variants: [], runtimes: ['hosted', 'local'],
  },
  animal: {
    engine: 'catalog_guess', label: 'Животные', dailyLabel: 'Животное', shareIcon: '🐾', dataDir: 'animals', dailyOrder: 8,
    countsTowardFullHouse: true, periodPolicy: 'all', difficultyPolicy: 'none', freePlay: true, variants: [], runtimes: ['hosted', 'local'],
  },
  book: {
    engine: 'catalog_guess', label: 'Книги', dailyLabel: 'Книга', shareIcon: '📚', dataDir: 'books', dailyOrder: 9,
    countsTowardFullHouse: true, periodPolicy: 'all', difficultyPolicy: 'none', freePlay: true, variants: [], runtimes: ['hosted', 'local'],
  },
  character: {
    engine: 'catalog_guess', label: 'Персонажи', dailyLabel: 'Персонаж', shareIcon: '🎭', dataDir: 'characters', dailyOrder: 10,
    countsTowardFullHouse: true, periodPolicy: 'all', difficultyPolicy: 'none', freePlay: true, variants: [], runtimes: ['hosted', 'local'],
  },
  danetki: {
    engine: 'danetki_chat', label: 'Данетки', dailyLabel: 'Данетка', shareIcon: '❓', dataDir: 'danetki', dailyOrder: 12,
    countsTowardFullHouse: false, periodPolicy: 'all', difficultyPolicy: 'none', freePlay: true, variants: [], runtimes: ['hosted'],
  },
  connections: {
    engine: 'connections_grid', label: 'Связи', dailyLabel: 'Связи', shareIcon: '🧩', dataDir: 'connections', dailyOrder: 11,
    countsTowardFullHouse: false, periodPolicy: 'all', difficultyPolicy: 'none', freePlay: false, variants: [], runtimes: ['hosted'],
  },
  territory: {
    engine: 'territory_duel', label: 'Захват', dailyLabel: 'Захват', shareIcon: '⬡', dataDir: 'territory', dailyOrder: 0,
    countsTowardFullHouse: false, periodPolicy: 'all', difficultyPolicy: 'none', freePlay: false, variants: [], runtimes: ['hosted'],
  },
} as const satisfies Record<ContentModeId, GameModeCapabilities>

export type CatalogGuessModeId = {
  [Mode in ContentModeId]: typeof GAME_MODE_MANIFEST[Mode]['engine'] extends 'catalog_guess' ? Mode : never
}[ContentModeId]

export const isCatalogGuessModeId = (value: unknown): value is CatalogGuessModeId => (
  typeof value === 'string'
  && (CONTENT_MODE_IDS as readonly string[]).includes(value)
  && GAME_MODE_MANIFEST[value as ContentModeId].engine === 'catalog_guess'
)

export const CATALOG_GUESS_MODE_IDS = CONTENT_MODE_IDS.filter(isCatalogGuessModeId)

export type PlayableCatalogGuessModeId = Extract<PlayableModeId, CatalogGuessModeId>
export const PLAYABLE_CATALOG_GUESS_MODE_IDS = PLAYABLE_MODE_IDS.filter(
  (mode): mode is PlayableCatalogGuessModeId => isCatalogGuessModeId(mode),
)

export const DAILY_MODE_IDS = PLAYABLE_MODE_IDS
  .filter((mode) => GAME_MODE_MANIFEST[mode].dailyOrder > 0)
  .sort((left, right) => GAME_MODE_MANIFEST[left].dailyOrder - GAME_MODE_MANIFEST[right].dailyOrder)

export const CATALOG_GUESS_DAILY_MODE_IDS = DAILY_MODE_IDS.filter(
  (mode): mode is PlayableCatalogGuessModeId => isCatalogGuessModeId(mode),
)

export type FullHouseModeId = {
  [Mode in PlayableModeId]: typeof GAME_MODE_MANIFEST[Mode]['countsTowardFullHouse'] extends true ? Mode : never
}[PlayableModeId]
export const FULL_HOUSE_MODE_IDS = DAILY_MODE_IDS.filter(
  (mode): mode is FullHouseModeId => GAME_MODE_MANIFEST[mode].countsTowardFullHouse,
)
export const PERIOD_UNLOCKABLE_MODE_IDS = PLAYABLE_MODE_IDS.filter((mode) => GAME_MODE_MANIFEST[mode].periodPolicy === 'year')
export const FREE_PLAY_MODE_IDS = PLAYABLE_MODE_IDS.filter((mode) => GAME_MODE_MANIFEST[mode].freePlay)

export const isContentModeId = (value: unknown): value is ContentModeId => (
  typeof value === 'string' && (CONTENT_MODE_IDS as readonly string[]).includes(value)
)

export const isPlayableModeId = (value: unknown): value is PlayableModeId => (
  typeof value === 'string' && (PLAYABLE_MODE_IDS as readonly string[]).includes(value)
)

export const normalizeModeVariant = (mode: PlayableModeId, value: string | null | undefined) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  const variants = GAME_MODE_MANIFEST[mode].variants as readonly GameModeVariant[]
  return variants.length && !variants.some((variant) => variant.id === normalized) ? null : normalized
}
