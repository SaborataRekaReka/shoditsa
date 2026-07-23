import type { CatalogGuessModeId } from './game-modes.js'

export type CatalogHintCopy = {
  optionTitle: string
  optionSubtitle: string
  modalTitle: string
  loadingText: string
}

/**
 * Exhaustive copy for the one supported catalog-game hint: a field of the
 * answer that has not been revealed by previous comparisons. Adding another
 * catalog mode requires its hint language to be defined here at compile time.
 */
export const CATALOG_HINT_COPY = {
  movie: {
    optionTitle: 'Неоткрытая информация о фильме',
    optionSubtitle: 'Год, страна, жанр или участник фильма, которые ещё не раскрывались',
    modalTitle: 'Подсказка о фильме',
    loadingText: 'Ищем неоткрытые сведения о фильме',
  },
  series: {
    optionTitle: 'Неоткрытая информация о сериале',
    optionSubtitle: 'Год, страна, жанр или автор сериала, которые ещё не раскрывались',
    modalTitle: 'Подсказка о сериале',
    loadingText: 'Ищем неоткрытые сведения о сериале',
  },
  anime: {
    optionTitle: 'Неоткрытая информация об аниме',
    optionSubtitle: 'Формат, студия, жанр или год, которые ещё не раскрывались',
    modalTitle: 'Подсказка об аниме',
    loadingText: 'Ищем неоткрытые сведения об аниме',
  },
  game: {
    optionTitle: 'Неоткрытая информация об игре',
    optionSubtitle: 'Год, жанр, платформа или разработчик, которые ещё не раскрывались',
    modalTitle: 'Подсказка об игре',
    loadingText: 'Ищем неоткрытые сведения об игре',
  },
  city: {
    optionTitle: 'Неоткрытая информация о городе',
    optionSubtitle: 'Страна, язык, население или показатель города, которые ещё не раскрывались',
    modalTitle: 'Подсказка о городе',
    loadingText: 'Ищем неоткрытые сведения о городе',
  },
  music: {
    optionTitle: 'Неоткрытая информация об артисте',
    optionSubtitle: 'Страна, период, тип или жанр артиста, которые ещё не раскрывались',
    modalTitle: 'Подсказка об артисте',
    loadingText: 'Ищем неоткрытые сведения об артисте',
  },
  diagnosis: {
    optionTitle: 'Неоткрытая информация о диагнозе',
    optionSubtitle: 'Система организма, симптом или признак диагностики, которые ещё не раскрывались',
    modalTitle: 'Подсказка о диагнозе',
    loadingText: 'Ищем неоткрытые сведения о диагнозе',
  },
} as const satisfies Record<CatalogGuessModeId, CatalogHintCopy>
