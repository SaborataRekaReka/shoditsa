import type { CatalogGuessModeId } from './game-modes.js'

export type CatalogHintCopy = {
  plotOptionTitle: string
  plotOptionSubtitle: string
  optionTitle: string
  optionSubtitle: string
  modalTitle: string
  loadingText: string
}

/**
 * Exhaustive copy for catalog-game hints: a mode-specific plot/context hint
 * when valid content exists, plus a field that previous comparisons have not
 * revealed. Adding a catalog mode requires both variants here at compile time.
 */
export const CATALOG_HINT_COPY = {
  movie: {
    plotOptionTitle: 'Сюжетная завязка фильма',
    plotOptionSubtitle: 'Краткое описание начала истории без названия и ключевых спойлеров',
    optionTitle: 'Неоткрытая информация о фильме',
    optionSubtitle: 'Год, страна, жанр или участник фильма, которые ещё не раскрывались',
    modalTitle: 'Подсказка о фильме',
    loadingText: 'Ищем неоткрытые сведения о фильме',
  },
  series: {
    plotOptionTitle: 'Сюжетная завязка сериала',
    plotOptionSubtitle: 'Краткое описание начала истории без названия и ключевых спойлеров',
    optionTitle: 'Неоткрытая информация о сериале',
    optionSubtitle: 'Год, страна, жанр или автор сериала, которые ещё не раскрывались',
    modalTitle: 'Подсказка о сериале',
    loadingText: 'Ищем неоткрытые сведения о сериале',
  },
  anime: {
    plotOptionTitle: 'Сюжетная завязка аниме',
    plotOptionSubtitle: 'Краткое описание начала истории без названия и ключевых спойлеров',
    optionTitle: 'Неоткрытая информация об аниме',
    optionSubtitle: 'Формат, студия, жанр или год, которые ещё не раскрывались',
    modalTitle: 'Подсказка об аниме',
    loadingText: 'Ищем неоткрытые сведения об аниме',
  },
  game: {
    plotOptionTitle: 'Завязка и особенности игры',
    plotOptionSubtitle: 'Краткое описание мира или игрового замысла без названия ответа',
    optionTitle: 'Неоткрытая информация об игре',
    optionSubtitle: 'Год, жанр, платформа или разработчик, которые ещё не раскрывались',
    modalTitle: 'Подсказка об игре',
    loadingText: 'Ищем неоткрытые сведения об игре',
  },
  city: {
    plotOptionTitle: 'Образ города',
    plotOptionSubtitle: 'Краткое описание характерных черт города без его названия',
    optionTitle: 'Неоткрытая информация о городе',
    optionSubtitle: 'Страна, язык, население или показатель города, которые ещё не раскрывались',
    modalTitle: 'Подсказка о городе',
    loadingText: 'Ищем неоткрытые сведения о городе',
  },
  music: {
    plotOptionTitle: 'История артиста',
    plotOptionSubtitle: 'Краткое описание творческого пути без имени исполнителя',
    optionTitle: 'Неоткрытая информация об артисте',
    optionSubtitle: 'Страна, период, тип или жанр артиста, которые ещё не раскрывались',
    modalTitle: 'Подсказка об артисте',
    loadingText: 'Ищем неоткрытые сведения об артисте',
  },
  diagnosis: {
    plotOptionTitle: 'Клиническая картина',
    plotOptionSubtitle: 'Краткое описание случая без названия диагноза',
    optionTitle: 'Неоткрытая информация о диагнозе',
    optionSubtitle: 'Система организма, симптом или признак диагностики, которые ещё не раскрывались',
    modalTitle: 'Подсказка о диагнозе',
    loadingText: 'Ищем неоткрытые сведения о диагнозе',
  },
} as const satisfies Record<CatalogGuessModeId, CatalogHintCopy>
